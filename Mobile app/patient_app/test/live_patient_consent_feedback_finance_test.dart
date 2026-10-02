import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/consent_feedback_finance.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/feedback_screen.dart';
import 'package:a_health_patient/screens/insurance_payments_screen.dart';
import 'package:a_health_patient/screens/privacy_consent_screen.dart';

class _LiveHttpOverrides extends HttpOverrides {}

Future<ApiException> _captureApiException(Future<dynamic> call) async {
  try {
    await call;
  } on ApiException catch (error) {
    return error;
  }
  fail('Expected the live API to reject this request.');
}

void main() {
  final env = Platform.environment;
  final patientAToken = env['AHP_CFF_PATIENT_TOKEN'];
  final patientARefresh = env['AHP_CFF_PATIENT_REFRESH_TOKEN'];
  final patientAUserId = env['AHP_CFF_PATIENT_USER_ID'];
  final patientAProfileId = env['AHP_CFF_PATIENT_PROFILE_ID'];
  final patientAName = env['AHP_CFF_PATIENT_NAME'];
  final patientBToken = env['AHP_CFF_PATIENT_B_TOKEN'];
  final patientBRefresh = env['AHP_CFF_PATIENT_B_REFRESH_TOKEN'];
  final patientBUserId = env['AHP_CFF_PATIENT_B_USER_ID'];
  final patientBProfileId = env['AHP_CFF_PATIENT_B_PROFILE_ID'];
  final granteeClinicianId = env['AHP_CFF_GRANTEE_CLINICIAN_ID'];
  final careThreadId = env['AHP_CFF_CARE_THREAD_ID'];
  final consultationId = env['AHP_CFF_COMPLETED_CONSULTATION_ID'];
  final incompleteConsultationId = env['AHP_CFF_INCOMPLETE_CONSULTATION_ID'];
  final claimId = env['AHP_CFF_CLAIM_ID'];
  final paymentId = env['AHP_CFF_PAYMENT_ID'];
  final paymentIntentId = env['AHP_CFF_PAYMENT_INTENT_ID'];
  final schemeId = env['AHP_CFF_SCHEME_ID'];
  final incidentDescription = env['AHP_CFF_INCIDENT_DESCRIPTION'];
  final resultPath = env['AHP_CFF_RESULT_PATH'];

  final ready = [
    patientAToken,
    patientARefresh,
    patientAUserId,
    patientAProfileId,
    patientAName,
    patientBToken,
    patientBRefresh,
    patientBUserId,
    patientBProfileId,
    granteeClinicianId,
    careThreadId,
    consultationId,
    incompleteConsultationId,
    claimId,
    paymentId,
    paymentIntentId,
    schemeId,
    incidentDescription,
    resultPath,
  ].every((value) => value != null && value.isNotEmpty);

  testWidgets(
    'live Patient A consent, feedback, insurance and payment acceptance',
    (tester) async {
      await HttpOverrides.runWithHttpOverrides(
        () async {
          await tester.runAsync(() async {
            FlutterSecureStorage.setMockInitialValues({});
            await Session.save(
              accessToken: patientAToken!,
              refreshToken: patientARefresh!,
              user: {
                'id': patientAUserId,
                'role': 'patient',
                'full_name': patientAName,
                'patient_profile_id': patientAProfileId,
              },
            );
            final repository = ConsentFeedbackFinanceRepository();
            final resultsFile = File(resultPath!);
            final progress = resultsFile.existsSync()
                ? Map<String, dynamic>.from(
                    jsonDecode(resultsFile.readAsStringSync()) as Map,
                  )
                : <String, dynamic>{};

            // Exercise grant, read-back, revoke and refresh through the
            // production repository, then confirm the real screen retains the
            // revoked record after loading again.
            final priorConsentRows =
                await repository.consents(patientAProfileId!);
            final matchingConsents = priorConsentRows.where((row) =>
                row['grantee_clinician_id'] == granteeClinicianId &&
                row['care_thread_id'] == careThreadId &&
                row['reason'] == 'AHP synthetic acceptance only.');
            late Map<String, dynamic> consent;
            if (matchingConsents.isEmpty) {
              consent = await repository.grantConsent(patientAProfileId, {
                'grantee_type': 'clinician',
                'grantee_clinician_id': granteeClinicianId,
                'care_thread_id': careThreadId,
                'scope': 'current_thread',
                'reason': 'AHP synthetic acceptance only.',
              });
              expect(consent['status'], 'active');
            } else {
              consent = matchingConsents.last;
            }
            if (consent['status'] != 'revoked') {
              consent = await repository.revokeConsent(
                patientAProfileId,
                consent['id'] as String,
              );
            }
            expect(consent['status'], 'revoked');
            final consentRows = await repository.consents(patientAProfileId);
            consent =
                consentRows.singleWhere((row) => row['id'] == consent['id']);
            expect(consent['status'], 'revoked');
            progress['consent_id'] = consent['id'];
            resultsFile.writeAsStringSync(jsonEncode(progress));

            await tester.pumpWidget(
              const MaterialApp(home: PrivacyConsentScreen()),
            );
            await Future<void>.delayed(const Duration(milliseconds: 700));
            await tester.pump();
            expect(find.text('Hali: revoked'), findsOneWidget);

            final invalidScope = await _captureApiException(Api.post(
              '/patient-profiles/$patientAProfileId/consents',
              {
                'grantee_type': 'clinician',
                'grantee_clinician_id': granteeClinicianId,
                'scope': 'unsupported_acceptance_scope',
                'reason': 'AHP synthetic acceptance only.',
              },
              idempotencyKey:
                  'ahp-cff-invalid-scope-${DateTime.now().toUtc().microsecondsSinceEpoch}',
            ));
            expect(invalidScope.status, 422);

            // Submit a valid rating through the production repository, then
            // verify duplicate and incomplete-state protections on the same
            // service. The ID is stored locally as progress for safe resume.
            if (progress['rating_id'] == null) {
              final rating = await repository.rateConsultation(
                consultationId!,
                score: 5,
                comment: 'Synthetic feedback acceptance; no clinical content.',
              );
              progress['rating_id'] = rating['id'];
              resultsFile.writeAsStringSync(jsonEncode(progress));
            }

            final duplicate = await _captureApiException(
              repository.rateConsultation(consultationId!, score: 4),
            );
            expect(duplicate.code, 'ALREADY_RATED');
            final incomplete = await _captureApiException(
              repository.rateConsultation(incompleteConsultationId!, score: 4),
            );
            expect(incomplete.status, 409);

            // Submit the synthetic complaint from the real Flutter form and
            // verify that the UI shows the returned persisted reference.
            var incidentId = progress['incident_id'] as String?;
            if (incidentId == null) {
              await tester.pumpWidget(MaterialApp(
                home: FeedbackScreen(initialConsultationId: consultationId),
              ));
              await Future<void>.delayed(const Duration(milliseconds: 600));
              await tester.pump();
              for (var i = 0; i < 6; i++) {
                await tester.dragFrom(
                  const Offset(400, 520),
                  const Offset(0, -420),
                );
                await tester.pumpAndSettle();
              }
              await tester.pumpAndSettle();
              final descriptionField = find.byType(TextField).last;
              await tester.ensureVisible(descriptionField);
              await tester.enterText(descriptionField, incidentDescription!);
              await tester.pump();
              final submitButton = find.text('Hifadhi ripoti');
              await tester.ensureVisible(submitButton);
              await tester.tap(submitButton);
              await Future<void>.delayed(const Duration(seconds: 1));
              await tester.pump();
              expect(
                find.text('Ripoti imehifadhiwa na huduma.'),
                findsOneWidget,
              );
              final referenceFinder = find.byWidgetPredicate(
                (widget) =>
                    widget is Text && (widget.data ?? '').startsWith('Rejea: '),
              );
              expect(referenceFinder, findsOneWidget);
              incidentId = (tester.widget<Text>(referenceFinder).data ?? '')
                  .replaceFirst('Rejea: ', '');
              expect(incidentId, isNotEmpty);
              expect(find.text('Hali: reported'), findsOneWidget);
              progress['incident_id'] = incidentId;
              resultsFile.writeAsStringSync(jsonEncode(progress));
            }

            // Real persisted insurance, claim and payment reads render in the
            // production screen and retain the same record IDs on a second read.
            await tester.pumpWidget(
              const MaterialApp(home: InsurancePaymentsScreen()),
            );
            for (var i = 0;
                i < 40 &&
                    find
                        .byType(CircularProgressIndicator)
                        .evaluate()
                        .isNotEmpty;
                i++) {
              await Future<void>.delayed(const Duration(milliseconds: 100));
              await tester.pump();
            }
            for (var i = 0; i < 6; i++) {
              await tester.dragFrom(
                const Offset(400, 520),
                const Offset(0, -420),
              );
              await tester.pump(const Duration(milliseconds: 250));
            }
            final paymentAmountText = find.textContaining('1250');
            for (var i = 0;
                i < 20 && paymentAmountText.evaluate().isEmpty;
                i++) {
              await Future<void>.delayed(const Duration(milliseconds: 100));
              await tester.pump();
            }
            expect(find.text('Bima na malipo'), findsOneWidget);
            final coverage = await repository.coverage();
            expect(coverage['patient_profile_id'], patientAProfileId);
            expect((coverage['schemes'] as List).single['scheme_id'], schemeId);
            final claims = await repository.claims();
            expect(claims.single['id'], claimId);
            expect(claims.single['status'], 'submitted');
            final payments = await repository.payments();
            final patientPayment =
                payments.singleWhere((row) => row['id'] == paymentId);
            expect(
              find.text(
                '${patientPayment['amount']} ${patientPayment['currency']}',
              ),
              findsOneWidget,
            );
            expect(find.textContaining('submitted'), findsOneWidget);
            expect(
              find.text('Hali: ${patientPayment['status']}'),
              findsOneWidget,
            );
            expect((await repository.claims()).single['id'], claimId);
            expect(
                (await repository.payments())
                    .any((row) => row['id'] == paymentId),
                isTrue);

            final patientClaimSubmission = await _captureApiException(Api.post(
              '/insurance/claims',
              {'consultation_id': consultationId, 'scheme_id': schemeId},
              idempotencyKey:
                  'ahp-cff-patient-claim-${DateTime.now().toUtc().microsecondsSinceEpoch}',
            ));
            expect(patientClaimSubmission.status, 403);
            final patientRefund = await _captureApiException(Api.post(
              '/payments/$paymentId/refund',
              {'reason': 'Synthetic patient authorization check'},
              idempotencyKey:
                  'ahp-cff-patient-refund-${DateTime.now().toUtc().microsecondsSinceEpoch}',
            ));
            expect(patientRefund.status, 403);

            // Patient B uses a separate legitimate OTP session. Every attempt
            // to reach Patient A's records is checked against the live API.
            await Session.save(
              accessToken: patientBToken!,
              refreshToken: patientBRefresh!,
              user: {
                'id': patientBUserId,
                'role': 'patient',
                'full_name': 'AHP Synthetic Patient B',
                'patient_profile_id': patientBProfileId,
              },
            );
            final consentAccess = await _captureApiException(
              repository.consents(patientAProfileId),
            );
            expect(consentAccess.status, anyOf(403, 404));
            final grantAccess = await _captureApiException(Api.post(
              '/patient-profiles/$patientAProfileId/consents',
              {
                'grantee_type': 'clinician',
                'grantee_clinician_id': granteeClinicianId,
                'care_thread_id': careThreadId,
                'scope': 'current_thread',
                'reason': 'AHP Patient B ownership rejection test.',
              },
              idempotencyKey:
                  'ahp-cff-patient-b-grant-${DateTime.now().toUtc().microsecondsSinceEpoch}',
            ));
            expect(grantAccess.status, anyOf(403, 404));
            final revokeAccess = await _captureApiException(Api.post(
              '/patient-profiles/$patientAProfileId/consents/${consent['id']}/revoke',
              {},
              idempotencyKey:
                  'ahp-cff-patient-b-revoke-${DateTime.now().toUtc().microsecondsSinceEpoch}',
            ));
            expect(revokeAccess.status, anyOf(403, 404));
            final coverageAccess = await _captureApiException(Api.get(
              '/insurance/coverage',
              query: {'patient_profile_id': patientAProfileId},
            ));
            expect(coverageAccess.status, 403);
            final otherClaims = await repository.claims();
            expect(otherClaims.any((row) => row['id'] == claimId), isFalse);
            final otherPayments = await repository.payments();
            expect(otherPayments.any((row) => row['id'] == paymentId), isFalse);
            final intentAccess = await _captureApiException(
              Api.get('/payments/intents/$paymentIntentId'),
            );
            expect(intentAccess.status, 403);
            final cancelAccess = await _captureApiException(Api.post(
              '/payments/intents/$paymentIntentId/cancel',
              {},
              idempotencyKey:
                  'ahp-cff-patient-b-cancel-${DateTime.now().toUtc().microsecondsSinceEpoch}',
            ));
            expect(cancelAccess.status, 403);
            final ratingAccess = await _captureApiException(
              repository.rateConsultation(consultationId, score: 3),
            );
            expect(ratingAccess.status, 403);
            final incidentListAccess = await _captureApiException(
              Api.get('/incident-reports'),
            );
            expect(incidentListAccess.status, 403);

            progress['incident_id'] = incidentId;
            resultsFile.writeAsStringSync(jsonEncode(progress));
          });
        },
        _LiveHttpOverrides(),
      );
    },
    skip: !ready,
  );
}
