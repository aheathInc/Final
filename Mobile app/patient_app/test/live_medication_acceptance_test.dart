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

  final pharmacyPayloadPath =
      Platform.environment['AHP_ACCEPTANCE_PHARMACY_PAYLOAD_PATH'];
  testWidgets(
    'session-gated authenticated pharmacy read-back renders for the patient',
    (tester) async {
      final payload = jsonDecode(
        File(pharmacyPayloadPath!).readAsStringSync(),
      ) as Map<String, dynamic>;
      expect(payload['patient_session_verified'], isTrue);
      expect(payload['source'], 'authenticated_patient_api_readback');
      final stage = payload['stage'] as String;
      final prescription =
          Map<String, dynamic>.from(payload['prescription'] as Map);
      final prescriptionId = prescription['id'] as String;
      final fulfillment =
          Map<String, dynamic>.from(payload['fulfillment'] as Map);
      final availability = (payload['availability'] as List)
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList();
      final reference = payload['reference'] as String?;

      if (stage == 'issue') {
        expect(fulfillment['fulfilment_status'], 'not_dispensed');
        expect(reference, isA<String>());
      } else if (stage == 'partial') {
        expect(fulfillment['fulfilment_status'], 'partial');
        expect(fulfillment['items'].single['quantity_dispensed'], 4);
        expect(fulfillment['items'].single['quantity_remaining'], 6);
        expect(fulfillment['dispensing_history'], hasLength(1));
      } else if (stage == 'complete') {
        expect(fulfillment['status'], 'completed');
        expect(fulfillment['fulfilment_status'], 'complete');
        expect(fulfillment['items'].single['quantity_dispensed'], 10);
        expect(fulfillment['items'].single['quantity_remaining'], 0);
        expect(fulfillment['dispensing_history'], hasLength(2));
      } else {
        fail('Unsupported pharmacy read-back stage.');
      }

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ListView(children: [
            MedicationPrescriptionCards(
              prescriptions: [prescription],
              formatDate: (_) => 'synthetic acceptance',
              fulfillmentByPrescription: {prescriptionId: fulfillment},
              handoffReferences: {
                if (stage == 'issue') prescriptionId: reference as String,
              },
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

      expect(find.textContaining('SYNTHETIC MEDICINE'), findsWidgets);
      expect(find.textContaining('Facility Pharmacy A'), findsWidgets);
      if (stage == 'issue') {
        expect(find.textContaining('Reference ya mkononi'), findsOneWidget);
        expect(find.byType(SelectableText), findsOneWidget);
      } else {
        expect(find.text('Historia ya utoaji'), findsOneWidget);
      }
    },
    skip: pharmacyPayloadPath == null ||
        Platform.environment['AHP_ACCEPTANCE_PHARMACY_SESSION_VERIFIED'] != '1',
  );

  final patientBPayloadPath =
      Platform.environment['AHP_ACCEPTANCE_PHARMACY_PATIENT_B_PAYLOAD_PATH'];
  testWidgets(
    'session-gated Patient B prescription list contains no Patient A record',
    (tester) async {
      final payload = jsonDecode(
        File(patientBPayloadPath!).readAsStringSync(),
      ) as Map<String, dynamic>;
      expect(payload['patient_session_verified'], isTrue);
      expect(payload['source'], 'authenticated_patient_api_readback');
      expect(payload['patientA_prescription_absent'], isTrue);
      final prescriptions = (payload['prescriptions'] as List)
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList();

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ListView(children: [
            if (prescriptions.isEmpty)
              const Text('Hakuna agizo la dawa lililopo kwenye rekodi zako.'),
            MedicationPrescriptionCards(
              prescriptions: prescriptions,
              formatDate: (_) => 'synthetic acceptance',
            ),
          ]),
        ),
      ));

      expect(
        find.text('Hakuna agizo la dawa lililopo kwenye rekodi zako.'),
        prescriptions.isEmpty ? findsOneWidget : findsNothing,
      );
      expect(find.textContaining('SYNTHETIC MEDICINE'), findsNothing);
      expect(find.textContaining('Facility Pharmacy A'), findsNothing);
    },
    skip: patientBPayloadPath == null ||
        Platform.environment[
                'AHP_ACCEPTANCE_PHARMACY_PATIENT_B_SESSION_VERIFIED'] !=
            '1',
  );
}
