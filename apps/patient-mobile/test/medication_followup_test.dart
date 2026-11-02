import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/core/medication_followup.dart';
import 'package:a_health_patient/screens/medication_followup_screen.dart';
import 'fixtures/medication_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            MedicationReminders.channel,
            (call) async => call.method == 'status'
                ? {
                    'enabled': false,
                    'notifications_allowed': true,
                    'exact_allowed': true,
                    'scheduled_count': 0
                  }
                : null);
    await Session.clear();
    await AppPreferences.instance.load();
    await L.load();
    await Session.save(
        accessToken: 'synthetic',
        refreshToken: 'synthetic',
        user: {'id': 'synthetic-med-owner', 'role': 'patient'});
  });
  tearDown(() => TestDefaultBinaryMessengerBinding
      .instance.defaultBinaryMessenger
      .setMockMethodCallHandler(MedicationReminders.channel, null));
  Future<void> show(WidgetTester t, MedicationFixture repo,
      {bool large = false}) async {
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
        home: MedicationFollowupScreen(repository: repo)));
    await t.pumpAndSettle();
  }

  Future<void> tap(WidgetTester t, Finder finder) async {
    await t.ensureVisible(finder);
    await t.pumpAndSettle();
    await t.tap(finder);
    await t.pumpAndSettle();
  }

  testWidgets(
      'self reports and unknown doses remain distinct; future dose cannot be confirmed',
      (t) async {
    final repo = MedicationFixture();
    await show(t, repo);
    expect(find.text('50%'), findsOneWidget);
    expect(find.text('Hazijathibitishwa: 1'), findsOneWidget);
    final taken = find.widgetWithText(FilledButton, 'Nimekunywa');
    expect(taken, findsOneWidget);
    await tap(t, taken);
    expect(repo.reports.single['id'], 'synthetic-dose');
    expect(repo.reports.single['taken'], true);
    expect(repo.reports.where((r) => r['id'] == 'synthetic-future'), isEmpty);
  });
  testWidgets(
      'snooze retains original dose time and does not record medicine intake',
      (t) async {
    final repo = MedicationFixture();
    await show(t, repo);
    await tap(t, find.text('Nikumbushe baadaye'));
    await tap(t, find.text('Baada ya dakika 10'));
    expect(repo.snoozes.single['minutes'], 10);
    expect(repo.reports, isEmpty);
    expect(
        repo.records.first['scheduled_at'], repo.scheduled.toIso8601String());
    expect(repo.records.first['reported_status'], 'unreported');
  });
  testWidgets('skip requires a reason and saves the explicit patient report',
      (t) async {
    final repo = MedicationFixture();
    await show(t, repo);
    await tap(t, find.widgetWithText(OutlinedButton, 'Nimeruka'));
    expect(
        t
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Thibitisha kuruka dozi'))
            .onPressed,
        isNull);
    await t.tap(find.byType(DropdownButtonFormField<String>));
    await t.pumpAndSettle();
    await t.tap(find.text('Dawa zimekwisha').last);
    await t.pumpAndSettle();
    await tap(t, find.widgetWithText(FilledButton, 'Thibitisha kuruka dozi'));
    expect(repo.reports.single['taken'], false);
    expect(repo.reports.single['reason'], 'ran_out');
  });
  testWidgets('stock uses explicit patient quantities and allows decimal comma',
      (t) async {
    final repo = MedicationFixture();
    await show(t, repo);
    await tap(t, find.text('Sasisha akiba niliyonayo'));
    final fields = find.byType(TextFormField);
    await t.enterText(fields.at(0), '8,5');
    await t.enterText(fields.at(1), 'tablets');
    await t.enterText(fields.at(2), '0,5');
    await t.enterText(fields.at(3), '2');
    t.testTextInput.hide();
    await t.pumpAndSettle();
    await tap(t, find.widgetWithText(FilledButton, 'Hifadhi'));
    expect(repo.supplies.single['quantity'], 8.5);
    expect(repo.supplies.single['units_per_dose'], .5);
    expect(
        find.text('Synthetic doctor instruction: unchanged.'), findsOneWidget);
  });
  testWidgets('conflict never shows a confirmed dose', (t) async {
    final repo = MedicationFixture()..conflict = true;
    await show(t, repo);
    await tap(t, find.widgetWithText(FilledButton, 'Nimekunywa'));
    expect(repo.reports, isEmpty);
    expect(find.text('Synthetic version conflict'), findsOneWidget);
    expect(repo.records.first['reported_status'], 'unreported');
  });
  testWidgets('a late response cannot expose a previous patient', (t) async {
    final repo = MedicationFixture()..gate = Completer<void>();
    await t.pumpWidget(
        MaterialApp(home: MedicationFollowupScreen(repository: repo)));
    await t.pump();
    await t.pump();
    final clearing = Session.clear();
    for (var i = 0; i < 20; i++) {
      await t.pump(const Duration(milliseconds: 20));
    }
    await clearing;
    repo.gate!.complete();
    await t.pumpAndSettle();
    expect(find.text('Synthetic test medicine'), findsNothing);
    expect(find.text('50%'), findsNothing);
  });
  testWidgets('narrow large text keeps refill and emergency actions reachable',
      (t) async {
    await show(t, MedicationFixture(), large: true);
    await t.ensureVisible(find.text('Msaada wa dharura'));
    await t.pumpAndSettle();
    expect(find.text('Msaada wa dharura').hitTestable(), findsOneWidget);
    expect(t.takeException(), isNull);
  });
  testWidgets('unavailable data is not displayed as zero adherence', (t) async {
    await show(t, MedicationFixture()..fail = true);
    expect(find.text('0%'), findsNothing);
    expect(find.text('50%'), findsNothing);
    expect(find.text('Taarifa za dawa hazijapatikana. Jaribu tena.'),
        findsOneWidget);
  });
}
