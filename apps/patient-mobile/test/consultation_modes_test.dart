import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/patient_care.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/new_consultation_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const options = {
  'remote_fees': {'general_practice': 5000, 'specialist': 8000, 'currency': 'TZS'},
  'facilities': [{'id': 'hospital-1', 'name': 'Synthetic Hospital'}],
};
void main() {
  for (final mode in ['hospital', 'remote']) {
    testWidgets('$mode request preserves the selected mode, modality and hospital', (tester) async {
      tester.view.physicalSize = const Size(390, 844); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      Map<String, dynamic>? sent;
      final repository = PatientCareRepository(get: (path, {query}) async => options,
        durablePost: ({required opId, required path, required syncPath, pathParams, required body}) async {
          sent = body;
          throw ApiException(503, 'TEST', 'Synthetic response: request recorded by test.');
        });
      await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: NewConsultationScreen(
        facilityId: 'hospital-1', facilityName: 'Synthetic Hospital', clinicianId: 'doctor-1', clinicianSpecialty: 'general_practice', repository: repository)));
      await tester.pumpAndSettle();
      await tester.tap(find.text(mode == 'hospital' ? 'Hospital consultation' : 'Remote consultation'));
      await tester.pumpAndSettle();
      if (mode == 'remote') { await tester.tap(find.text('Video call')); await tester.pumpAndSettle(); expect(find.text('Consultation fee: TZS 5000'), findsOneWidget); }
      else { expect(find.textContaining('Consultation fee: TZS 0'), findsOneWidget); expect(find.text('Video call'), findsNothing); }
      await tester.scrollUntilVisible(find.byType(TextField), 160, scrollable: find.byType(Scrollable).first);
      await tester.enterText(find.byType(TextField), 'Synthetic symptoms for request validation.');
      tester.testTextInput.hide(); await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Tuma ombi la consultation'), 180, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('Tuma ombi la consultation')); await tester.pumpAndSettle();
      expect(sent?['consultation_mode'], mode);
      expect(sent?['modality'], mode == 'hospital' ? 'in_person' : 'video');
      expect(sent?['facility_id'], mode == 'hospital' ? 'hospital-1' : null);
      expect(sent?['clinician_id'], 'doctor-1');
      expect(sent?.containsKey('amount'), false);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('specialist price and large text remain usable', (tester) async {
    tester.view.physicalSize = const Size(390, 844); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(1.3)), child: child!),
      home: NewConsultationScreen(clinicianSpecialty: 'surgery', repository: PatientCareRepository(get: (path, {query}) async => options))));
    await tester.pumpAndSettle(); await tester.tap(find.text('Remote consultation')); await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Consultation fee: TZS 8000'), 120, scrollable: find.byType(Scrollable).first);
    expect(find.text('Consultation fee: TZS 8000'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Tuma ombi la consultation'), 160, scrollable: find.byType(Scrollable).first);
    expect(tester.takeException(), isNull);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
  });
  testWidgets('options failure offers retry without enabling submission', (tester) async {
    var attempts = 0;
    await tester.pumpWidget(MaterialApp(home: NewConsultationScreen(repository: PatientCareRepository(get: (path, {query}) async {
      if (attempts++ == 0) throw ApiException(503, 'OFFLINE', 'Unavailable'); return options;
    }))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Jaribu kupakia njia tena')); await tester.pumpAndSettle();
    expect(attempts, 2); expect(find.text('Jaribu kupakia njia tena'), findsNothing);
  });
}
