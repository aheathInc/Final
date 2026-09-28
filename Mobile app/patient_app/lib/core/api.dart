import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../main.dart';
import '../screens/login_screen.dart';
import 'config.dart';
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
  static final _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 12),
    receiveTimeout: const Duration(seconds: 20),
    headers: {'Content-Type': 'application/json'},
    validateStatus: (_) => true,
  ));

  static Future<bool> get online async {
    final result = await  Connectivity().checkConnectivity();
    return result != ConnectivityResult.none;
  }

  static Future<Options> _auth() async {
    final token = await Session.accessToken();
    return Options(headers: {
      if (token != null) 'Authorization': 'Bearer $token',
    });
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
    final options = await _auth();
    if (idempotencyKey != null) {
      options.headers!['Idempotency-Key'] = idempotencyKey;
    }

    final url = '${Config.baseUrlFor(path)}$path';
    final r = await _dio.request(
      url,
      data: body,
      queryParameters: query,
      options: Options(
        method: method,
        headers: options.headers,
      ),
    );

    if (r.statusCode == 401 &&
        !isRetry &&
        await Session.refreshToken() != null) {
      final refreshed = await _refresh();
      if (refreshed) {
        return _request(method, path,
            query: query,
            body: body,
            idempotencyKey: idempotencyKey,
            isRetry: true);
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

  static Future<dynamic> post(String path, Map<String, dynamic> body,
          {String? idempotencyKey}) =>
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
    try {
      return await post(path, body, idempotencyKey: opId);
    } on ApiException catch (e) {
      if (e.status == 0 || e.status >= 500 || e.status == 429) {
        await Outbox.enqueue(
            opId: opId,
            method: 'POST',
            path: syncPath,
            pathParams: pathParams,
            body: body);
        throw Queued();
      }
      rethrow;
    } on DioException {
      await Outbox.enqueue(
          opId: opId,
          method: 'POST',
          path: syncPath,
          pathParams: pathParams,
          body: body);
      throw Queued();
    }
  }

  static Future<int> flushOutbox() async {
    if (!await online) return 0;
    final ops = await Outbox.operations();
    if (ops.isEmpty) return 0;

    try {
      final data = await post('/sync/batch', {'operations': ops});
      final results = (data is Map ? data['results'] : null) as List? ?? [];
      var applied = 0;
      for (final raw in results) {
        final r = raw as Map;
        final opId = r['op_id'] as String;
        final status = (r['status'] as num?)?.toInt() ?? 0;
        if (status >= 200 && status < 300) {
          await Outbox.remove(opId);
          applied++;
        } else {
          final err = r['error'] as Map?;
          await Outbox.recordFailure(opId, status, err?['message'] as String?);
        }
      }
      return applied;
    } catch (_) {
      return 0;
    }
  }
}
