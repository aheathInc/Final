import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/patient_care.dart';
import 'package:a_health_patient/screens/patient_care_medicines_screen.dart';

void main() {
  final token = Platform.environment['AHP_ACCEPTANCE_PATIENT_TOKEN'];
  testWidgets(
    'live synthetic prescription, adherence and pharmacy render',
    (tester) async {
      final profileId =
          Platform.environment['AHP_ACCEPTANCE_PATIENT_PROFILE_ID']!;
      final prescriptionId =
          Platform.environment['AHP_ACCEPTANCE_PRESCRIPTION_ID']!;
      final adherenceId = Platform.environment['AHP_ACCEPTANCE_ADHERENCE_ID']!;
      final latitude =
          double.parse(Platform.environment['AHP_ACCEPTANCE_LAT']!);
      final longitude =
          double.parse(Platform.environment['AHP_ACCEPTANCE_LNG']!);
      final payloadPath = Platform.environment['AHP_ACCEPTANCE_PAYLOAD_PATH']!;
      late Map<String, dynamic> prescription;
      late Map<String, dynamic> adherence;
      late List<Map<String, dynamic>> availability;
      final payload = jsonDecode(File(payloadPath).readAsStringSync())
          as Map<String, dynamic>;
      final care = PatientCareRepository(
        get: (path, {query}) async {
          if (path == '/patient-profiles/$profileId/prescriptions') {
            return payload['prescriptions'];
          }
          if (path == '/adherence-logs') return payload['adherence'];
          if (path == '/pharmacies/medication-search')
            return payload['availability'];
          throw StateError('Unexpected acceptance repository path.');
        },
      );
      final prescriptions = await care.prescriptions(profileId);
      prescription =
          prescriptions.singleWhere((row) => row['id'] == prescriptionId);
      adherence = (await care.adherenceLogs(profileId))
          .singleWhere((row) => row['id'] == adherenceId);
      expect(adherenceMatchesPrescription(adherence, prescription), isTrue);
      expect(adherence['reported_status'], 'taken');
      final cachePath = Platform.environment['AHP_ACCEPTANCE_CACHE_ROW_PATH']!;
      File(cachePath).writeAsStringSync(
        jsonEncode(adherenceCacheRow(adherence)),
      );
      availability = await care.medicationAvailability(
        name: 'AHP_SYNTHETIC_TEST_MEDICATION',
        latitude: latitude,
        longitude: longitude,
      );
      expect(availability, hasLength(1));
      expect(availability.single['stock_status'], 'in_stock');
      expect(availability.single['pharmacy']['name'],
          'AHP Synthetic Test Pharmacy');

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ListView(children: [
            MedicationPrescriptionCards(
              prescriptions: [prescription],
              formatDate: (_) => 'synthetic acceptance',
            ),
            MedicationAvailabilityResults(
              rows: availability,
              searched: true,
              error: null,
              formatDate: (_) => 'synthetic acceptance',
            ),
          ]),
        ),
      ));
      expect(
          find.textContaining('AHP_SYNTHETIC_TEST_MEDICATION'), findsWidgets);
      expect(
          find.textContaining('AHP Synthetic Test Pharmacy'), findsOneWidget);
    },
    skip: token == null,
  );
}
