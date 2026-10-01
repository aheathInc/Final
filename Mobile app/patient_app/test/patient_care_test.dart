import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:a_health_patient/core/patient_care.dart';
import 'package:a_health_patient/screens/consultation_detail_screen.dart';

void main() {
  group('patient profile concurrency', () {
    test('includes the server profile version in the update body', () {
      final body = profileClinicalUpdateBody(
        profileVersion: 7,
        allergies: ['pollen'],
        chronicConditions: ['asthma'],
        emergencyContact: '+255700000001',
      );

      expect(body['base_version'], 7);
      expect(body['allergies'], ['pollen']);
      expect(body['chronic_conditions'], ['asthma']);
    });
  });

  group('consultation lifecycle', () {
    test('requires the persisted consultation and thread identifiers',
        () async {
      final calls = <String>[];
      final repository = PatientCareRepository(
        durablePost: (
            {required opId,
            required path,
            required syncPath,
            pathParams,
            required body}) async {
          calls.add('$path:$opId');
          return {
            'id': 'consultation-1',
            'care_thread_id': 'thread-1',
            'patient_profile_id': 'patient-1',
            'status': 'pending',
            'symptom_text': body['symptom_text'],
          };
        },
      );

      final consultation = await repository.createConsultation(
        opId: 'stable-operation-id',
        body: {'channel': 'app', 'symptom_text': 'Synthetic fixture'},
      );

      expect(calls, ['/consultations:stable-operation-id']);
      expect(consultation.id, 'consultation-1');
      expect(consultation.careThreadId, 'thread-1');
      expect(consultation.symptomText, 'Synthetic fixture');
    });

    test('rejects a response that does not confirm persisted IDs', () {
      expect(
        () => ConsultationRecord.fromJson({'status': 'pending'}),
        throwsFormatException,
      );
    });

    test('maps supported status vocabulary and keeps completed care visible',
        () {
      expect(consultationStatusLabel('offered'), contains('madaktari'));
      expect(consultationStatusLabel('completed'), contains('umekamilika'));
      final groups = partitionConsultations([
        {'id': 'a', 'status': 'pending'},
        {'id': 'b', 'status': 'completed'},
        {'id': 'c', 'status': 'cancelled'},
      ]);
      expect(groups.active.map((c) => c['id']), ['a']);
      expect(groups.recent.map((c) => c['id']), ['b', 'c']);
    });
  });

  group('patient-care API reads and writes', () {
    test('reads queue status and signed outcome from their contract routes',
        () async {
      final paths = <String>[];
      final repository = PatientCareRepository(
        get: (path, {query}) async {
          paths.add(path);
          if (path.endsWith('/queue-status')) return {'status': 'in_progress'};
          return {
            'diagnosis_text': 'Synthetic diagnosis',
            'signed_at': '2026-01-01T00:00:00Z'
          };
        },
      );

      expect((await repository.queueStatus('case-1'))['status'], 'in_progress');
      expect((await repository.signedNote('case-1'))['diagnosis_text'],
          'Synthetic diagnosis');
      expect(paths,
          ['/consultations/case-1/queue-status', '/consultations/case-1/note']);
    });

    test('reads patient prescriptions with the existing authorized endpoint',
        () async {
      String? requestedPath;
      final repository = PatientCareRepository(
        get: (path, {query}) async {
          requestedPath = path;
          return {
            'data': [
              {'id': 'rx-1', 'consultation_id': 'case-1', 'items': []}
            ]
          };
        },
      );

      final prescriptions = await repository.prescriptions('patient-1');
      expect(requestedPath, '/patient-profiles/patient-1/prescriptions');
      expect(prescriptions.single['consultation_id'], 'case-1');
    });

    test('sends a message on the existing care thread with idempotency',
        () async {
      String? actualPath;
      String? actualSyncPath;
      String? actualOperationId;
      Map<String, String>? actualPathParams;
      Map<String, dynamic>? actualBody;
      final repository = PatientCareRepository(
        durablePost: (
            {required opId,
            required path,
            required syncPath,
            pathParams,
            required body}) async {
          actualPath = path;
          actualSyncPath = syncPath;
          actualPathParams = pathParams;
          actualOperationId = opId;
          actualBody = body;
          return {'id': 'message-1', 'body': body['body']};
        },
      );

      await repository.sendMessage(
        opId: 'message-operation-1',
        careThreadId: 'thread-1',
        body: 'Synthetic message',
        clientCreatedAt: '2026-01-01T00:00:00Z',
      );

      expect(actualPath, '/care-threads/thread-1/messages');
      expect(actualSyncPath, '/care-threads/{care_thread_id}/messages');
      expect(actualPathParams, {'care_thread_id': 'thread-1'});
      expect(actualOperationId, 'message-operation-1');
      expect(actualBody?['body'], 'Synthetic message');
    });
  });

  testWidgets('signed consultation note displays supported server fields',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: SignedConsultationNoteCard(note: {
          'diagnosis_text': 'Synthetic outcome',
          'advice_text': 'Synthetic test-only advice',
          'red_flags_discussed': ['Synthetic escalation flag'],
          'signed_at': '2026-01-01T00:00:00Z',
        }),
      ),
    ));

    expect(find.text('Synthetic outcome'), findsOneWidget);
    expect(find.text('Synthetic test-only advice'), findsOneWidget);
    expect(find.text('• Synthetic escalation flag'), findsOneWidget);
  });
}
