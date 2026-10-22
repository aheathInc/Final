import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/patient_ai.dart';
import 'package:a_health_patient/screens/appointments_screen.dart';
import 'package:a_health_patient/screens/assistant_screen.dart';
import 'package:a_health_patient/screens/diagnostics_screen.dart';
import 'package:a_health_patient/screens/facility_browser_screen.dart';
import 'package:a_health_patient/screens/emergency_screen.dart';
import 'package:a_health_patient/screens/new_consultation_screen.dart';
import 'package:a_health_patient/screens/patient_care_medicines_screen.dart';
import 'package:a_health_patient/screens/privacy_consent_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _conversationId = '123e4567-e89b-42d3-a456-426614174000';

class _FakeAiClient implements PatientAiClient {
  _FakeAiClient(this.reply);

  final Future<PatientAiReply> Function() reply;
  int opens = 0;
  int sends = 0;
  final keys = <String>[];

  @override
  Future<String> openConversation({required String idempotencyKey}) async {
    opens++;
    keys.add(idempotencyKey);
    return _conversationId;
  }

  @override
  Future<PatientAiReply> sendMessage({
    required String conversationId,
    required String body,
    required String idempotencyKey,
  }) async {
    expect(conversationId, _conversationId);
    expect(body, isNotEmpty);
    sends++;
    keys.add(idempotencyKey);
    return reply();
  }
}

class _PushObserver extends NavigatorObserver {
  Route<dynamic>? pushedRoute;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushedRoute = route;
  }
}

PatientAiReply _reply(String? action, {bool escalated = false}) =>
    PatientAiReply.fromJson({
      'id': 'reply-id',
      'role': 'assistant',
      'body': 'Naweza kukuonyesha huduma husika.',
      'escalated': escalated,
      'navigation_action': action,
    });

