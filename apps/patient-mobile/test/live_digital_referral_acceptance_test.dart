import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/referrals_screen.dart';

class _LiveHttpOverrides extends HttpOverrides {}

void _trace(String message) {
  final line = '[patient-b-referral] $message';
  stderr.writeln(line);
  final path = Platform.environment['AHP_DIGITAL_REFERRAL_EVIDENCE_FILE'];
  if (path == null || path.isEmpty) {
    throw StateError('AHP_DIGITAL_REFERRAL_EVIDENCE_FILE is required.');
  }
  final file = File(path);
  if (!file.isAbsolute) {
    throw StateError('The acceptance evidence path must be absolute.');
  }
  file.parent.createSync(recursive: true);
  file.writeAsStringSync('$line\n', mode: FileMode.append, flush: true);
}

void _traceFailure({
  required String testName,
  required String stage,
  required Object error,
  required StackTrace stack,
}) {
  _trace('test_name=$testName');
  _trace('failure_stage=$stage exception_type=${error.runtimeType}');
  final frames = stack
      .toString()
      .split('\n')
      .where((line) =>
          line.contains('live_digital_referral_acceptance_test.dart') ||
          line.contains('referrals_screen.dart') ||
          line.contains('api.dart'))
      .take(8);
  for (final frame in frames) {
    _trace('sanitized_stack_frame=${frame.trim()}');
  }
}

