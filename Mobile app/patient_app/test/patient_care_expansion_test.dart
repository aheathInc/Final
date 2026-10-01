import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/patient_care.dart';
import 'package:a_health_patient/screens/patient_care_medicines_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('patient care response parsing', () {
    test(
      'parses appointment, diagnostics, prescriptions and pharmacy rows',
      () {
        final rows = patientCareRows({
          'data': [
            {'id': 'one'},
            'invalid row',
          ],
        });
        expect(rows, hasLength(1));
        expect(rows.single['id'], 'one');
        expect(patientCareRows({'data': 'invalid'}), isEmpty);
        expect(patientCareRecord({'id': 'a'}, 'invalid')['id'], 'a');
        expect(() => patientCareRecord(null, 'invalid'), throwsFormatException);
      },
    );

    test(
        'recognizes bookable state and result availability without inventing states',
        () {
      expect(isAppointmentBookable({'status': 'booked'}), isTrue);
      expect(isAppointmentBookable({'status': 'cancelled'}), isFalse);
      expect(hasDiagnosticResult({'status': 'resulted'}), isTrue);
      expect(hasDiagnosticResult({'status': 'ordered'}), isFalse);
      expect(hasDiagnosticResult({'status': 'scheduled'}), isFalse);
    });

    test('links adherence only to matching prescription ids', () {
      expect(
        adherenceMatchesPrescription({'prescription_id': 'p-1'}, {'id': 'p-1'}),
        isTrue,
      );
      expect(
        adherenceMatchesPrescription({'prescription_id': 'p-2'}, {'id': 'p-1'}),
        isFalse,
      );
    });

    test('maps persisted adherence relationship into the local cache row', () {
      final cached = adherenceCacheRow({
        'id': 'dose-1',
        'prescription_id': 'rx-1',
        'medication_name': 'AHP_SYNTHETIC_TEST_MEDICATION',
        'dosage': 'TEST DATA ONLY',
        'scheduled_at': '2026-10-01T12:00:00.000Z',
        'reported_status': 'taken',
      });
      expect(cached['id'], 'dose-1');
      expect(cached['prescription_id'], 'rx-1');
      expect(cached['reported_status'], 'taken');
      expect(cached['synced'], 1);
    });
  });

  group('patient care API flows', () {
    test(
      'books and cancels only through persisted appointment API operations',
      () async {
        final requests = <Map<String, dynamic>>[];
        final care = PatientCareRepository(
          get: (path, {query}) async => path == '/appointments'
              ? {
                  'data': [
                    {'id': 'a-1', 'status': 'booked'},
                  ],
                }
              : path == '/appointments/a-1'
                  ? {'id': 'a-1', 'status': 'booked'}
                  : {'data': []},
          durablePost: ({
            required opId,
            required path,
            required syncPath,
            pathParams,
            required body,
          }) async {
            requests.add({'op': path, 'body': body, 'params': pathParams});
            return {
              'id': 'a-1',
              'status': path.endsWith('/cancel') ? 'cancelled' : 'booked',
            };
          },
        );

        final appointment = await care.bookAppointment(
          opId: 'booking-op',
          slotId: 'slot-1',
        );
        expect(appointment['status'], 'booked');
        expect((await care.appointments()).single['id'], 'a-1');
        expect((await care.appointment('a-1'))['status'], 'booked');
        final cancelled = await care.cancelAppointment(
          'a-1',
          opId: 'cancel-op',
        );
        expect(cancelled['status'], 'cancelled');
        expect(requests.map((r) => r['op']), [
          '/appointments',
          '/appointments/a-1/cancel',
        ]);
        expect(requests.first['body']['slot_id'], 'slot-1');
        expect(requests.last['params'], {'appointment_id': 'a-1'});
      },
    );

    test(
      'preserves backend slot conflict and reads diagnostic results',
      () async {
        final care = PatientCareRepository(
          get: (path, {query}) async => path == '/investigation-orders/test'
              ? {
                  'id': 'test',
                  'status': 'resulted',
                  'values': [
                    {'analyte': 'synthetic'},
                  ],
                }
              : {
                  'data': [
                    {'id': 'test', 'status': 'resulted'},
                  ],
                },
          durablePost: ({
            required opId,
            required path,
            required syncPath,
            pathParams,
            required body,
          }) async {
            throw ApiException(409, 'SLOT_UNAVAILABLE', 'Unavailable');
          },
        );
        expect((await care.investigationOrders()).single['status'], 'resulted');
        expect((await care.investigationOrder('test'))['values'], hasLength(1));
        await expectLater(
          care.bookAppointment(opId: 'op', slotId: 'stale'),
          throwsA(
            isA<ApiException>().having(
              (e) => e.code,
              'code',
              'SLOT_UNAVAILABLE',
            ),
          ),
        );
      },
    );

    test('reads a persisted prescription and dose confirmation back', () async {
      final prescription = {
        'id': 'rx-1',
        'status': 'active',
        'items': [
          {
            'medication_name': 'AHP_SYNTHETIC_TEST_MEDICATION',
            'dosage': 'TEST DATA ONLY',
            'instructions': 'TEST DATA ONLY — NOT FOR CLINICAL USE',
          },
        ],
      };
      var adherence = <String, dynamic>{
        'id': 'dose-1',
        'prescription_id': 'rx-1',
        'medication_name': 'AHP_SYNTHETIC_TEST_MEDICATION',
        'reported_status': 'unreported',
      };
      final care = PatientCareRepository(
        get: (path, {query}) async {
          if (path == '/patient-profiles/patient-1/prescriptions') {
            return {
              'data': [prescription]
            };
          }
          if (path == '/adherence-logs')
            return {
              'data': [adherence]
            };
          throw StateError('Unexpected request path');
        },
        durablePost: ({
          required opId,
          required path,
          required syncPath,
          pathParams,
          required body,
        }) async {
          expect(path, '/adherence-logs/dose-1/confirm');
          expect(body['reported_status'], 'taken');
          adherence = {...adherence, 'reported_status': 'taken'};
          return adherence;
        },
      );
      final prescriptions = await care.prescriptions('patient-1');
      expect(prescriptions.single['id'], 'rx-1');
      expect(
        prescriptions.single['items'][0]['medication_name'],
        'AHP_SYNTHETIC_TEST_MEDICATION',
      );
      final log = (await care.adherenceLogs('patient-1')).single;
      expect(adherenceMatchesPrescription(log, prescriptions.single), isTrue);
      final confirmed = await care.confirmDose(
        opId: 'dose-op',
        adherenceLogId: 'dose-1',
        reportedStatus: 'taken',
      );
      expect(confirmed['reported_status'], 'taken');
      final readBack = (await care.adherenceLogs('patient-1')).single;
      expect(readBack['id'], 'dose-1');
      expect(readBack['prescription_id'], 'rx-1');
      expect(readBack['reported_status'], 'taken');
    });

    test(
        'builds medication search from the manual coordinates and parses availability',
        () async {
      Map<String, dynamic>? sentQuery;
      final care = PatientCareRepository(
        get: (path, {query}) async {
          expect(path, '/pharmacies/medication-search');
          sentQuery = query;
          return {
            'data': [
              {
                'medication_name': 'AHP_SYNTHETIC_TEST_MEDICATION',
                'stock_status': 'in_stock',
                'last_reported_at': '2026-10-01T12:00:00.000Z',
                'pharmacy': {
                  'name': 'AHP Synthetic Test Pharmacy',
                  'location': {'lat': 12.345, 'lng': 45.678},
                  'distance_km': 0,
                },
              },
            ],
          };
        },
      );
      final rows = await care.medicationAvailability(
        name: 'AHP_SYNTHETIC_TEST_MEDICATION',
        latitude: 12.345,
        longitude: 45.678,
      );
      expect(sentQuery, {
        'medication_name': 'AHP_SYNTHETIC_TEST_MEDICATION',
        'lat': 12.345,
        'lng': 45.678,
        'radius_km': 15,
      });
      expect(rows.single['stock_status'], 'in_stock');
      expect(rows.single['pharmacy']['name'], 'AHP Synthetic Test Pharmacy');
    });

    test('represents an empty pharmacy response as an empty result', () async {
      final care = PatientCareRepository(
        get: (path, {query}) async => {'data': <dynamic>[]},
      );
      expect(
        await care.medicationAvailability(
          name: 'AHP_SYNTHETIC_TEST_MEDICATION',
          latitude: 12.345,
          longitude: 45.678,
        ),
        isEmpty,
      );
    });

    test('preserves authorization errors from prescription reads', () async {
      final care = PatientCareRepository(
        get: (path, {query}) async => throw ApiException(
          403,
          'NOT_RESOURCE_OWNER',
          'You cannot view this prescription.',
        ),
      );
      await expectLater(
        care.prescriptions('another-patient'),
        throwsA(
          isA<ApiException>().having((e) => e.status, 'status', 403),
        ),
      );
    });
  });

  group('pharmacy availability states', () {
    testWidgets('shows empty result only after a successful empty search', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MedicationAvailabilityResults(
              rows: const [],
              searched: true,
              error: null,
              formatDate: (_) => '',
            ),
          ),
        ),
      );
      expect(
        find.text('Hakuna taarifa ya upatikanaji wa dawa hii kwa eneo hilo.'),
        findsOneWidget,
      );
    });

    testWidgets('shows populated synthetic pharmacy data', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MedicationAvailabilityResults(
              rows: [
                {
                  'medication_name': 'AHP_SYNTHETIC_TEST_MEDICATION',
                  'stock_status': 'in_stock',
                  'last_reported_at': '2026-10-01T12:00:00.000Z',
                  'pharmacy': {
                    'name': 'AHP Synthetic Test Pharmacy',
                    'distance_km': 0,
                  },
                },
              ],
              searched: true,
              error: null,
              formatDate: (_) => 'test time',
            ),
          ),
        ),
      );
      expect(
          find.textContaining('AHP_SYNTHETIC_TEST_MEDICATION'), findsOneWidget);
      expect(
          find.textContaining('AHP Synthetic Test Pharmacy'), findsOneWidget);
      expect(find.textContaining('in_stock'), findsOneWidget);
    });

    testWidgets('shows service errors instead of an empty result',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MedicationAvailabilityResults(
              rows: const [],
              searched: false,
              error: 'Service unavailable',
              formatDate: (_) => '',
            ),
          ),
        ),
      );
      expect(find.text('Service unavailable'), findsOneWidget);
      expect(
        find.text('Hakuna taarifa ya upatikanaji wa dawa hii kwa eneo hilo.'),
        findsNothing,
      );
    });
  });
}
