import 'dart:async';
import 'package:a_health_patient/core/care_continuity.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/care_continuity_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> payload({String patient = 'a', bool populated = false}) => {
  'patient': {'id': patient, 'full_name': 'TEST $patient'},
  'profiles': [{'id': patient, 'full_name': 'TEST $patient'}],
  'as_of': DateTime.now().toUtc().toIso8601String(),
  'preference': {'sms_enabled': false, 'version': 0},
  'doses': populated ? [{
    'id': 'dose-$patient', 'version': 1, 'prescription_id': 'rx-$patient', 'prescription_item_id': 'item-$patient',
    'medication_name': 'TEST DATA ONLY ITEM $patient', 'dosage': 'TEST',
    'scheduled_at': DateTime.now().subtract(const Duration(hours: 1)).toUtc().toIso8601String(),
    'reported_status': 'unreported', 'state': 'not_confirmed', 'schedule_status': 'active', 'timezone': 'Africa/Dar_es_Salaam',
  }] : [],
  'meta': {'has_more': false, 'next_cursor': null},
  'cycles': [], 'plans': [], 'reminders': [],
};
class FakeCare extends CareContinuityRepository {
  FakeCare(this.value);
  Map<String, dynamic> value;
  Completer<CareOverview>? pending;
  bool fail = false;
  int writes = 0;
  String? key;
  @override
  Future<CareOverview> overview({String? profileId, String? cursor}) async {
    if (fail) throw Exception('Synthetic unavailable');
    if (pending != null) return pending!.future;
    return CareOverview.parse(value);
  }
  @override
  Future<void> reportDose(Map<String, dynamic> dose, String status, String key) async {
    writes++; this.key = key;
    final row = (value['doses'] as List).first as Map<String, dynamic>;
    row['reported_status'] = status; row['state'] = status == 'missed' ? 'patient_reported_skipped' : status; row['version'] = 2;
  }
}
Future<void> session(String id) => Session.save(accessToken: 'synthetic-not-a-token', refreshToken: 'synthetic-not-a-refresh-token', user: {'id': id});
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async { FlutterSecureStorage.setMockInitialValues({}); await session('user-a'); });
  test('authorized empty response preserves not-confirmed semantics', () {
    final result = CareOverview.parse(payload()); expect(result.doses, isEmpty); expect(result.preference['sms_enabled'], isFalse);
  });
  test('patient-reported skipped is not inferred from silence', () {
    final input = payload(populated: true); expect(CareOverview.parse(input).doses.single['state'], 'not_confirmed');
  });
  test('missing profile fails parsing', () { final input = payload()..remove('patient'); expect(() => CareOverview.parse(input), throwsFormatException); });
  test('malformed dose fails before rendering', () { final input = payload(); input['doses'] = [{'id': 'bad'}]; expect(() => CareOverview.parse(input), throwsFormatException); });
  test('missing list fails instead of masquerading as empty', () { final input = payload()..remove('cycles'); expect(() => CareOverview.parse(input), throwsFormatException); });
  test('malformed timing is rejected', () {
    final input = payload(); input['plans'] = [{'medication_name': 'TEST', 'plan': {'times': '08:00'}}]; expect(() => CareOverview.parse(input), throwsFormatException);
  });
  test('request keys are UUID-shaped and unique', () {
    final keys = List.generate(20, (_) => newCareRequestKey());
    expect(keys.toSet(), hasLength(20)); for (final k in keys) { expect(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(k), isTrue); }
  });
  testWidgets('shows authorized empty state without an error', (tester) async {
    await tester.pumpWidget(MaterialApp(home: CareContinuityScreen(repository: FakeCare(payload())))); await tester.pumpAndSettle();
    expect(find.text('Hakuna dozi kwenye kipindi hiki.'), findsOneWidget); expect(find.text('Ufuatiliaji haujapatikana. Jaribu tena.'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('service failure is not an authorized empty list', (tester) async {
    final repo = FakeCare(payload())..fail = true;
    await tester.pumpWidget(MaterialApp(home: CareContinuityScreen(repository: repo))); await tester.pumpAndSettle();
    expect(find.text('Ufuatiliaji haujapatikana. Jaribu tena.'), findsOneWidget); expect(find.text('Hakuna dozi kwenye kipindi hiki.'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('report button waits for repository confirmation and refresh', (tester) async {
    final repo = FakeCare(payload(populated: true));
    await tester.pumpWidget(MaterialApp(home: CareContinuityScreen(repository: repo))); await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Nimetumia')); await tester.pumpAndSettle();
    await tester.tap(find.text('Nimetumia')); await tester.pumpAndSettle();
    expect(repo.writes, 1); expect(repo.key, isNotEmpty); expect(find.text('Nimethibitisha nimetumia'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('logout clears sensitive state and blocks late patient A reply', (tester) async {
    final repo = FakeCare(payload(populated: true))..pending = Completer<CareOverview>();
    await tester.pumpWidget(MaterialApp(home: CareContinuityScreen(repository: repo))); await tester.pump();
    await Session.clear(); await session('user-b'); repo.pending!.complete(CareOverview.parse(repo.value)); await tester.pumpAndSettle();
    expect(find.text('TEST DATA ONLY ITEM a'), findsNothing);
    expect(find.text('Akaunti imebadilika. Rudi Home kisha ufungue ufuatiliaji upya.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('fresh B screen cannot inherit A loaded records', (tester) async {
    await tester.pumpWidget(MaterialApp(home: CareContinuityScreen(repository: FakeCare(payload(populated: true))))); await tester.pumpAndSettle();
    await Session.clear(); await session('user-b'); await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(MaterialApp(home: CareContinuityScreen(repository: FakeCare(payload(patient: 'b'))))); await tester.pumpAndSettle();
    expect(find.text('TEST DATA ONLY ITEM a'), findsNothing); expect(find.text('Hakuna dozi kwenye kipindi hiki.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
