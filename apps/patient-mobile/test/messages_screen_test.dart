import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:dio/dio.dart';
import 'package:a_health_patient/screens/thread_screen.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/core/patient_care.dart';
import 'package:a_health_patient/screens/messages_screen.dart';
import 'fixtures/messages_fixture.dart';

void main() {
  tearDown(() {
    Api.useDioForTesting(null);
    Session.locked.value = false;
  });
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await Session.clear();
    await Session.save(
        accessToken: 'synthetic',
        refreshToken: 'synthetic',
        user: {'id': 'synthetic-messages', 'role': 'patient'});
  });
  Future<void> show(WidgetTester t, MessagesFixture repo,
      {bool large = false, void Function(Map<String, dynamic>)? onOpen}) async {
    t.view.physicalSize = Size(large ? 320 : 430, 900);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    await t.pumpWidget(MaterialApp(
        theme: large ? buildDarkTheme() : buildTheme(),
        builder: (c, child) => MediaQuery(
            data: MediaQuery.of(c)
                .copyWith(textScaler: TextScaler.linear(large ? 1.3 : 1)),
            child: child!),
        home: MessagesScreen(repository: repo, onOpen: onOpen)));
    await t.pumpAndSettle();
  }

  Future<void> tap(WidgetTester t, String text) async {
    await t.ensureVisible(find.text(text).last);
    await t.pumpAndSettle();
    await t.tap(find.text(text).last);
    await t.pumpAndSettle();
  }

  testWidgets(
      'inbox filters real unread counts, searches, and opens exact thread',
      (t) async {
    Map<String, dynamic>? opened;
    await show(t, MessagesFixture(), onOpen: (thread) => opened = thread);
    expect(find.text('Mfano: Unaendeleaje leo?'), findsOneWidget);
    await tap(t, 'Hayajasomwa');
    expect(find.text('Dkt. Juma · Mfano'), findsNothing);
    await tap(t, 'Dkt. Amina · Mfano');
    expect(opened?['id'], 'synthetic-thread-one');
    await tap(t, 'Yote');
    await t.enterText(find.byType(TextField), 'Juma');
    await t.pumpAndSettle();
    expect(find.text('Dkt. Amina · Mfano'), findsNothing);
    expect(find.text('Dkt. Juma · Mfano'), findsOneWidget);
  });
  testWidgets('pagination uses server cursor and deduplicates conversations',
      (t) async {
    final repo = MessagesFixture()..paginated = true;
    await show(t, repo);
    await tap(t, 'Pakia mazungumzo zaidi');
    expect(repo.cursors, [null, 'older-page']);
    expect(find.text('Dkt. Amina · Mfano'), findsOneWidget);
    expect(find.text('Dkt. Neema · Mfano'), findsOneWidget);
  });
  testWidgets(
      'network failure keeps previous data with stale notice, never false empty state',
      (t) async {
    final repo = MessagesFixture();
    await show(t, repo);
    repo.fail = true;
    await t.tap(find.byTooltip('Onyesha upya'));
    await t.pumpAndSettle();
    expect(find.textContaining('Orodha hii inaweza kuwa ya zamani'),
        findsOneWidget);
    expect(find.text('Dkt. Amina · Mfano'), findsOneWidget);
    expect(find.text('Mazungumzo yako yataonekana hapa'), findsNothing);
  });
  testWidgets('late responses after logout cannot show the previous inbox',
      (t) async {
    final repo = MessagesFixture()..gate = Completer<void>();
    await t.pumpWidget(MaterialApp(home: MessagesScreen(repository: repo)));
    await t.pump();
    await t.pump();
    await Session.clear();
    repo.gate!.complete();
    await t.pumpAndSettle();
    expect(find.text('Dkt. Amina · Mfano'), findsNothing);
  });
  testWidgets(
      'narrow large text keeps search, shortcuts and emergency reachable',
      (t) async {
    await show(t, MessagesFixture(), large: true);
    await t.ensureVisible(find.text('Msaada wa dharura'));
    await t.pumpAndSettle();
    expect(find.text('Msaada wa dharura').hitTestable(), findsOneWidget);
    expect(t.takeException(), isNull);
  });
  testWidgets('empty inbox offers consultation without fake badges', (t) async {
    await show(t, MessagesFixture()..empty = true);
    expect(find.text('Anza consultation'), findsOneWidget);
    expect(find.byType(Badge), findsNothing);
    await tap(t, 'Hayajasomwa');
    expect(find.text('Hakuna ujumbe ambao haujasomwa kwenye orodha hii'),
        findsOneWidget);
  });
  test(
      'conversation history follows pagination instead of losing recent messages',
      () async {
    final cursors = <dynamic>[];
    final repo = PatientCareRepository(get: (path, {query}) async {
      cursors.add(query?['cursor']);
      return {
        'data': [
          {'id': query?['cursor'] == null ? 'first' : 'latest'}
        ],
        'meta': {'next_cursor': query?['cursor'] == null ? 'next' : null}
      };
    });
    expect((await repo.threadMessages('synthetic-thread')).map((m) => m['id']),
        ['first', 'latest']);
    expect(cursors, [null, 'next']);
  });
  for (final locked in [false, true]) {
    testWidgets(
        'read acknowledgement requires visible unlocked conversation: locked=$locked',
        (t) async {
      Session.locked.value = locked;
      final acknowledgements = <Map>[];
      Api.useDioForTesting(Dio()
        ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
          dynamic data = <String, dynamic>{};
          var status = 200;
          if (o.path.endsWith('/realtime/token')) {
            status = 422;
          } else if (o.path.endsWith('/messages/read')) {
            acknowledgements.add(o.data as Map);
          } else if (o.path.endsWith('/messages')) {
            data = {
              'data': [
                {
                  'id': 'synthetic-incoming',
                  'sender_user_id': 'synthetic-doctor',
                  'body': 'Synthetic incoming',
                  'created_at': '2026-10-28T08:20:00Z',
                  'read_at': null
                }
              ]
            };
          } else if (o.path.endsWith('/communication-consent')) {
            data = {'accepted': true};
          } else {
            data = {'status': 'open'};
          }
          h.resolve(
              Response(requestOptions: o, statusCode: status, data: data));
        })));
      await t.pumpWidget(MaterialApp(
          theme: buildTheme(),
          home: const ThreadScreen(
              careThreadId: 'synthetic-thread', title: 'Synthetic clinician')));
      await t.pumpAndSettle();
      expect(find.text('Synthetic incoming'), findsOneWidget);
      expect(
          acknowledgements,
          locked
              ? isEmpty
              : [
                  {'up_to_message_id': 'synthetic-incoming'}
                ]);
      await t.pumpWidget(const SizedBox());
      await t.pumpAndSettle();
    });
  }
}
