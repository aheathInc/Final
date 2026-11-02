import 'dart:async';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/profile_screen.dart';
import 'package:a_health_patient/screens/profile_editor_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'fixtures/profile_fixture.dart';

void main() {
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await Session.clear();
    await Session.save(
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        user: syntheticProfileAccount);
  });
  tearDown(() => Api.useDioForTesting(null));
  Future<void> show(WidgetTester tester, ProfileFixture repo,
      {bool large = false}) async {
    tester.view.physicalSize = Size(large ? 320 : 430, 850);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        theme: large ? buildDarkTheme() : buildTheme(),
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: TextScaler.linear(large ? 1.3 : 1)),
            child: child!),
        home: ProfileScreen(repository: repo)));
    await tester.pumpAndSettle();
  }

  Future<void> tap(WidgetTester tester, String text) async {
    final finder = find.text(text).last;
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  testWidgets(
      'overview is compact and personal edit writes only account fields',
      (tester) async {
    final repo = ProfileFixture();
    await show(tester, repo);
    expect(find.byType(TextField), findsNothing);
    expect(find.text('Synthetic Test Patient'), findsOneWidget);
    expect(repo.noteOwners, ['synthetic-profile-owner']);
    await tap(tester, 'Hariri taarifa');
    expect(find.byType(ProfileEditorScreen), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextFormField, 'Jina kamili'),
        'Synthetic Updated Patient');
    tester.testTextInput.hide();
    await tester.pumpAndSettle();
    await tap(tester, 'Hifadhi mabadiliko');
    expect(repo.accountWrites.single, {
      'base_version': 7,
      'full_name': 'Synthetic Updated Patient',
      'preferred_language': 'sw'
    });
    expect(repo.medicalWrites, isEmpty);
    expect(find.text('Synthetic Updated Patient'), findsOneWidget);
  });
  testWidgets(
      'medical conflict keeps draft and successful retry writes only medical profile',
      (tester) async {
    final repo = ProfileFixture()..conflict = true;
    await show(tester, repo);
    await tap(tester, 'Taarifa za afya');
    final allergies = find.widgetWithText(TextFormField, 'Mizio (Allergies)');
    await tester.enterText(allergies, 'Latex, Latex');
    tester.testTextInput.hide();
    await tester.pumpAndSettle();
    await tap(tester, 'Hifadhi mabadiliko');
    expect(find.byType(ProfileEditorScreen), findsOneWidget);
    expect(tester.widget<TextFormField>(allergies).controller!.text,
        'Latex, Latex');
    expect(repo.accountWrites, isEmpty);
    repo.conflict = false;
    await tap(tester, 'Pakia taarifa za sasa');
    await tester.ensureVisible(allergies);
    await tester.enterText(allergies, 'Latex, Penicillin, Latex');
    tester.testTextInput.hide();
    await tester.pumpAndSettle();
    await tap(tester, 'Hifadhi mabadiliko');
    expect(repo.medicalWrites.last, {
      'base_version': 3,
      'allergies': ['Latex', 'Penicillin'],
      'chronic_conditions': <String>[],
      'emergency_contact': '+255700000098'
    });
    expect(find.byType(ProfileEditorScreen), findsNothing);
    expect(repo.accountWrites, isEmpty);
  });
  testWidgets(
      'offline preserves owned cached advice and hides it on account change',
      (tester) async {
    final repo = ProfileFixture()..connected = false;
    await show(tester, repo);
    expect(find.textContaining('Uko offline'), findsOneWidget);
    expect(
        tester
            .widget<OutlinedButton>(
                find.widgetWithText(OutlinedButton, 'Hariri taarifa'))
            .onPressed,
        isNull);
    await tap(tester, 'Ushauri uliohifadhiwa');
    expect(
        find.text('Synthetic cached advice for UI testing.'), findsOneWidget);
    expect(find.text('Rudi haraka ukiona:'), findsOneWidget);
    await Session.clear();
    await tester.pumpAndSettle();
    expect(find.text('Synthetic cached advice for UI testing.'), findsNothing);
  });
  testWidgets('late profile responses cannot reveal a previous account',
      (tester) async {
    final repo = ProfileFixture()..gate = Completer<void>();
    await tester.pumpWidget(MaterialApp(
        theme: buildTheme(), home: ProfileScreen(repository: repo)));
    await tester.pump();
    await tester.pump();
    await Session.clear();
    repo.gate!.complete();
    await tester.pumpAndSettle();
    expect(find.text('Synthetic Test Patient'), findsNothing);
    expect(find.text('Ingia kwenye account yako ili kuona wasifu.'),
        findsOneWidget);
  });
  testWidgets('editor hides the previous account draft on sign out',
      (tester) async {
    final repo = ProfileFixture();
    await show(tester, repo);
    await tap(tester, 'Hariri taarifa');
    await tester.enterText(find.widgetWithText(TextFormField, 'Jina kamili'),
        'Synthetic Private Draft');
    await Session.clear();
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNothing);
    expect(find.text('Synthetic Private Draft'), findsNothing);
    expect(repo.accountWrites, isEmpty);
  });
  testWidgets('large text and long names keep essential actions reachable',
      (tester) async {
    final repo = ProfileFixture();
    repo.accountData['full_name'] =
        'Synthetic Patient With A Long Family Name For Layout';
    await show(tester, repo, large: true);
    await tester.ensureVisible(find.text('Ondoka kwenye account'));
    await tester.pumpAndSettle();
    expect(find.text('Ondoka kwenye account').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  test('account change blocks guarded profile requests before transport',
      () async {
    final expected = Session.identityChanges.value;
    await Session.clear();
    var sent = 0;
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
        sent++;
        h.resolve(Response(requestOptions: o, data: {}, statusCode: 200));
      })));
    await expectLater(
        Api.patch('/users/me', {'full_name': 'Old account draft'},
            expectedIdentity: expected),
        throwsA(isA<ApiException>()));
    expect(sent, 0);
  });
}