void main() {
  group('AI reply parser and navigation allowlist', () {
    test(
      'sends only patient audience and current-session message to existing API',
      () async {
        final calls = <(String, Map<String, dynamic>, String?)>[];
        final repository = PatientAiRepository(
          post: (path, body, {idempotencyKey}) async {
            calls.add((path, body, idempotencyKey));
            if (path == '/ai/conversations') return {'id': _conversationId};
            return {
              'id': 'reply-id',
              'role': 'assistant',
              'body': 'Open appointments.',
              'navigation_action': 'OPEN_APPOINTMENTS',
              'escalated': false,
            };
          },
        );
        final conversationId = await repository.openConversation(
          idempotencyKey: 'conversation-key',
        );
        final reply = await repository.sendMessage(
          conversationId: conversationId,
          body: '  Help me with an appointment.  ',
          idempotencyKey: 'message-key',
        );

        expect(calls[0].$1, '/ai/conversations');
        expect(calls[0].$2, {
          'audience': 'patient',
          'language': 'sw',
          'channel': 'app',
        });
        expect(calls[0].$3, 'conversation-key');
        expect(calls[1].$1, '/ai/conversations/$_conversationId/messages');
        expect(calls[1].$2, {'body': 'Help me with an appointment.'});
        expect(calls[1].$3, 'message-key');
        expect(reply.action, PatientNavigationAction.openAppointments);
      },
    );

    test('parses assistant text and an allowlisted appointment action', () {
      final parsed = _reply('OPEN_APPOINTMENTS');
      expect(parsed.body, contains('huduma'));
      expect(parsed.action, PatientNavigationAction.openAppointments);
      expect(parsed.unsupportedAction, isFalse);
    });

    test('unknown action is rejected and cannot create a destination', () {
      final parsed = _reply('OPEN_ADMIN_DASHBOARD');
      expect(parsed.action, isNull);
      expect(parsed.unsupportedAction, isTrue);
      expect(patientNavigationActionFromCode('OPEN_ADMIN_DASHBOARD'), isNull);
    });

    test(
      'escalation always maps to patient-confirmed Emergency navigation',
      () {
        final parsed = _reply(null, escalated: true);
        expect(parsed.escalated, isTrue);
        expect(parsed.action, PatientNavigationAction.openEmergency);
      },
    );

    test('rejects malformed assistant replies', () {
      expect(
        () => PatientAiReply.fromJson({
          'role': 'user',
          'body': 'not an assistant',
        }),
        throwsFormatException,
      );
    });
  });

  group('existing Patient destinations', () {
    test('appointment request opens the existing appointments screen', () {
      expect(
        patientAiDestination(PatientNavigationAction.openAppointments),
        isA<AppointmentsScreen>(),
      );
    });

    test(
      'consultation request opens the existing patient consultation flow',
      () {
        expect(
          patientAiDestination(PatientNavigationAction.startConsultation),
          isA<NewConsultationScreen>(),
        );
      },
    );

    test('medication request opens existing prescriptions and pharmacy UI', () {
      expect(
        patientAiDestination(PatientNavigationAction.openMedications),
        isA<PatientCareMedicinesScreen>(),
      );
      expect(
        patientAiDestination(PatientNavigationAction.openPharmacy),
        isA<PatientCareMedicinesScreen>(),
      );
    });

    test('diagnostics request opens the existing diagnostics screen', () {
      expect(
        patientAiDestination(PatientNavigationAction.openDiagnostics),
        isA<DiagnosticsScreen>(),
      );
    });

    test('privacy request opens the existing consent screen', () {
      expect(
        patientAiDestination(PatientNavigationAction.openPrivacy),
        isA<PrivacyConsentScreen>(),
      );
    });

    test('emergency request opens the existing SOS screen only', () {
      expect(
        patientAiDestination(PatientNavigationAction.openEmergency),
        isA<EmergencyScreen>(),
      );
    });

    test(
      'every supported destination maps to a fixed existing Patient screen',
      () {
        for (final action in PatientNavigationAction.values) {
          expect(patientAiActionCode(action), isNotEmpty);
          expect(patientAiDestination(action), isA<Widget>());
          expect(patientAiActionLabel(action), isNotEmpty);
        }
        expect(
          patientAiDestination(PatientNavigationAction.openDoctors),
          isA<FacilityBrowserScreen>(),
        );
      },
    );
  });

  group('Assistant screen states', () {
    testWidgets(
      'shows separate patient and assistant messages and an action button',
      (tester) async {
        final client = _FakeAiClient(() async => _reply('OPEN_APPOINTMENTS'));
        await tester.pumpWidget(
          MaterialApp(home: AssistantScreen(client: client)),
        );
        await tester.enterText(
          find.byType(TextField),
          'Help with my appointment',
        );
        await tester.tap(find.byTooltip('Tuma swali'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 250));

        expect(find.text('Wewe'), findsOneWidget);
        expect(find.text('Msaidizi wa AI (LOCAL/STUB)'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('assistant-action-OPEN_APPOINTMENTS')),
          findsOneWidget,
        );
        expect(client.opens, 1);
        expect(client.sends, 1);
      },
    );

    testWidgets('tapping an allowlisted suggestion opens its fixed screen', (
      tester,
    ) async {
      final observer = _PushObserver();
      final client = _FakeAiClient(() async => _reply('OPEN_APPOINTMENTS'));
      await tester.pumpWidget(
        MaterialApp(
          navigatorObservers: [observer],
          home: AssistantScreen(client: client),
        ),
      );
      await tester.enterText(find.byType(TextField), 'Show my appointments');
      await tester.tap(find.byTooltip('Tuma swali'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));
      await tester.tap(
        find.byKey(const ValueKey('assistant-action-OPEN_APPOINTMENTS')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(
        observer.pushedRoute?.settings.name,
        '/patient/ai/OPEN_APPOINTMENTS',
      );
      expect(find.byType(AppointmentsScreen), findsOneWidget);
    });

    testWidgets('emergency suggestion opens SOS only after patient tap', (
      tester,
    ) async {
      final observer = _PushObserver();
      final client = _FakeAiClient(
        () async => _reply('OPEN_EMERGENCY', escalated: true),
      );
      await tester.pumpWidget(
        MaterialApp(
          navigatorObservers: [observer],
          home: AssistantScreen(client: client),
        ),
      );
      await tester.enterText(find.byType(TextField), 'I need urgent help');
      await tester.tap(find.byTooltip('Tuma swali'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(
        find.textContaining('SOS haitatumwa hadi uchague hatua hiyo'),
        findsOneWidget,
      );
      expect(find.byType(EmergencyScreen), findsNothing);
      await tester.tap(
        find.byKey(const ValueKey('assistant-action-OPEN_EMERGENCY')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(
        observer.pushedRoute?.settings.name,
        '/patient/ai/OPEN_EMERGENCY',
      );
      expect(find.byType(EmergencyScreen), findsOneWidget);
    });

    testWidgets('renders unsupported action safely without an action button', (
      tester,
    ) async {
      final client = _FakeAiClient(
        () async => _reply('UNSUPPORTED_TEST_ACTION'),
      );
      await tester.pumpWidget(
        MaterialApp(home: AssistantScreen(client: client)),
      );
      await tester.enterText(find.byType(TextField), 'unsupported action');
      await tester.tap(find.byTooltip('Tuma swali'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(find.textContaining('Hatua hii haijaungwa mkono'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('assistant-action-UNSUPPORTED_TEST_ACTION')),
        findsNothing,
      );
    });

    testWidgets('shows a retry state on unauthorized service response', (
      tester,
    ) async {
      var attempt = 0;
      final client = _FakeAiClient(() async {
        attempt++;
        if (attempt == 1) {
          throw ApiException(401, 'UNAUTHENTICATED', 'Private response detail');
        }
        return _reply('OPEN_APPOINTMENTS');
      });
      await tester.pumpWidget(
        MaterialApp(home: AssistantScreen(client: client)),
      );
      await tester.enterText(
        find.byType(TextField),
        'Help with an appointment',
      );
      await tester.tap(find.byTooltip('Tuma swali'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(
        find.textContaining('Huduma ya msaidizi wa AI haipatikani'),
        findsOneWidget,
      );
      expect(find.text('Private response detail'), findsNothing);
      await tester.tap(find.text('Jaribu tena'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));
      expect(client.sends, 2);
      expect(client.keys[1], client.keys[2]);
      expect(
        find.byKey(const ValueKey('assistant-action-OPEN_APPOINTMENTS')),
        findsOneWidget,
      );
    });
  });
}
