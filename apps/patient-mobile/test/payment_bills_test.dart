import 'dart:async';
import 'package:a_health_patient/core/payment_bills.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/payment_bills_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

class FakeBills extends PaymentBillsRepository {
  bool fail = false;
  int writes = 0;
  List<Map<String, dynamic>> values = [];
  Completer<List<Map<String, dynamic>>>? delayed;
  @override
  Future<List<Map<String, dynamic>>> bills() async {
    if (fail) throw Exception('Fixture');
    return delayed?.future ?? Future.value(values);
  }

  @override
  Future<Map<String, dynamic>> options() async => {
        'environment': 'test',
        'requires_email': true,
        'providers': ['mpesa', 'tigo_pesa', 'airtel_money']
      };
  @override
  Future<Map<String, dynamic>> pay(
      {required String billId,
      required String provider,
      required String phone,
      required String key,
      String? email}) async {
    writes++;
    return {'id': 'fixture', 'environment': 'test', 'status': 'processing'};
  }
}

Future<void> login(String id) => Session.save(
    accessToken: 'test-only',
    refreshToken: 'test-only-refresh',
    user: {'id': id, 'phone_number': '+255700000001'});
Map<String, dynamic> bill() => {
      'id': 'bill-a',
      'reference': 'TEST-A',
      'title': 'TEST CONSULTATION A',
      'amount': 15000,
      'currency': 'TZS',
      'status': 'due',
      'expires_at':
          DateTime.now().add(const Duration(days: 1)).toUtc().toIso8601String()
    };
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await login('patient-a');
  });
  test('payment keys are UUID v4 and unique', () {
    final repo = PaymentBillsRepository();
    final keys = List.generate(50, (_) => repo.newKey());
    expect(keys.toSet().length, 50);
    for (final key in keys)
      expect(
          RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
              .hasMatch(key),
          isTrue);
  });
  testWidgets('empty bills do not manufacture a fee', (tester) async {
    final repo = FakeBills();
    await tester.pumpWidget(MaterialApp(
        home: MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: PaymentBillsScreen(repository: repo))));
    await tester.pumpAndSettle();
    expect(
        find.text(
            'Hakuna bili iliyotolewa. Bili huandaliwa na staff mwenye ruhusa.'),
        findsOneWidget);
    expect(repo.writes, 0);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('a free consultation bill cannot be selected for payment', (tester) async {
    final repo = FakeBills()..values = [{...bill(), 'payable': false,
      'payment_block_reason': 'This consultation is free. No consultation payment is required.'}];
    await tester.pumpWidget(MaterialApp(home: PaymentBillsScreen(repository: repo)));
    await tester.pumpAndSettle();
    expect(find.text('Chagua bili'), findsNothing);
    expect(find.text('This consultation is free. No consultation payment is required.'), findsOneWidget);
    expect(repo.writes, 0);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('API failure is distinct from authorized empty state',
      (tester) async {
    final repo = FakeBills()..fail = true;
    await tester.pumpWidget(MaterialApp(
        home: MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: PaymentBillsScreen(repository: repo))));
    await tester.pumpAndSettle();
    expect(
        find.text(
            'Bili hazikupatikana. Hakuna malipo yaliyothibitishwa. Ingia na ujaribu tena.'),
        findsOneWidget);
    expect(
        find.text(
            'Hakuna bili iliyotolewa. Bili huandaliwa na staff mwenye ruhusa.'),
        findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('bill shows price and wallet choices but does not start debit',
      (tester) async {
    final repo = FakeBills()..values = [bill()];
    await tester.pumpWidget(MaterialApp(
        home: MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: PaymentBillsScreen(repository: repo))));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Chagua bili'));
    await tester.tap(find.text('Chagua bili'));
    await tester.pumpAndSettle();
    expect(find.text('M-Pesa'), findsOneWidget);
    expect(find.text('Mixx by Yas (Tigo Pesa)'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Airtel Money'), 150);
    expect(find.text('Airtel Money'), findsOneWidget);
    expect(repo.writes, 0);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('account switch clears loaded previous payer data',
      (tester) async {
    final repo = FakeBills()..values = [bill()];
    await tester.pumpWidget(MaterialApp(
        home: MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: PaymentBillsScreen(repository: repo))));
    await tester.pumpAndSettle();
    expect(find.text('TEST CONSULTATION A'), findsOneWidget);
    repo.values = [];
    await Session.clear();
    await login('patient-b');
    await tester.pumpAndSettle();
    expect(find.text('TEST CONSULTATION A'), findsNothing);
    expect(repo.writes, 0);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
