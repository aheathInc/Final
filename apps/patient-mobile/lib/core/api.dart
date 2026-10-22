import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../main.dart';
import '../screens/login_screen.dart';
import 'config.dart';
import 'db.dart';
import 'outbox.dart';
import 'session.dart';

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);
  final int status;
  final String? code;
  final String message;
  @override
  String toString() => message;
}

/// Queued rather than sent, because there was no connection.
class Queued implements Exception {}

class Api {
  static bool _flushingOutbox = false;
  static Future<bool> Function()? connectivityProbeForTesting;
  @visibleForTesting
  static void Function(String event, {int? status, String? errorType})?
      diagnostic;

  static final _defaultDio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 12),
      receiveTimeout: const Duration(seconds: 20),
      headers: {'Content-Type': 'application/json'},
      validateStatus: (_) => true,
    ),
  );
  static Dio _dio = _defaultDio;

  @visibleForTesting
  static void useDioForTesting(Dio? dio) {
    _dio = dio ?? _defaultDio;
  }

  static Future<bool> get online async {
    final probe = connectivityProbeForTesting;
    if (probe != null) return probe();
    final result = await Connectivity().checkConnectivity();
    return result != ConnectivityResult.none;
  }

  static Future<Options> _auth() async {
    final token = await Session.accessToken();
    return Options(
      headers: {if (token != null) 'Authorization': 'Bearer $token'},
    );
  }

  static Never _raise(Response r) {
    final data = r.data;
    String? code;
    String message = 'Ombi halikufanikiwa.';
    if (data is Map && data['error'] is Map) {
      code = data['error']['code'] as String?;
      message = (data['error']['message'] as String?) ?? message;
    }
    throw ApiException(r.statusCode ?? 0, code, message);
  }

  static Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? query,
    Map<String, dynamic>? body,
    String? idempotencyKey,
    bool isRetry = false,
  }) async {
    diagnostic?.call('AUTH_LOOKUP_STARTED');
    final options = await _auth();
    diagnostic?.call('AUTH_LOOKUP_DONE');
    if (idempotencyKey != null) {
      options.headers!['Idempotency-Key'] = idempotencyKey;
    }

    final url = '${Config.baseUrlFor(path)}$path';
    diagnostic?.call('HTTP_REQUEST_STARTED');
    late final Response<dynamic> r;
    try {
      r = await _dio.request(
        url,
        data: body,
        queryParameters: query,
        options: Options(method: method, headers: options.headers),
      );
    } catch (error) {
      diagnostic?.call(
        'HTTP_REQUEST_ERROR',
        errorType: error.runtimeType.toString(),
      );
      rethrow;
    }
    diagnostic?.call('HTTP_RESPONSE_RECEIVED', status: r.statusCode);

    if (r.statusCode == 401 &&
        !isRetry &&
        await Session.refreshToken() != null) {
      final refreshed = await _refresh();
      if (refreshed) {
        return _request(
          method,
          path,
          query: query,
          body: body,
          idempotencyKey: idempotencyKey,
          isRetry: true,
        );
      } else {
        await _logout();
        throw ApiException(401, 'UNAUTHENTICATED', 'Kikao chako kimeisha.');
      }
    }

    if (r.statusCode! >= 400) _raise(r);
    return r.data;
  }

  static Future<bool> _refresh() async {
    final refresh = await Session.refreshToken();
    if (refresh == null) return false;

    try {
      final r = await _dio.post(
        '${Config.baseUrlFor('/auth/token/refresh')}/auth/token/refresh',
        data: {'refresh_token': refresh},
      );
      if (r.statusCode == 200) {
        final data = r.data as Map;
        await Session.save(
          accessToken: data['access_token'] as String,
          refreshToken: data['refresh_token'] as String,
        );
        return true;
      }
    } catch (_) {}
    return false;
  }

  static Future<void> _logout() async {
    await Session.clear();
    navigatorKey.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  static Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _request('GET', path, query: query);

  static Future<dynamic> post(
    String path,
    Map<String, dynamic> body, {
    String? idempotencyKey,
  }) =>
      _request('POST', path, body: body, idempotencyKey: idempotencyKey);

  static Future<dynamic> patch(String path, Map<String, dynamic> body) =>
      _request('PATCH', path, body: body);

  static Future<dynamic> postDurable({
    required String opId,
    required String path,
    required String syncPath,
    Map<String, String>? pathParams,
    required Map<String, dynamic> body,
  }) async {
    final operationType = queueableOperationType(
      path: path,
      syncPath: syncPath,
    );
    final ownerId = operationType == null ? null : await Session.userId();

    if (!await online) {
      if (operationType == null) {
        throw ApiException(
          0,
          'ONLINE_REQUIRED',
          'Internet required. This action was not saved locally.',
        );
      }
      if (ownerId == null) {
        throw ApiException(
          401,
          'UNAUTHENTICATED',
          'Sign in before saving this update.',
        );
      }
      await Outbox.enqueue(
        ownerId: ownerId,
        operationType: operationType,
        opId: opId,
        method: 'POST',
        path: syncPath,
        pathParams: pathParams,
        body: body,
      );
      throw Queued();
    }

    try {
      return await post(path, body, idempotencyKey: opId);
    } on ApiException catch (e) {
      if (operationType != null &&
          ownerId != null &&
          (e.status == 0 || e.status >= 500 || e.status == 429)) {
        await Outbox.enqueue(
          ownerId: ownerId,
          operationType: operationType,
          opId: opId,
          method: 'POST',
          path: syncPath,
          pathParams: pathParams,
          body: body,
        );
        throw Queued();
      }
      rethrow;
    } on DioException {
      if (operationType == null) {
        throw ApiException(
          0,
          'ONLINE_REQUIRED',
          'Internet required. This action was not saved locally.',
        );
      }
      if (ownerId == null) {
        throw ApiException(
          401,
          'UNAUTHENTICATED',
          'Sign in before saving this update.',
        );
      }
      await Outbox.enqueue(
        ownerId: ownerId,
        operationType: operationType,
        opId: opId,
        method: 'POST',
        path: syncPath,
        pathParams: pathParams,
        body: body,
      );
      throw Queued();
    }
  }

  static Future<int> flushOutbox() async {
    if (_flushingOutbox) return 0;
    _flushingOutbox = true;
    try {
      return await _flushOutbox();
    } finally {
      _flushingOutbox = false;
    }
  }

  static Future<int> _flushOutbox() async {
    final ownerId = await Session.userId();
    if (ownerId == null || !await online) return 0;
    final ops = await Outbox.operations(ownerId);
    if (ops.isEmpty) return 0;

    for (final op in ops) {
      await Outbox.markSending(ownerId, op['op_id'] as String);
    }

    try {
      final wireOperations = ops.map((op) {
        final wire = Map<String, dynamic>.from(op)
          ..remove('operation_type')
          ..remove('status');
        return wire;
      }).toList();
      final data = await post('/sync/batch', {'operations': wireOperations});
      final results = (data is Map ? data['results'] : null) as List? ?? [];
      var applied = 0;
      final completedIds = <String>{};
      final operationById = {for (final op in ops) op['op_id'] as String: op};
      for (final raw in results) {
        final r = raw as Map;
        final opId = r['op_id'] as String;
        completedIds.add(opId);
        final op = operationById[opId];
        if (op == null) continue;
        final status = (r['status'] as num?)?.toInt() ?? 0;
        if (status >= 200 && status < 300) {
          await Outbox.remove(ownerId, opId);
          if (op['operation_type'] == 'adherence_confirmation') {
            final params = op['path_params'] as Map?;
            final adherenceId = params?['adherence_log_id'] as String?;
            if (adherenceId != null) {
              await Db.markSynced(ownerId, adherenceId);
            }
          }
          applied++;
        } else {
          final err = r['error'] as Map?;
          final terminal = await Outbox.recordFailure(
            ownerId,
            opId,
            status,
            errorCode: err?['code'] as String? ?? 'HTTP_$status',
          );
          if (terminal && op['operation_type'] == 'adherence_confirmation') {
            final params = op['path_params'] as Map?;
            final adherenceId = params?['adherence_log_id'] as String?;
            if (adherenceId != null) {
              await Db.markSyncFailed(ownerId, adherenceId);
            }
          }
        }
      }

      // A missing result is retryable. Reuse the original op_id on the next
      // attempt so a server-side success with a lost response is not doubled.
      for (final op in ops) {
        final opId = op['op_id'] as String;
        if (completedIds.contains(opId)) continue;
        final terminal = await Outbox.recordFailure(
          ownerId,
          opId,
          503,
          errorCode: 'MISSING_SYNC_RESULT',
        );
        if (terminal && op['operation_type'] == 'adherence_confirmation') {
          final params = op['path_params'] as Map?;
          final adherenceId = params?['adherence_log_id'] as String?;
          if (adherenceId != null) {
            await Db.markSyncFailed(ownerId, adherenceId);
          }
        }
      }
      return applied;
    } on ApiException catch (e) {
      for (final op in ops) {
        final terminal = await Outbox.recordFailure(
          ownerId,
          op['op_id'] as String,
          e.status,
          errorCode: e.code ?? 'HTTP_${e.status}',
        );
        if (terminal && op['operation_type'] == 'adherence_confirmation') {
          final params = op['path_params'] as Map?;
          final adherenceId = params?['adherence_log_id'] as String?;
          if (adherenceId != null) {
            await Db.markSyncFailed(ownerId, adherenceId);
          }
        }
      }
      return 0;
    } on DioException {
      for (final op in ops) {
        final terminal = await Outbox.recordFailure(
          ownerId,
          op['op_id'] as String,
          0,
          errorCode: 'NETWORK',
        );
        if (terminal && op['operation_type'] == 'adherence_confirmation') {
          final params = op['path_params'] as Map?;
          final adherenceId = params?['adherence_log_id'] as String?;
          if (adherenceId != null) {
            await Db.markSyncFailed(ownerId, adherenceId);
          }
        }
      }
      return 0;
    } catch (_) {
      for (final op in ops) {
        await Outbox.recordFailure(
          ownerId,
          op['op_id'] as String,
          503,
          errorCode: 'SYNC_PROCESSING_ERROR',
        );
      }
      return 0;
    }
  }
}
