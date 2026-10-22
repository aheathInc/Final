import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/patient_ai.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/appointments_screen.dart';
import 'package:a_health_patient/screens/assistant_screen.dart';
import 'package:a_health_patient/screens/diagnostics_screen.dart';
import 'package:a_health_patient/screens/emergency_screen.dart';
import 'package:a_health_patient/screens/new_consultation_screen.dart';
import 'package:a_health_patient/screens/patient_care_medicines_screen.dart';
import 'package:a_health_patient/screens/privacy_consent_screen.dart';

Future<ApiException> _captureApiException(Future<dynamic> call) async {
  try {
    await call;
  } on ApiException catch (error) {
    return error;
  }
  fail('Expected the AI API request to be rejected.');
}

Future<Map<String, dynamic>> _createSyntheticPatient(String label) async {
  final suffix = Random.secure().nextInt(90000000) + 10000000;
  final registration = await Api.post(
    '/auth/register/patient',
    {
      'phone_number': '+2557$suffix',
      'full_name': 'AHP Synthetic Patient $label',
      'preferred_language': 'en',
      'channel': 'app',
    },
    idempotencyKey: PatientAiRepository.newIdempotencyKey('register-$label'),
  ) as Map;
  final challengeId = registration['challenge_id'];
  final devCode = registration['dev_code'];
  if (challengeId is! String || devCode is! String) {
    throw StateError('Local development OTP challenge was not returned.');
  }

  final session = await Api.post('/auth/otp/verify', {
    'challenge_id': challengeId,
    'code': devCode,
    'device_id': PatientAiRepository.newIdempotencyKey('device-$label'),
  }) as Map;
  final user = Map<String, dynamic>.from(session['user'] as Map);
  final accessToken = session['access_token'];
  final refreshToken = session['refresh_token'];
  if (accessToken is! String || refreshToken is! String) {
    throw StateError('Local development session was not returned.');
  }
  return {
    'access_token': accessToken,
    'refresh_token': refreshToken,
    'user': user,
  };
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'live Patient A navigation, unauthenticated rejection, and Patient B isolation',
    (tester) async {
      await tester.runAsync(() async {
        FlutterSecureStorage.setMockInitialValues({});
        final unauthenticated = await _captureApiException(
          Api.post(
            '/ai/conversations',
            {'audience': 'patient', 'language': 'sw', 'channel': 'app'},
            idempotencyKey:
                PatientAiRepository.newIdempotencyKey('unauth-test'),
          ),
        );
        expect(unauthenticated.status, 401);

        final patientA = await _createSyntheticPatient('A');
        await Session.save(
          accessToken: patientA['access_token'] as String,
          refreshToken: patientA['refresh_token'] as String,
          user: patientA['user'] as Map<String, dynamic>,
        );
        final repository = PatientAiRepository();
        final conversationId = await repository.openConversation(
          idempotencyKey: PatientAiRepository.newIdempotencyKey(
            'live-conversation',
          ),
        );
        final cases = <(String, String, Type)>[
          (
            'Help me manage an appointment.',
            'OPEN_APPOINTMENTS',
            AppointmentsScreen,
          ),
          (
            'I want to speak to a doctor.',
            'START_CONSULTATION',
            NewConsultationScreen,
          ),
          (
            'Where can I view my prescriptions?',
            'OPEN_MEDICATIONS',
            PatientCareMedicinesScreen,
          ),
          (
            'Where can I see my test results?',
            'OPEN_DIAGNOSTICS',
            DiagnosticsScreen,
          ),
          (
            'How do I manage access to my records?',
            'OPEN_PRIVACY',
            PrivacyConsentScreen,
          ),
          ('I have severe chest pain.', 'OPEN_EMERGENCY', EmergencyScreen),
        ];

        for (final (prompt, expectedCode, expectedType) in cases) {
          final reply = await repository.sendMessage(
            conversationId: conversationId,
            body: prompt,
            idempotencyKey:
                PatientAiRepository.newIdempotencyKey('live-message'),
          );
          expect(reply.action, patientNavigationActionFromCode(expectedCode));
          expect(reply.unsupportedAction, isFalse);
          if (expectedCode == 'OPEN_EMERGENCY') expect(reply.escalated, isTrue);
          expect(patientAiDestination(reply.action!), isA<Widget>());
          expect(patientAiDestination(reply.action!).runtimeType, expectedType);
        }

        final unsupported = await repository.sendMessage(
          conversationId: conversationId,
          body: 'unsupported navigation action fixture',
          idempotencyKey: PatientAiRepository.newIdempotencyKey('live-message'),
        );
        expect(unsupported.action, isNull);
        expect(unsupported.unsupportedAction, isTrue);

        final patientB = await _createSyntheticPatient('B');
        await Session.save(
          accessToken: patientB['access_token'] as String,
          refreshToken: patientB['refresh_token'] as String,
          user: patientB['user'] as Map<String, dynamic>,
        );
        final otherPatientRead = await _captureApiException(
          Api.get('/ai/conversations/$conversationId'),
        );
        expect(otherPatientRead.status, 403);
        await Session.clear();
      });
    },
  );
}
