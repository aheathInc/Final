import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import 'db.dart';

const int maxAutomaticRetries = 3;

String? queueableOperationType({
  required String path,
  required String syncPath,
}) {
  if (RegExp(r'^/check-ins/[^/]+/respond$').hasMatch(path) &&
      syncPath == '/check-ins/{check_in_id}/respond') {
    return 'checkin_response';
  }
  if (RegExp(r'^/adherence-logs/[^/]+/confirm$').hasMatch(path) &&
      syncPath == '/adherence-logs/{adherence_log_id}/confirm') {
    return 'adherence_confirmation';
  }
  return null;
}

/// Only low-risk Patient updates with existing idempotent APIs may be queued.
/// Stored rows are isolated by the authenticated account that created them.
class Outbox {
  static Future<void> enqueue({
    required String ownerId,
    required String operationType,
    required String opId,
    required String method,
    required String path,
    Map<String, String>? pathParams,
    Map<String, dynamic>? body,
  }) async {
    final db = await Db.instance;
    await db.insert(
        'outbox',
        {
          'op_id': opId,
          'owner_id': ownerId,
          'operation_type': operationType,
          'method': method,
          'path': path,
          'path_params': pathParams == null ? null : jsonEncode(pathParams),
          'body': body == null ? null : jsonEncode(body),
          'created_at': DateTime.now().toUtc().toIso8601String(),
          'status': 'queued',
        },
        conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  static Future<int> pendingCount(String ownerId) async =>
      _count(ownerId, "status IN ('queued', 'sending')");

  static Future<int> failedCount(String ownerId) async =>
      _count(ownerId, "status = 'failed'");

  static Future<int> retryableFailedCount(String ownerId) async {
    final db = await Db.instance;
    final rows = await db.query(
      'outbox',
      columns: ['last_error'],
      where: "owner_id = ? AND status = 'failed'",
      whereArgs: [ownerId],
    );
    return rows
        .where((row) => _isRetryableCode(row['last_error'] as String? ?? ''))
        .length;
  }

  static Future<int> retryFailed(String ownerId) async {
    final db = await Db.instance;
    final rows = await db.query(
      'outbox',
      columns: ['op_id', 'last_error'],
      where: "owner_id = ? AND status = 'failed'",
      whereArgs: [ownerId],
    );
    var retried = 0;
    for (final row in rows) {
      final code = row['last_error'] as String? ?? '';
      if (!_isRetryableCode(code)) continue;
      await db.update(
        'outbox',
        {
          'status': 'queued',
          'attempts': 0,
          'retry_after': null,
          'last_error': null,
        },
        where: 'owner_id = ? AND op_id = ?',
        whereArgs: [ownerId, row['op_id']],
      );
      retried++;
    }
    return retried;
  }

  static bool _isRetryableCode(String code) =>
      code == 'NETWORK' ||
      code == 'MISSING_SYNC_RESULT' ||
      code == 'SYNC_PROCESSING_ERROR' ||
      code == 'HTTP_0' ||
      code == 'HTTP_429' ||
      code.startsWith('HTTP_5');

  static Future<int> _count(String ownerId, String statusClause) async {
    final db = await Db.instance;
    final rows = await db.query(
      'outbox',
      columns: ['op_id'],
      where: 'owner_id = ? AND $statusClause',
      whereArgs: [ownerId],
    );
    return rows.length;
  }

  static Future<List<Map<String, dynamic>>> operations(
    String ownerId, {
    int limit = 100,
  }) async {
    final db = await Db.instance;
    final now = DateTime.now().toUtc().toIso8601String();
    final rows = await db.query(
      'outbox',
      where:
          "owner_id = ? AND status IN ('queued', 'sending') AND (status = 'sending' OR retry_after IS NULL OR retry_after <= ?)",
      whereArgs: [ownerId, now],
      orderBy: 'created_at ASC',
      limit: limit,
    );
    return rows.map((r) {
      return {
        'op_id': r['op_id'],
        'operation_type': r['operation_type'],
        'status': r['status'],
        'method': r['method'],
        'path': r['path'],
        if (r['path_params'] != null)
          'path_params': jsonDecode(r['path_params'] as String),
        if (r['body'] != null) 'body': jsonDecode(r['body'] as String),
        'client_created_at': r['created_at'],
      };
    }).toList();
  }

  static Future<Map<String, String>> checkInSyncStates(String ownerId) async {
    final db = await Db.instance;
    final rows = await db.query(
      'outbox',
      columns: ['path_params', 'status'],
      where:
          "owner_id = ? AND operation_type = 'checkin_response' AND status IN ('queued', 'sending', 'failed')",
      whereArgs: [ownerId],
      orderBy: 'created_at ASC',
    );
    final states = <String, String>{};
    for (final row in rows) {
      final raw = row['path_params'];
      if (raw is! String) continue;
      final params = jsonDecode(raw);
      if (params is Map && params['check_in_id'] is String) {
        states[params['check_in_id'] as String] = row['status'] as String;
      }
    }
    return states;
  }

  static Future<void> markSending(String ownerId, String opId) async {
    final db = await Db.instance;
    await db.update(
      'outbox',
      {'status': 'sending'},
      where: 'owner_id = ? AND op_id = ?',
      whereArgs: [ownerId, opId],
    );
  }

  static Future<void> remove(String ownerId, String opId) async {
    final db = await Db.instance;
    await db.delete(
      'outbox',
      where: 'owner_id = ? AND op_id = ?',
      whereArgs: [ownerId, opId],
    );
  }

  /// Permanent client errors remain visible for review; only network, 429 and
  /// server errors receive a bounded automatic retry with backoff.
  static Future<bool> recordFailure(
    String ownerId,
    String opId,
    int status, {
    required String errorCode,
  }) async {
    final db = await Db.instance;
    final rows = await db.query(
      'outbox',
      columns: ['attempts'],
      where: 'owner_id = ? AND op_id = ?',
      whereArgs: [ownerId, opId],
      limit: 1,
    );
    if (rows.isEmpty) return true;

    final retryable = status == 0 || status == 429 || status >= 500;
    if (!retryable) {
      await db.update(
        'outbox',
        {'status': 'failed', 'retry_after': null, 'last_error': errorCode},
        where: 'owner_id = ? AND op_id = ?',
        whereArgs: [ownerId, opId],
      );
      return true;
    }

    final attempts = ((rows.first['attempts'] as num?)?.toInt() ?? 0) + 1;
    final exhausted = attempts >= maxAutomaticRetries;
    final retryAfter = exhausted
        ? null
        : DateTime.now()
            .toUtc()
            .add(Duration(seconds: 30 * (1 << (attempts - 1))))
            .toIso8601String();
    await db.update(
      'outbox',
      {
        'attempts': attempts,
        'status': exhausted ? 'failed' : 'queued',
        'retry_after': retryAfter,
        'last_error': errorCode,
      },
      where: 'owner_id = ? AND op_id = ?',
      whereArgs: [ownerId, opId],
    );
    return exhausted;
  }
}
