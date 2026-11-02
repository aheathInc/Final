import 'dart:async';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/screens/registration_screen.dart';
import 'package:a_health_patient/widgets/residence_field.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  tearDown(() => Api.useDioForTesting(null));

  testWidgets(
      'residence debounces, discards stale results and keeps manual input after failure',
      (tester) async {
    final requests = <String>[];
    final delayed = Completer<void>();
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
        final q = o.data['q'] as String;
        requests.add(q);
        if (q == 'Dodoma') await delayed.future;
        h.resolve(Response(
            requestOptions: o,
            statusCode: q == 'Unknown' ? 503 : 200,
            data: {
              'places': [
                {
                  'name': q,
                  'context': '$q Region, Tanzania',
                  'label': '$q, Tanzania'
                }
              ]
            }));
      })));
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: ResidenceField(controller: controller)))));
    final input = find.byType(TextFormField);
    await tester.enterText(input, 'Do');
    await tester.pump(const Duration(milliseconds: 700));
    expect(requests, isEmpty);
    await tester.enterText(input, 'Dodom');
    await tester.pump(const Duration(milliseconds: 200));
    await tester.enterText(input, 'Dodoma');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pump();
    await tester.enterText(input, 'Arusha');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    delayed.complete();
    await tester.pumpAndSettle();
    expect(requests, ['Dodoma', 'Arusha']);
    expect(find.text('Dodoma Region, Tanzania'), findsNothing);
    await tester.tap(find.text('Arusha Region, Tanzania'));
    await tester.pumpAndSettle();
    expect(controller.text, 'Arusha, Tanzania');
    expect(find.byType(ListTile), findsNothing);
    await tester.enterText(input, 'Unknown');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    expect(controller.text, 'Unknown');
    expect(
        find.textContaining('Unaweza kuandika eneo mwenyewe'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'DOB uses day/month/year and missing consent never flags a selected DOB',
      (tester) async {
    tester.view.physicalSize = const Size(430, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final status = {
      'step': 'profile',
      'phone_number': '+255700000001',
      'consent_version': 'patient-registration-2026-10-v1',
      'profile': null
    };
    Map? submitted;
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
        dynamic data = status;
        if (o.path.endsWith('/options')) data = {'environment': 'simulated'};
        if (o.path.endsWith('/locations')) data = {'places': []};
        if (o.path.endsWith('/profile')) {
          submitted = o.data as Map;
          data = {
            ...status,
            'step': 'payment',
            'bill': {'reference': 'TEST'}
          };
        }
        h.resolve(Response(requestOptions: o, data: data, statusCode: 200));
      })));
    await tester.pumpWidget(const MaterialApp(home: RegistrationScreen()));
    await tester.pumpAndSettle();
    Future<void> enter(String label, String value) async {
      final field = find.widgetWithText(TextFormField, label);
      await tester.ensureVisible(field);
      await tester.enterText(field, value);
      tester.testTextInput.hide();
      await tester.pumpAndSettle();
    }

    await enter('Jina kamili', 'Synthetic Test Patient');
    await enter('Tarehe ya kuzaliwa', '31/02/1995');
    expect(find.text('Weka tarehe sahihi kwa DD/MM/YYYY.'), findsOneWidget);
    await enter('Tarehe ya kuzaliwa', '10/07/1995');
    expect(find.text('Weka tarehe sahihi kwa DD/MM/YYYY.'), findsNothing);
    final sex = find.byType(DropdownButtonFormField<String>);
    await tester.ensureVisible(sex);
    await tester.tap(sex);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mwanamke').last);
    await tester.pumpAndSettle();
    await enter('Mahali unapoishi', 'Dodoma');
    await enter('Jina la ndugu', 'Synthetic Relative');
    await enter('Simu ya ndugu', '0700000002');
    final save = find.text('Hifadhi na endelea');
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(submitted, isNull);
    expect(find.text('Weka tarehe ya kuzaliwa.'), findsNothing);
    expect(find.text('Kubali matumizi ya taarifa ili kuendelea na usajili.'),
        findsOneWidget);
    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(submitted?['date_of_birth'], '1995-07-10');
    expect(find.text('Ada ya usajili'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
