import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'db.dart';

/// Writes made without a connection, replayed when there is one.
///
/// Each entry carries the op_id it was created with, and that same id is sent
/// as the Idempotency-Key. Replaying a batch after a partial failure is
/// therefore always safe: the server recognises the operation it already
/// applied instead of doing it twice. That property is why /sync/batch exists
/// at all rather than the app just retrying raw requests.
class Outbox {
  static Future<void> enqueue({
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
        'method': method,
        'path': path,
        'path_params': pathParams == null ? null : jsonEncode(pathParams),
        'body': body == null ? null : jsonEncode(body),
        'created_at': DateTime.now().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }

  static Future<int> pendingCount() async {
    final db = await Db.instance;
    final rows = await db.rawQuery('SELECT COUNT(*) AS n FROM outbox');
    return (rows.first['n'] as int?) ?? 0;
  }

  static Future<List<Map<String, dynamic>>> operations({int limit = 100}) async {
    final db = await Db.instance;
    final rows = await db.query('outbox', orderBy: 'created_at ASC', limit: limit);
    return rows.map((r) {
      return {
        'op_id': r['op_id'],
        'method': r['method'],
        'path': r['path'],
        if (r['path_params'] != null)
          'path_params': jsonDecode(r['path_params'] as String),
        if (r['body'] != null) 'body': jsonDecode(r['body'] as String),
        'client_created_at': r['created_at'],
      };
    }).toList();
  }

  static Future<void> remove(String opId) async {
    final db = await Db.instance;
    await db.delete('outbox', where: 'op_id = ?', whereArgs: [opId]);
  }

  /// A rejected operation is dropped, not retried forever: the server has
  /// judged it invalid, and repeating it every time the phone reconnects would
  /// never succeed while keeping the queue permanently blocked.
  static Future<void> recordFailure(String opId, int status, String? message) async {
    if (status >= 400 && status < 500 && status != 429) {
      await remove(opId);
      return;
    }
    final db = await Db.instance;
    await db.rawUpdate(
      'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE op_id = ?',
      [message, opId],
    );
  }
}