void main() {
  final env = Platform.environment;
  final diagnosticProbeEnabled =
      env['AHP_DIGITAL_REFERRAL_DIAGNOSTIC_PROBE'] == 'true';
  final patientBToken = env['AHP_DIGITAL_REFERRAL_PATIENT_B_TOKEN'];
  final patientBRefresh = env['AHP_DIGITAL_REFERRAL_PATIENT_B_REFRESH_TOKEN'];
  final patientBUserId = env['AHP_DIGITAL_REFERRAL_PATIENT_B_USER_ID'];
  final patientBProfileId = env['AHP_DIGITAL_REFERRAL_PATIENT_B_PROFILE_ID'];
  final consultationId = env['AHP_DIGITAL_REFERRAL_CONSULTATION_ID'];
  final referralId = env['AHP_DIGITAL_REFERRAL_REFERRAL_ID'];
  final ready = [
    patientBToken,
    patientBRefresh,
    patientBUserId,
    patientBProfileId,
    consultationId,
    referralId,
  ].every((value) => value != null && value.isNotEmpty);

  testWidgets(
    'diagnostic capture probe records a controlled synthetic UI failure',
    (tester) async {
      const testName =
          'diagnostic capture probe records a controlled synthetic UI failure';
      const stage = 'synthetic_referral_empty_state';
      const expectedUiState = 'authorized_empty_visible=true';
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: Text('Synthetic API error state')),
      ));
      await tester.runAsync(() async {
        final emptyStateVisible =
            find.text('Synthetic authorized empty state').evaluate().isNotEmpty;
        final actualUiState = 'authorized_empty_visible=$emptyStateVisible';
        _trace('test_name=$testName');
        _trace('acceptance_step=$stage http_status=none');
        _trace(
          'expected_ui_state=$expectedUiState actual_ui_state=$actualUiState',
        );
        try {
          expect(emptyStateVisible, isTrue,
              reason: 'synthetic diagnostic capture probe');
        } catch (error, stack) {
          _traceFailure(
            testName: testName,
            stage: stage,
            error: error,
            stack: stack,
          );
          rethrow;
        }
      });
    },
    skip: !diagnosticProbeEnabled,
  );

  testWidgets(
      'Patient B cannot list or directly read Patient A referral and stale UI is cleared',
      (tester) async {
    var stage = 'initializing';
    _trace('run_started');
    Api.diagnostic = (event, {status, errorType}) {
      _trace(
        'api_event=$event http_status=${status ?? 'none'} exception_type=${errorType ?? 'none'}',
      );
    };
    try {
      await HttpOverrides.runWithHttpOverrides(() async {
        await tester.runAsync(() async {
          FlutterSecureStorage.setMockInitialValues({});

          // Model a previously mounted Patient A referral detail, then the app's
          // real sign-out/account-switch flow, which removes the old route tree.
          stage = 'synthetic_previous_account_ui';
          const staleDestination = 'PATIENT_A_PRIVATE_DESTINATION_DO_NOT_LEAK';
          const staleInstruction = 'PATIENT_A_PRIVATE_INSTRUCTION_DO_NOT_LEAK';
          await tester.pumpWidget(MaterialApp(
            home: ReferralsScreen(
                loadReferrals: () async => [
                      {
                        'id': referralId,
                        'consultation_id': consultationId,
                        'status': 'completed',
                        'purpose': 'Synthetic prior account record',
                        'source': {
                          'facility': {'name': 'Patient A source fixture'}
                        },
                        'destination': {
                          'facility': {'name': staleDestination}
                        },
                        'outcome': {'patient_instructions': staleInstruction},
                      },
                    ]),
          ));
          await tester.pumpAndSettle();
          await tester.tap(find.byType(ExpansionTile));
          await tester.pumpAndSettle();
          expect(find.text(staleDestination), findsWidgets);
          expect(find.text(staleInstruction), findsOneWidget);

          await tester.pumpWidget(const SizedBox.shrink());
          await tester.pump();
          await Session.clear();
          await Session.save(
            accessToken: patientBToken!,
            refreshToken: patientBRefresh!,
            user: {
              'id': patientBUserId,
              'role': 'patient',
              'patient_profile_id': patientBProfileId,
            },
          );

          stage = 'patient_b_referral_list_api';
          final response = await Api.get('/referrals');
          final rows = (response['data'] as List).cast<Map<String, dynamic>>();
          final targetReferralPresent =
              rows.any((row) => row['id'] == referralId);
          final targetConsultationPresent =
              rows.any((row) => row['consultation_id'] == consultationId);
          _trace(
            'stage=list_response count=${rows.length} target_referral_present=$targetReferralPresent target_consultation_present=$targetConsultationPresent',
          );
          expect(targetReferralPresent, isFalse);
          expect(targetConsultationPresent, isFalse);

          stage = 'patient_a_referral_direct_id';
          var directReadRejected = false;
          var directReadStatus = 0;
          var directReadCode = 'none';
          try {
            await Api.get('/referrals/$referralId');
          } on ApiException catch (error) {
            directReadStatus = error.status;
            directReadCode = error.code ?? 'none';
            directReadRejected =
                error.status == 403 && error.code == 'NOT_RESOURCE_OWNER';
          }
          _trace(
            'stage=direct_id_result status=$directReadStatus error_code=$directReadCode rejected=$directReadRejected',
          );
          expect(directReadRejected, isTrue);

          stage = 'patient_b_referral_screen';
          await tester.pumpWidget(const MaterialApp(home: ReferralsScreen()));
          await Future<void>.delayed(const Duration(milliseconds: 500));
          await tester.pumpAndSettle();
          _trace(
            'stage=screen_state loading=${find.byType(CircularProgressIndicator).evaluate().isNotEmpty} row_count=${find.byType(ExpansionTile).evaluate().length} error_visible=${find.text('Rufaa hazikuweza kusomwa. Jaribu tena.').evaluate().isNotEmpty} empty_visible=${find.textContaining('Bado hakuna rufaa').evaluate().isNotEmpty}',
          );
          expect(find.text('Rufaa Zangu'), findsOneWidget);
          expect(find.byType(CircularProgressIndicator), findsNothing);
          expect(find.byType(ExpansionTile), findsNWidgets(rows.length));
          expect(
            find.textContaining('Bado hakuna rufaa').evaluate().isNotEmpty,
            rows.isEmpty,
          );
          expect(find.text(staleDestination), findsNothing);
          expect(find.text(staleInstruction), findsNothing);

          final ownDestinationNames = rows
              .map((row) => row['destination'])
              .whereType<Map>()
              .map((destination) => destination['facility'])
              .whereType<Map>()
              .map((facility) => facility['name'])
              .whereType<String>()
              .toSet();
          for (final name in ownDestinationNames) {
            expect(find.text(name), findsWidgets);
          }
          stage = 'passed';
        });
      }, _LiveHttpOverrides());
    } catch (error, stack) {
      _traceFailure(
        testName:
            'Patient B cannot list or directly read Patient A referral and stale UI is cleared',
        stage: stage,
        error: error,
        stack: stack,
      );
      rethrow;
    } finally {
      Api.diagnostic = null;
    }
  }, skip: !ready);
}
