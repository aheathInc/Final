// Candidate 005: authored Flutter regression, NOT executed in the handover environment.
// Uses synthetic transport responses, not real Auth or PostgreSQL.
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/front_desk.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/front_desk_screen.dart';

Map<String, dynamic> visitData({String status = 'preregistered'}) => {
  'id': 'SYNTHETIC-VISIT-A', 'ticket': 'AHP-TEST-A', 'version': 1,
  'status': status, 'facility': {'id': 'facility-a', 'name': 'SYNTHETIC FACILITY A'},
  'department': {'id': 'department-a', 'name': 'SYNTHETIC DEPARTMENT A'},
  'clearance': {'payment': 'pending', 'insurance': 'pending', 'clinical_review': 'pending'},
  'consultation_id': null, 'care_thread_id': null,
};
Future<void> syntheticLogin(String owner) => Session.save(
  accessToken: 'TEST-ONLY-NOT-A-REAL-ACCESS-TOKEN',
  refreshToken: 'TEST-ONLY-NOT-A-REAL-REFRESH-TOKEN', user: {'id': owner, 'role': 'patient'},
);
FrontDeskRepository repository({Future<dynamic> Function(String)? response, DeskPost? post, bool online = true}) =>
  FrontDeskRepository(online: () async => online, post: post ?? (path, body, {idempotencyKey}) async => visitData(),
    get: (path, {query}) async => response == null ? {'data': <dynamic>[]} : await response(path));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async { FlutterSecureStorage.setMockInitialValues({}); await syntheticLogin('patient-a'); });

  test('parses a persisted preregistration without implying clinical acceptance', () {
    final visit = FrontDeskVisit.fromJson(visitData());
    expect(visit.status, 'preregistered'); expect(visit.canCancel, isTrue);
    expect(frontDeskStatusLabel(visit.status), contains('hujathibitisha kufika'));
  });
  test('rejects malformed envelope rather than showing a misleading empty list', () {
    expect(() => deskRows({'items': []}), throwsFormatException);
    expect(() => FrontDeskVisit.fromJson({'id': 'partial'}), throwsFormatException);
  });
  test('rejects an unknown server status', () {
    expect(() => FrontDeskVisit.fromJson(visitData(status: 'hospital_accepted_everything')), throwsFormatException);
  });
  test('generates distinct standards-shaped UUIDv4 request keys', () {
    final keys = List.generate(50, (_) => newFrontDeskRequestKey());
    final pattern = RegExp(r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$');
    expect(keys.toSet().length, keys.length); expect(keys.every(pattern.hasMatch), isTrue);
  });
  test('offline registration fails before any HTTP write, never entering an outbox', () async {
    var writes = 0;
    final repo = repository(online: false, post: (path, body, {idempotencyKey}) async { writes++; return visitData(); });
    await expectLater(repo.register({'request_key': newFrontDeskRequestKey()}), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'ONLINE_REQUIRED')));
    expect(writes, 0);
  });
  test('only check-in and cancellation are patient write actions', () async {
    var writes = 0;
    final repo = repository(post: (path, body, {idempotencyKey}) async { writes++; return visitData(); });
    await expectLater(repo.action(FrontDeskVisit.fromJson(visitData()), 'start'), throwsArgumentError);
    expect(writes, 0);
  });
  test('retries preserve the frozen request key and content', () async {
    final requests = <Map<String, dynamic>>[];
    final repo = repository(post: (path, body, {idempotencyKey}) async {
      requests.add(Map.of(body));
      if (requests.length == 1) throw ApiException(0, 'NETWORK_ERROR', 'Synthetic transport error');
      return visitData();
    });
    final request = Map<String, dynamic>.unmodifiable({'request_key': newFrontDeskRequestKey(), 'purpose': 'SYNTHETIC'});
    await expectLater(repo.register(request), throwsA(isA<ApiException>()));
    await repo.register(request);
    expect(requests[0], requests[1]);
  });
  test('patient action carries the last read version', () async {
    Map<String, dynamic>? sent;
    final repo = repository(post: (path, body, {idempotencyKey}) async { sent = body; return visitData(status: 'awaiting_review'); });
    await repo.action(FrontDeskVisit.fromJson(visitData()), 'check-in');
    expect(sent, {'base_version': 1});
  });
  test('completed and in-consultation visits cannot be cancelled by the UI', () {
    expect(FrontDeskVisit.fromJson(visitData(status: 'completed')).canCancel, isFalse);
    expect(FrontDeskVisit.fromJson(visitData(status: 'in_consultation')).canCancel, isFalse);
  });
  test('navigation is a POST, not symptom text in a query string', () async {
    String? called; Map<String,dynamic>? sent;
    final repo = repository(post: (path, body, {idempotencyKey}) async { called = path; sent = body; return {'suggestions': []}; });
    await repo.suggest('facility-a', 'SYNTHETIC: meno');
    expect(called, '/front-desk/facilities/facility-a/navigation'); expect(sent, {'text': 'SYNTHETIC: meno'});
  });
  testWidgets('renders authorized empty visits distinctly from a failed request', (tester) async {
    await tester.pumpWidget(MaterialApp(home: FrontDeskScreen(repository: repository())));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ziara zangu')); await tester.pumpAndSettle();
    expect(find.text('Bado hakuna ziara iliyohifadhiwa.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('initial loading failure shows retry and never an authorized empty state', (tester) async {
    final repo = repository(response: (_) async => throw ApiException(503, 'UNAVAILABLE', 'Synthetic outage'));
    await tester.pumpWidget(MaterialApp(home: FrontDeskScreen(repository: repo))); await tester.pumpAndSettle();
    expect(find.text('Pakia huduma tena'), findsOneWidget);
    expect(find.text('Bado hakuna ziara iliyohifadhiwa.'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('logout synchronously withdraws previous patient visits', (tester) async {
    final repo = repository(response: (path) async => {'data': path == '/front-desk/visits' ? [visitData()] : <dynamic>[]});
    await tester.pumpWidget(MaterialApp(home: FrontDeskScreen(repository: repo))); await tester.pumpAndSettle();
    await tester.tap(find.text('Ziara zangu')); await tester.pumpAndSettle();
    expect(find.textContaining('AHP-TEST-A'), findsOneWidget);
    await Session.clear(); await syntheticLogin('patient-b'); await tester.pumpAndSettle();
    expect(find.textContaining('AHP-TEST-A'), findsNothing);
    expect(find.textContaining('Kikao kimebadilika'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('a late Patient A response cannot repaint after account switching', (tester) async {
    final pending = Completer<dynamic>();
    final repo = repository(response: (path) async => path == '/front-desk/visits' ? await pending.future : {'data': []});
    await tester.pumpWidget(MaterialApp(home: FrontDeskScreen(repository: repo))); await tester.pump();
    await Session.clear(); await syntheticLogin('patient-b');
    pending.complete({'data': [visitData()]}); await tester.pumpAndSettle();
    expect(find.textContaining('AHP-TEST-A'), findsNothing);
    expect(find.textContaining('Kikao kimebadilika'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  test('ordinary token refresh does not announce an account switch', () async {
    final before = Session.identityChanges.value;
    await Session.save(accessToken: 'TEST-REFRESH-ONLY', refreshToken: 'TEST-REFRESH-ONLY');
    expect(Session.identityChanges.value, before);
  });
}
