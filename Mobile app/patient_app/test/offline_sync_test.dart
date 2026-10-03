import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';

import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/db.dart';
import 'package:a_health_patient/core/outbox.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/emergency_screen.dart';
import 'package:a_health_patient/screens/medications_screen.dart';

class _MemoryDatabase implements Database {
  final Map<String, List<Map<String, Object?>>> tables = {};

  dynamic dispatch(Invocation invocation) {
    final name = invocation.memberName;
    final positional = invocation.positionalArguments;
    final named = invocation.namedArguments;
    if (name == #transaction) {
      final callback = positional.first as Function;
      return Function.apply(callback, [_MemoryTransaction(this)]);
    }
    if (name == #query) {
      return Future.value(_query(
        positional[0] as String,
        where: named[#where] as String?,
        whereArgs: (named[#whereArgs] as List?)?.cast<Object?>(),
        columns: (named[#columns] as List?)?.cast<String>(),
        limit: named[#limit] as int?,
      ));
    }
    if (name == #insert) {
      return Future.value(_insert(
        positional[0] as String,
        Map<String, Object?>.from(positional[1] as Map),
        named[#conflictAlgorithm] as ConflictAlgorithm?,
      ));
    }
    if (name == #delete) {
      return Future.value(_delete(
        positional[0] as String,
        where: named[#where] as String?,
        whereArgs: (named[#whereArgs] as List?)?.cast<Object?>(),
      ));
    }
    if (name == #update) {
      return Future.value(_update(
        positional[0] as String,
        Map<String, Object?>.from(positional[1] as Map),
        where: named[#where] as String?,
        whereArgs: (named[#whereArgs] as List?)?.cast<Object?>(),
      ));
    }
    return super.noSuchMethod(invocation);
  }

  List<Map<String, Object?>> _query(
    String table, {
    String? where,
    List<Object?>? whereArgs,
    List<String>? columns,
    int? limit,
  }) {
    var rows = List<Map<String, Object?>>.from(tables[table] ?? const []);
    rows = rows.where((row) => _matches(row, where, whereArgs)).toList();
    if (limit != null) rows = rows.take(limit).toList();
    if (columns != null) {
      rows = rows
          .map((row) => {for (final column in columns) column: row[column]})
          .toList();
    }
    return rows;
  }

  int _insert(
      String table, Map<String, Object?> row, ConflictAlgorithm? conflict) {
    final rows = tables.putIfAbsent(table, () => []);
    final key = table == 'outbox'
        ? row['op_id']
        : table == 'cache_sync_state'
            ? '${row['cache_name']}:${row['owner_id']}'
            : row['id'];
    final existing = rows.indexWhere((candidate) {
      final candidateKey = table == 'outbox'
          ? candidate['op_id']
          : table == 'cache_sync_state'
              ? '${candidate['cache_name']}:${candidate['owner_id']}'
              : candidate['id'];
      return candidateKey == key;
    });
    if (existing >= 0) {
      if (conflict == ConflictAlgorithm.replace) {
        rows[existing] = row;
      }
      return 1;
    }
    rows.add(row);
    return 1;
  }

  int _delete(String table, {String? where, List<Object?>? whereArgs}) {
    final rows = tables.putIfAbsent(table, () => []);
    final before = rows.length;
    rows.removeWhere((row) => _matches(row, where, whereArgs));
    return before - rows.length;
  }

  int _update(
    String table,
    Map<String, Object?> values, {
    String? where,
    List<Object?>? whereArgs,
  }) {
    var count = 0;
    for (final row in tables.putIfAbsent(table, () => [])) {
      if (_matches(row, where, whereArgs)) {
        row.addAll(values);
        count++;
      }
    }
    return count;
  }

  bool _matches(Map<String, Object?> row, String? where, List<Object?>? args) {
    if (where == null) return true;
    final values = args ?? const [];
    Object? valueFor(String column) {
      final match = RegExp(
        '(?<![\\w])${RegExp.escape(column)} = \\?',
      ).firstMatch(where);
      if (match == null) return null;
      final argumentIndex =
          where.substring(0, match.start).split('?').length - 1;
      return argumentIndex < values.length ? values[argumentIndex] : null;
    }

    if (where.contains('owner_id = ?') &&
        row['owner_id'] != valueFor('owner_id')) {
      return false;
    }
    if (where.contains('cache_name = ?') &&
        row['cache_name'] != valueFor('cache_name')) {
      return false;
    }
    if (where.contains('op_id = ?') && row['op_id'] != valueFor('op_id')) {
      return false;
    }
    if (RegExp(r'(?<![\w])id = \?').hasMatch(where) &&
        row['id'] != valueFor('id')) {
      return false;
    }
    if (where.contains('synced = 1') && row['synced'] != 1) {
      return false;
    }
    if (where.contains("status = 'failed'") && row['status'] != 'failed') {
      return false;
    }
    if (where.contains("status IN ('queued', 'sending')") &&
        row['status'] != 'queued' &&
        row['status'] != 'sending') {
      return false;
    }
    if (where.contains("status IN ('queued', 'sending', 'failed')") &&
        !['queued', 'sending', 'failed'].contains(row['status'])) {
      return false;
    }
    if (where.contains("operation_type = 'checkin_response'") &&
        row['operation_type'] != 'checkin_response') {
      return false;
    }
    return true;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => dispatch(invocation);
}

class _MemoryTransaction implements Transaction {
  _MemoryTransaction(this.database);
  @override
  final _MemoryDatabase database;

  @override
  dynamic noSuchMethod(Invocation invocation) => database.dispatch(invocation);
}

class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.respond);
  final ResponseBody Function(RequestOptions options) respond;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _jsonResponse(Object body, int status) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType]
      },
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late _MemoryDatabase database;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    database = _MemoryDatabase();
    Db.useDatabaseForTesting(database);
    Api.connectivityProbeForTesting = () async => false;
    Api.useDioForTesting(Dio(BaseOptions(validateStatus: (_) => true)));
  });

  tearDown(() {
    Db.useDatabaseForTesting(null);
    Api.connectivityProbeForTesting = null;
    Api.useDioForTesting(null);
  });

  test('only adherence and check-in updates are eligible for offline queueing',
      () {
    expect(
      queueableOperationType(
        path: '/adherence-logs/log-1/confirm',
        syncPath: '/adherence-logs/{adherence_log_id}/confirm',
      ),
      'adherence_confirmation',
    );
    expect(
      queueableOperationType(
        path: '/check-ins/check-1/respond',
        syncPath: '/check-ins/{check_in_id}/respond',
      ),
      'checkin_response',
    );
    for (final path in [
      '/consultations',
      '/appointments',
      '/appointments/apt-1/cancel',
      '/screening-invitations/invite-1/respond',
      '/care-threads/thread-1/messages',
      '/emergency-requests',
    ]) {
      expect(
        queueableOperationType(path: path, syncPath: path),
        isNull,
        reason: '$path must remain online-only',
      );
    }
  });

  test('cached notes and medication rows are isolated by account', () async {
    await Db.cacheNotes('patient-a', [
      {'id': 'note-a', 'advice_text': 'private A', 'created_at': '2026-01-01'},
    ]);
    await Db.cacheNotes('patient-b', [
      {'id': 'note-b', 'advice_text': 'private B', 'created_at': '2026-01-02'},
    ]);
    await Db.replaceMedicationSchedule('patient-a', [
      {
        'id': 'dose-a',
        'medication_name': 'A medication',
        'dosage': 'A dose',
        'scheduled_at': '2026-01-01',
        'reported_status': 'unreported',
        'synced': 1,
      },
    ]);
    await Db.replaceMedicationSchedule('patient-b', [
      {
        'id': 'dose-b',
        'medication_name': 'B medication',
        'dosage': 'B dose',
        'scheduled_at': '2026-01-02',
        'reported_status': 'unreported',
        'synced': 1,
      },
    ]);

    expect((await Db.notes('patient-a')).single['advice_text'], 'private A');
    expect((await Db.notes('patient-b')).single['advice_text'], 'private B');
    expect((await Db.medicationSchedule('patient-a')).single['id'], 'dose-a');
    expect((await Db.medicationSchedule('patient-b')).single['id'], 'dose-b');
    expect(
        await Db.cacheSyncedAt('consultation_notes', 'patient-a'), isNotNull);
  });

  test(
      'logout followed by Patient B login cannot expose Patient A cache or queue',
      () async {
    await Session.save(
      accessToken: 'test-access-a',
      refreshToken: 'test-refresh-a',
      user: {'id': 'patient-a'},
    );
    await Db.cacheNotes('patient-a', [
      {'id': 'note-a', 'advice_text': 'private A', 'created_at': '2026-01-01'},
    ]);
    await Outbox.enqueue(
      ownerId: 'patient-a',
      operationType: 'checkin_response',
      opId: 'patient-a-key',
      method: 'POST',
      path: '/check-ins/{check_in_id}/respond',
      pathParams: {'check_in_id': 'check-a'},
      body: {
        'responses': {'feeling': 2}
      },
    );

    await Session.clear();
    await Session.save(
      accessToken: 'test-access-b',
      refreshToken: 'test-refresh-b',
      user: {'id': 'patient-b'},
    );
    final currentOwner = await Session.userId();
    expect(currentOwner, 'patient-b');
    expect(await Db.notes(currentOwner!), isEmpty);
    expect(await Outbox.operations(currentOwner), isEmpty);
    expect(await Outbox.pendingCount(currentOwner), 0);
  });

  test(
      'outbox retains the idempotency key and cannot sync another account rows',
      () async {
    await Session.save(
      accessToken: 'test-access-a',
      refreshToken: 'test-refresh-a',
      user: {'id': 'patient-a'},
    );
    await expectLater(
      Api.postDurable(
        opId: 'stable-idempotency-key',
        path: '/check-ins/check-a/respond',
        syncPath: '/check-ins/{check_in_id}/respond',
        pathParams: {'check_in_id': 'check-a'},
        body: {
          'responses': {'feeling': 3}
        },
      ),
      throwsA(isA<Queued>()),
    );

    final patientA = await Outbox.operations('patient-a');
    expect(patientA.single['op_id'], 'stable-idempotency-key');
    expect(patientA.single['path_params'], {'check_in_id': 'check-a'});
    expect(patientA.single.keys, isNot(contains('access_token')));
    expect(patientA.single.keys, isNot(contains('refresh_token')));
    expect(await Outbox.operations('patient-b'), isEmpty);
    expect(await Outbox.checkInSyncStates('patient-a'), {'check-a': 'queued'});
    expect(await Outbox.checkInSyncStates('patient-b'), isEmpty);
  });

  test('consultations remain online-only and are not put in the local queue',
      () async {
    await Session.save(
      accessToken: 'test-access-a',
      refreshToken: 'test-refresh-a',
      user: {'id': 'patient-a'},
    );
    await expectLater(
      Api.postDurable(
        opId: 'consultation-key',
        path: '/consultations',
        syncPath: '/consultations',
        body: {'symptom_text': 'synthetic symptom text'},
      ),
      throwsA(
        isA<ApiException>().having((e) => e.code, 'code', 'ONLINE_REQUIRED'),
      ),
    );
    expect(await Outbox.pendingCount('patient-a'), 0);
  });

  test('retries are bounded and permanent 4xx errors stay failed', () async {
    await Outbox.enqueue(
      ownerId: 'patient-a',
      operationType: 'adherence_confirmation',
      opId: 'retry-key',
      method: 'POST',
      path: '/adherence-logs/{adherence_log_id}/confirm',
      pathParams: {'adherence_log_id': 'dose-a'},
      body: {'reported_status': 'taken'},
    );

    expect(
      await Outbox.recordFailure('patient-a', 'retry-key', 503,
          errorCode: 'HTTP_503'),
      isFalse,
    );
    expect(
      await Outbox.recordFailure('patient-a', 'retry-key', 503,
          errorCode: 'HTTP_503'),
      isFalse,
    );
    expect(
      await Outbox.recordFailure('patient-a', 'retry-key', 503,
          errorCode: 'HTTP_503'),
      isTrue,
    );
    expect(await Outbox.pendingCount('patient-a'), 0);
    expect(await Outbox.failedCount('patient-a'), 1);
    expect(await Outbox.retryableFailedCount('patient-a'), 1);

    expect(await Outbox.retryFailed('patient-a'), 1);
    expect(await Outbox.pendingCount('patient-a'), 1);
    expect(
      await Outbox.recordFailure('patient-a', 'retry-key', 422,
          errorCode: 'VALIDATION_FAILED'),
      isTrue,
    );
    expect(await Outbox.retryableFailedCount('patient-a'), 0);
    expect(await Outbox.retryFailed('patient-a'), 0);
  });

  test(
      'sync sends the original idempotency key once and removes confirmed work',
      () async {
    await Session.save(
      accessToken: 'test-access-a',
      refreshToken: 'test-refresh-a',
      user: {'id': 'patient-a'},
    );
    await Outbox.enqueue(
      ownerId: 'patient-a',
      operationType: 'adherence_confirmation',
      opId: 'one-stable-key',
      method: 'POST',
      path: '/adherence-logs/{adherence_log_id}/confirm',
      pathParams: {'adherence_log_id': 'dose-a'},
      body: {'reported_status': 'taken'},
    );

    final adapter = _StubAdapter((options) {
      final requestBody = options.data;
      final firstOp = requestBody is Map
          ? ((requestBody['operations'] as List).first as Map)
          : const <String, Object?>{};
      expect(firstOp['op_id'], 'one-stable-key');
      expect(firstOp.containsKey('owner_id'), isFalse);
      expect(firstOp.containsKey('operation_type'), isFalse);
      return _jsonResponse({
        'results': [
          {'op_id': 'one-stable-key', 'status': 200},
        ],
      }, 207);
    });
    final dio = Dio(BaseOptions(validateStatus: (_) => true))
      ..httpClientAdapter = adapter;
    Api.useDioForTesting(dio);
    Api.connectivityProbeForTesting = () async => true;

    expect(await Api.flushOutbox(), 1);
    expect(await Outbox.pendingCount('patient-a'), 0);
    expect(await Api.flushOutbox(), 0);
    expect(adapter.requests, hasLength(1));
  });

  test('401 uses the normal refresh flow and retries with the rotated token',
      () async {
    await Session.save(
      accessToken: 'expired-test-access',
      refreshToken: 'valid-test-refresh',
      user: {'id': 'patient-a'},
    );
    final adapter = _StubAdapter((options) {
      if (options.path.endsWith('/auth/token/refresh')) {
        return _jsonResponse({
          'access_token': 'fresh-test-access',
          'refresh_token': 'fresh-test-refresh',
        }, 200);
      }
      if (options.headers['Authorization'] == 'Bearer expired-test-access') {
        return _jsonResponse({
          'error': {'code': 'UNAUTHENTICATED'}
        }, 401);
      }
      expect(options.headers['Authorization'], 'Bearer fresh-test-access');
      return _jsonResponse({'ok': true}, 200);
    });
    Api.useDioForTesting(
      Dio(BaseOptions(validateStatus: (_) => true))
        ..httpClientAdapter = adapter,
    );

    final result = await Api.post('/test/online-action', {});
    expect(result, {'ok': true});
    expect(
        adapter.requests.where((r) => r.path.endsWith('/test/online-action')),
        hasLength(2));
    expect(await Session.accessToken(), 'fresh-test-access');
  });

  testWidgets('offline medication view labels cached data', (tester) async {
    await Session.save(
      accessToken: 'test-access-a',
      refreshToken: 'test-refresh-a',
      user: {'id': 'patient-a'},
    );
    await Db.replaceMedicationSchedule('patient-a', [
      {
        'id': 'dose-a',
        'medication_name': 'Cached medicine',
        'dosage': 'one tablet',
        'scheduled_at': '2026-01-01T09:00:00Z',
        'reported_status': 'unreported',
        'synced': 1,
      },
    ]);
    await tester.pumpWidget(const MaterialApp(home: MedicationsScreen()));
    await tester.pumpAndSettle();
    expect(find.textContaining('Cached data:'), findsOneWidget);
    expect(find.textContaining('Cached medicine'), findsOneWidget);
  });

  testWidgets('offline emergency is not submitted or queued', (tester) async {
    await Session.save(
      accessToken: 'test-access-a',
      refreshToken: 'test-refresh-a',
      user: {'id': 'patient-a'},
    );
    await tester.pumpWidget(const MaterialApp(home: EmergencyScreen()));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('emergency-category-medical')));
    await tester.pump();
    Future<void> reveal(Finder target) async {
      for (var attempt = 0; attempt < 8 && !tester.any(target); attempt++) {
        await tester.drag(find.byType(ListView), const Offset(0, -400));
        await tester.pumpAndSettle();
      }
      expect(target, findsOneWidget);
    }

    const latitude = Key('emergency-latitude');
    const longitude = Key('emergency-longitude');
    await reveal(find.byKey(latitude));
    await tester.enterText(find.byKey(latitude), '-6.8');
    await reveal(find.byKey(longitude));
    await tester.enterText(find.byKey(longitude), '39.2');
    await reveal(find.text('Tuma ombi'));
    await tester.pump();
    await tester.tap(find.text('Tuma ombi'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, 900));
    await tester.pumpAndSettle();
    expect(
      find.text('ONLINE REQUEST UNAVAILABLE. Hakuna ombi lililotumwa.'),
      findsOneWidget,
    );
    expect(find.text('Ombi lililorekodiwa'), findsNothing);
    expect(await Outbox.pendingCount('patient-a'), 0);
  });
}
