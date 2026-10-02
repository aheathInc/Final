import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/patient_experience.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/education_screen.dart';
import 'package:a_health_patient/screens/emergency_screen.dart';
import 'package:a_health_patient/screens/family_screen.dart';
import 'package:a_health_patient/screens/screening_screen.dart';
import 'package:a_health_patient/screens/vaccinations_screen.dart';

Future<void> _livePause(WidgetTester tester) async {
  await Future<void>.delayed(const Duration(seconds: 5));
  await tester.pump();
}

// Using HttpClient() inside runZoned's createHttpClient callback recursively
// calls the same override. Inherit the platform implementation directly so
// this dedicated test uses real local HTTP without changing app networking.
class _LiveHttpOverrides extends HttpOverrides {}

void main() {
  final token = Platform.environment['AHP_FAMILY_ACCEPTANCE_PATIENT_TOKEN'];
  final refreshToken =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_PATIENT_REFRESH_TOKEN'];
  final profileId = Platform.environment['AHP_FAMILY_ACCEPTANCE_PROFILE_ID'];
  final familyId = Platform.environment['AHP_FAMILY_ACCEPTANCE_FAMILY_ID'];
  final familyName = Platform.environment['AHP_FAMILY_ACCEPTANCE_FAMILY_NAME'];
  final patientName =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_PATIENT_NAME'];
  final dependantName =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_DEPENDANT_NAME'];
  final dependantExists =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_DEPENDANT_EXISTS'] == 'true';
  final gpName = Platform.environment['AHP_FAMILY_ACCEPTANCE_GP_NAME'];
  final obgynName = Platform.environment['AHP_FAMILY_ACCEPTANCE_OBGYN_NAME'];
  final articleTitle =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_ARTICLE_TITLE'];
  final articleBody =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_ARTICLE_BODY'];
  final draftTitle = Platform.environment['AHP_FAMILY_ACCEPTANCE_DRAFT_TITLE'];
  final articleSlug =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_ARTICLE_SLUG'];
  final draftSlug = Platform.environment['AHP_FAMILY_ACCEPTANCE_DRAFT_SLUG'];
  final invitationId =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_INVITATION_ID'];
  final screeningAlreadyDeferred = Platform
          .environment['AHP_FAMILY_ACCEPTANCE_SCREENING_ALREADY_DEFERRED'] ==
      'true';
  final vaccineCode =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_VACCINE_CODE'];
  final evidencePath =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_EVIDENCE_PATH'] ?? '';
  final educationEmpty =
      Platform.environment['AHP_FAMILY_ACCEPTANCE_EDUCATION_EMPTY'] == 'true';

  testWidgets(
    'live patient family, published education, prevention and emergency journeys',
    (tester) async {
      await HttpOverrides.runWithHttpOverrides(
        () async {
          await tester.runAsync(() async {
            FlutterSecureStorage.setMockInitialValues({});
            await Session.save(
              accessToken: token!,
              refreshToken: refreshToken!,
              user: {
                'id': 'synthetic-acceptance-user',
                'role': 'patient',
                'full_name': patientName,
                'patient_profile_id': profileId,
              },
            );
            Api.diagnostic = (event, {int? status, String? errorType}) {
              if (event == 'HTTP_RESPONSE_RECEIVED' ||
                  event == 'HTTP_REQUEST_ERROR') {
                debugPrint(
                    'LIVE_API=$event status=${status ?? 'none'} type=${errorType ?? 'none'}');
              }
            };

            await tester.pumpWidget(const MaterialApp(home: FamilyScreen()));
            await _livePause(tester);
            expect(find.text(familyName!), findsOneWidget);
            expect(find.text(patientName!), findsOneWidget);
            expect(find.text('Aina: Mkuu wa familia'), findsOneWidget);
            if (!dependantExists) {
              await tester.tap(find.text('Ongeza mtegemezi'));
              await tester.pumpAndSettle();
              await tester.enterText(
                  find.byType(TextField).first, dependantName!);
              await tester.tap(find.text('Tarehe ya kuzaliwa'));
              await tester.pumpAndSettle();
              await tester.tap(find.text('OK'));
              await tester.pumpAndSettle();
              await tester.tap(find.byType(DropdownButtonFormField<String>));
              await tester.pumpAndSettle();
              await tester.tap(find.text('Mwanamke').last);
              await tester.pumpAndSettle();
              await tester.tap(find.text('Hifadhi'));
              await _livePause(tester);
            }
            expect(find.text(dependantName!), findsOneWidget);

            final dependantsResponse = await Api.get('/users/me/dependents');
            final createdDependant = (dependantsResponse['data'] as List)
                .cast<Map<String, dynamic>>()
                .singleWhere((row) => row['full_name'] == dependantName);
            final dependantId = createdDependant['id'] as String;
            await Api.post(
              '/families/$familyId/members',
              {'patient_profile_id': dependantId, 'relationship': 'child'},
              idempotencyKey: 'family-membership-$dependantId',
            );
            final familyRefresh = tester.widget<RefreshIndicator>(
              find.byType(RefreshIndicator),
            );
            await familyRefresh.onRefresh();
            await _livePause(tester);
            expect(find.text('Aina: Mtoto'), findsOneWidget);
            await tester.scrollUntilVisible(
              find.text(gpName!),
              300,
              scrollable: find.byType(Scrollable).first,
            );
            expect(find.text(gpName), findsOneWidget);
            await tester.scrollUntilVisible(
              find.text(obgynName!),
              300,
              scrollable: find.byType(Scrollable).first,
            );
            expect(find.text(obgynName), findsOneWidget);
            await tester.drag(
                find.byType(ListView).first, const Offset(0, 900));
            await tester.pumpAndSettle();
            await tester.tap(find.text(dependantName));
            await tester.pumpAndSettle();
            expect(find.text('Aina: Mtoto'), findsOneWidget);
            expect(find.textContaining('Rekodi zake za afya hazionyeshwi'),
                findsOneWidget);
            Navigator.of(tester.element(find.text('Muhtasari wa mwanafamilia')))
                .pop();
            await tester.pumpAndSettle();

            final educationLoaded = Completer<void>();
            await tester.pumpWidget(MaterialApp(
              home: EducationScreen(
                  onDiagnostic: (event, {int? status, String? errorType}) {
                if (event == 'STATE_ERROR') {
                  debugPrint('EDUCATION_STATE_ERROR_TYPE=$errorType');
                  debugPrint('EDUCATION_HTTP_STATUS=${status ?? 'none'}');
                }
                if (event == 'STATE_SUCCESS') {
                  debugPrint('EDUCATION_STATE_SUCCESS=true');
                }
                if ((event == 'STATE_SUCCESS' || event == 'STATE_ERROR') &&
                    !educationLoaded.isCompleted) {
                  educationLoaded.complete();
                }
              }),
            ));
            await educationLoaded.future.timeout(const Duration(seconds: 25));
            await tester.pump();
            if (articleTitle != null &&
                draftTitle != null &&
                articleSlug != null &&
                draftSlug != null &&
                articleBody != null) {
              expect(find.text(articleTitle), findsOneWidget);
              expect(find.text(draftTitle), findsNothing);
              await tester.tap(find.text(articleTitle));
              await _livePause(tester);
              expect(find.text(articleBody), findsOneWidget);
              var draftStatus = 200;
              try {
                await Api.get('/education/articles/$draftSlug',
                    query: {'language': 'en'});
              } on ApiException catch (error) {
                draftStatus = error.status;
              }
              expect(draftStatus, 404);
              Navigator.of(tester.element(find.text(articleTitle))).pop();
              await tester.pumpAndSettle();
              await tester.pumpAndSettle();
            } else {
              expect(educationEmpty, isTrue);
              expect(find.text('Hakuna makala zilizochapishwa kwa sasa.'),
                  findsOneWidget);
            }

            await tester.pumpWidget(const MaterialApp(home: ScreeningScreen()));
            await _livePause(tester);
            expect(
              find.textContaining(screeningAlreadyDeferred
                  ? 'Hali: deferred'
                  : 'Hali: pending'),
              findsOneWidget,
            );
            expect(find.textContaining('Ulipokea:'), findsOneWidget);
            expect(find.text('Alama hizi si utambuzi wa ugonjwa.'),
                findsOneWidget);
            expect(find.textContaining('Alama ya huduma:'), findsOneWidget);
            if (!screeningAlreadyDeferred) {
              await tester.tap(find.text('Baadaye'));
              await _livePause(tester);
            }
            expect(find.textContaining('Hali: deferred'), findsOneWidget);

            await tester
                .pumpWidget(const MaterialApp(home: VaccinationsScreen()));
            await _livePause(tester);
            expect(find.textContaining(vaccineCode!), findsOneWidget);

            await tester.pumpWidget(const MaterialApp(home: EmergencyScreen()));
            await tester.pumpAndSettle();
            final emergencyMarker = File(
              '${File(evidencePath).parent.path}/patient-a-emergency-request.json',
            );
            late Map<String, dynamic> emergency;
            if (emergencyMarker.existsSync()) {
              final saved = jsonDecode(emergencyMarker.readAsStringSync())
                  as Map<String, dynamic>;
              emergency = emergencyRequestFromJson(
                await Api.get('/emergency-requests/${saved['id']}'),
              );
            } else {
              emergency = emergencyRequestFromJson(await Api.post(
                '/emergency-requests',
                emergencyRequestBody(
                  category: 'medical',
                  latitude: 12.3456,
                  longitude: 45.6789,
                ),
                idempotencyKey: 'patient-family-emergency-$profileId',
              ));
              emergencyMarker.parent.createSync(recursive: true);
              emergencyMarker.writeAsStringSync(jsonEncode({
                'id': emergency['id'],
                'status': emergency['status'],
                'coordinates': 'synthetic_manual_nonzero',
              }));
            }
            final requestId = emergency['id'] as String;
            final emergencyReadback = emergencyRequestFromJson(
              await Api.get('/emergency-requests/$requestId'),
            );
            expect(emergencyReadback['status'], 'reported');
            await tester.scrollUntilVisible(
              find.byKey(const Key('emergency-request-id')),
              200,
              scrollable: find.byType(Scrollable).first,
            );
            await tester.enterText(
              find.byKey(const Key('emergency-request-id')),
              requestId,
            );
            await tester.tap(find.text('Angalia hali'));
            await _livePause(tester);
            expect(find.textContaining('Hali: reported'), findsOneWidget);
            await tester.tap(find.text('Soma hali tena'));
            await _livePause(tester);
            expect(find.text('Namba ya ombi: $requestId'), findsOneWidget);
            expect(find.text('Hali: reported'), findsOneWidget);

            if (evidencePath.isNotEmpty) {
              final riskResponse =
                  await Api.get('/patient-profiles/$profileId/risk-scores');
              final riskRows =
                  (riskResponse['data'] as List).cast<Map<String, dynamic>>();
              final risk = riskRows.singleWhere(
                  (row) => row['condition_code'] == 'hypertension');
              final evidence = File(evidencePath);
              evidence.parent.createSync(recursive: true);
              evidence.writeAsStringSync(jsonEncode({
                'family': {
                  'id': familyId,
                  'profile_id': profileId,
                  'dependant_profile_id': dependantId,
                  'relationship': 'child'
                },
                'education': {
                  'slug': articleSlug,
                  'published': articleTitle != null,
                  'draft_slug': draftSlug,
                  'draft_unavailable': articleTitle != null,
                  'empty_state': educationEmpty
                },
                'screening': {
                  'id': invitationId,
                  'status_after_response': 'deferred'
                },
                'vaccination': {'vaccine_code': vaccineCode, 'read': true},
                'risk_score': {
                  'id': risk['id'],
                  'condition_code': risk['condition_code'],
                  'score': risk['score'],
                  'band': risk['band']
                },
                'emergency': {
                  'id': requestId,
                  'status': 'reported',
                  'coordinates': 'synthetic_manual_nonzero'
                },
              }));
            }
            Api.diagnostic = null;
          });
        },
        _LiveHttpOverrides(),
      );
    },
    skip: token == null ||
        profileId == null ||
        familyId == null ||
        familyName == null ||
        patientName == null ||
        refreshToken == null ||
        dependantName == null ||
        gpName == null ||
        obgynName == null ||
        invitationId == null ||
        evidencePath.isEmpty ||
        vaccineCode == null ||
        (articleTitle == null && !educationEmpty),
  );
}
