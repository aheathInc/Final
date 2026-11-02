import 'l10n.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'dart:convert';
import 'dart:typed_data';
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
  static Future<Uint8List> receiptPdf(String path,
      {bool registration = false}) async {
    final identity = Session.identityChanges.value;
    final rejectedAccessToken = await Session.accessToken();
    final enrollment = registration ? await Session.registrationToken() : null;
    Future<Response<dynamic>> request() async =>
        _dio.get('${Config.baseUrlFor(path)}$path',
            options: Options(responseType: ResponseType.bytes, headers: {
              'Authorization':
                  'Bearer ${registration ? enrollment : await Session.accessToken()}',
              'Accept': 'application/pdf',
            }));
    var response = await request();
    if (!registration &&
        response.statusCode == 401 &&
        await _refresh(rejectedAccessToken: rejectedAccessToken)) {
      response = await request();
    }
    if (identity != Session.identityChanges.value ||
        Session.locked.value ||
        (registration && enrollment != await Session.registrationToken())) {
      throw ApiException(
          401,
          'TOKEN_INVALID',
          L.tr(
              'Account imebadilika au imefungwa. Jaribu tena baada ya kuingia.'));
    }
    if ((response.statusCode ?? 500) >= 400) {
      dynamic data;
      try {
        data = jsonDecode(utf8.decode(List<int>.from(response.data as List)));
      } catch (_) {}
      final error =
          data is Map && data['error'] is Map ? data['error'] as Map : null;
      throw ApiException(response.statusCode ?? 500, error?['code'] as String?,
          error?['message'] as String? ?? L.tr('Risiti haikupatikana.'));
    }
    final bytes = Uint8List.fromList(List<int>.from(response.data as List));
    if (bytes.length < 5 ||
        bytes.length > 2000000 ||
        ascii.decode(bytes.sublist(0, 5), allowInvalid: true) != '%PDF-') {
      throw const FormatException('Invalid PDF receipt');
    }
    return bytes;
  }

  /// Registration tokens are deliberately kept out of the normal API session.
  static Future<dynamic> registration(String method, String path,
      {Map<String, dynamic>? body}) async {
    final token = await Session.registrationToken();
    final r = await _dio.request('${Config.baseUrlFor(path)}$path',
        data: body,
        options: Options(method: method, headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        }));
    if ((r.statusCode ?? 500) >= 400) _raise(r);
    return r.data;
  }

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
    String message = L.tr('Ombi halikufanikiwa.');
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
    int? expectedIdentity,
  }) async {
    final requestIdentity = Session.identityChanges.value;
    diagnostic?.call('AUTH_LOOKUP_STARTED');
    final options = await _auth();
    void checkIdentity() {
      if (requestIdentity != Session.identityChanges.value ||
          (expectedIdentity != null &&
              expectedIdentity != Session.identityChanges.value)) {
        throw ApiException(403, 'NOT_RESOURCE_OWNER',
            L.tr('Account imebadilika. Fungua taarifa zako tena.'));
      }
    }

    checkIdentity();
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
    checkIdentity();

    if (r.statusCode == 401 &&
        !isRetry &&
        await Session.refreshToken() != null) {
      final refreshed = await _refresh(
          rejectedAccessToken: options.headers?['Authorization']
              ?.toString()
              .replaceFirst('Bearer ', ''));
      if (refreshed) {
        return _request(
          method,
          path,
          query: query,
          body: body,
          idempotencyKey: idempotencyKey,
          isRetry: true,
          expectedIdentity: expectedIdentity,
        );
      } else {
        await _logout(expectedIdentity: requestIdentity);
        throw ApiException(
            401, 'UNAUTHENTICATED', L.tr('Kikao chako kimeisha.'));
      }
    }

    if (r.statusCode! >= 400) _raise(r);
    return r.data;
  }

  static Future<bool>? _refreshing;
  static int? _refreshingIdentity;

  // A rotating refresh token must be presented once, even when many requests
  // discover an expired access token together after the app resumes.
  static Future<bool> _refresh({String? rejectedAccessToken}) {
    final identity = Session.identityChanges.value;
    if (_refreshing != null && _refreshingIdentity == identity) {
      return _refreshing!;
    }
    _refreshingIdentity = identity;
    late final Future<bool> pending;
    pending = _performRefresh(identity, rejectedAccessToken).whenComplete(() {
      if (identical(_refreshing, pending)) {
        _refreshing = null;
        _refreshingIdentity = null;
      }
    });
    _refreshing = pending;
    return pending;
  }

  static Future<bool> _performRefresh(
      int identity, String? rejectedAccessToken) async {
    void checkIdentity() {
      if (identity != Session.identityChanges.value) {
        throw ApiException(403, 'NOT_RESOURCE_OWNER',
            L.tr('Account imebadilika. Ingia tena kwenye account yako.'));
      }
    }

    final currentAccess = await Session.accessToken();
    checkIdentity();
    // A late 401 can arrive after another request has already rotated tokens.
    if (rejectedAccessToken != null &&
        currentAccess != null &&
        currentAccess != rejectedAccessToken) {
      return true;
    }
    final refresh = await Session.refreshToken();
    checkIdentity();
    if (refresh == null) return false;

    final r = await _dio.post(
      '${Config.baseUrlFor('/auth/token/refresh')}/auth/token/refresh',
      data: {'refresh_token': refresh},
    );
    checkIdentity();
    if (r.statusCode == 200) {
      final data = r.data as Map;
      await Session.save(
        accessToken: data['access_token'] as String,
        refreshToken: data['refresh_token'] as String,
      );
      return true;
    }
    // Only an explicit authentication rejection requires another sign-in.
    // A dropped connection or unavailable service must retain this session.
    if (r.statusCode == 401 || r.statusCode == 403) return false;
    _raise(r);
  }

  static Future<void> _logout({int? expectedIdentity}) async {
    if (expectedIdentity != null &&
        expectedIdentity != Session.identityChanges.value) {
      return;
    }
    await Session.clear(preserveBiometricPreference: true);
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

  static Future<dynamic> patch(String path, Map<String, dynamic> body,
          {int? expectedIdentity}) =>
      _request('PATCH', path, body: body, expectedIdentity: expectedIdentity);

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
          L.tr('Internet required. This action was not saved locally.'),
        );
      }
      if (ownerId == null) {
        throw ApiException(
          401,
          'UNAUTHENTICATED',
          L.tr('Sign in before saving this update.'),
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
          L.tr('Internet required. This action was not saved locally.'),
        );
      }
      if (ownerId == null) {
        throw ApiException(
          401,
          'UNAUTHENTICATED',
          L.tr('Sign in before saving this update.'),
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
