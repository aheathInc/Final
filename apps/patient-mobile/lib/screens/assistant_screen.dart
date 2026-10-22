import 'package:flutter/material.dart';

import '../core/patient_ai.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'appointments_screen.dart';
import 'diagnostics_screen.dart';
import 'education_screen.dart';
import 'emergency_screen.dart';
import 'family_screen.dart';
import 'feedback_screen.dart';
import 'facility_browser_screen.dart';
import 'insurance_payments_screen.dart';
import 'new_consultation_screen.dart';
import 'patient_care_medicines_screen.dart';
import 'privacy_consent_screen.dart';
import 'screening_screen.dart';

String patientAiActionCode(PatientNavigationAction action) => switch (action) {
      PatientNavigationAction.openDoctors => 'OPEN_DOCTORS',
      PatientNavigationAction.startConsultation => 'START_CONSULTATION',
      PatientNavigationAction.openAppointments => 'OPEN_APPOINTMENTS',
      PatientNavigationAction.openDiagnostics => 'OPEN_DIAGNOSTICS',
      PatientNavigationAction.openMedications => 'OPEN_MEDICATIONS',
      PatientNavigationAction.openPharmacy => 'OPEN_PHARMACY',
      PatientNavigationAction.openFamily => 'OPEN_FAMILY',
      PatientNavigationAction.openEducation => 'OPEN_EDUCATION',
      PatientNavigationAction.openPrevention => 'OPEN_PREVENTION',
      PatientNavigationAction.openEmergency => 'OPEN_EMERGENCY',
      PatientNavigationAction.openPrivacy => 'OPEN_PRIVACY',
      PatientNavigationAction.openFeedback => 'OPEN_FEEDBACK',
      PatientNavigationAction.openInsurancePayments =>
        'OPEN_INSURANCE_PAYMENTS',
    };

/// Maps only the app's compile-time allowlist. Model text and unknown action
/// codes never become routes, URLs, or commands.
Widget patientAiDestination(PatientNavigationAction action) => switch (action) {
      PatientNavigationAction.openDoctors => const FacilityBrowserScreen(),
      PatientNavigationAction.startConsultation =>
        const NewConsultationScreen(),
      PatientNavigationAction.openAppointments => const AppointmentsScreen(),
      PatientNavigationAction.openDiagnostics => const DiagnosticsScreen(),
      PatientNavigationAction.openMedications =>
        const PatientCareMedicinesScreen(),
      PatientNavigationAction.openPharmacy =>
        const PatientCareMedicinesScreen(),
      PatientNavigationAction.openFamily => const FamilyScreen(),
      PatientNavigationAction.openEducation => const EducationScreen(),
      PatientNavigationAction.openPrevention => const ScreeningScreen(),
      PatientNavigationAction.openEmergency => const EmergencyScreen(),
      PatientNavigationAction.openPrivacy => const PrivacyConsentScreen(),
      PatientNavigationAction.openFeedback => const FeedbackScreen(),
      PatientNavigationAction.openInsurancePayments =>
        const InsurancePaymentsScreen(),
    };

String patientAiActionLabel(PatientNavigationAction action) => switch (action) {
      PatientNavigationAction.openDoctors => 'Tafuta daktari',
      PatientNavigationAction.startConsultation => 'Anza ombi la clinician',
      PatientNavigationAction.openAppointments => 'Fungua miadi',
      PatientNavigationAction.openDiagnostics => 'Fungua vipimo na majibu',
      PatientNavigationAction.openMedications => 'Fungua maagizo na dawa',
      PatientNavigationAction.openPharmacy => 'Angalia famasia',
      PatientNavigationAction.openFamily => 'Fungua familia',
      PatientNavigationAction.openEducation => 'Fungua elimu ya afya',
      PatientNavigationAction.openPrevention => 'Fungua kinga na uchunguzi',
      PatientNavigationAction.openEmergency => 'Fungua SOS / Dharura',
      PatientNavigationAction.openPrivacy => 'Dhibiti ruhusa za faragha',
      PatientNavigationAction.openFeedback => 'Fungua maoni na malalamiko',
      PatientNavigationAction.openInsurancePayments => 'Fungua bima na malipo',
    };

class AssistantScreen extends StatefulWidget {
  const AssistantScreen({super.key, this.client});

  final PatientAiClient? client;

  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
  late final PatientAiClient _client = widget.client ?? PatientAiRepository();
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _messages = <_ConversationMessage>[];
  String? _conversationId;
  String? _error;
  String? _failedBody;
  String? _failedMessageKey;
  final String _conversationKey = PatientAiRepository.newIdempotencyKey(
    'conversation',
  );
  bool _sending = false;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final body = _input.text.trim();
    if (body.isEmpty || _sending) return;
    _input.clear();
    _failedBody = body;
    _failedMessageKey = PatientAiRepository.newIdempotencyKey('message');
    setState(() {
      _messages.add(_ConversationMessage.patient(body));
      _error = null;
    });
    await _sendPending();
  }

  Future<void> _retry() async {
    if (_failedBody == null || _sending) return;
    setState(() => _error = null);
    await _sendPending();
  }

  Future<void> _sendPending() async {
    final body = _failedBody;
    final messageKey = _failedMessageKey;
    if (body == null || messageKey == null) return;
    setState(() => _sending = true);
    try {
      _conversationId ??= await _client.openConversation(
        idempotencyKey: _conversationKey,
      );
      final reply = await _client.sendMessage(
        conversationId: _conversationId!,
        body: body,
        idempotencyKey: messageKey,
      );
      if (!mounted) return;
      setState(() {
        _messages.add(_ConversationMessage.assistant(reply));
        _failedBody = null;
        _failedMessageKey = null;
        _sending = false;
      });
      _scrollToEnd();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = 'Huduma ya msaidizi wa AI haipatikani sasa. Jaribu tena.';
      });
      _scrollToEnd();
    }
  }

  void _openAction(PatientNavigationAction action) {
    final destination = patientAiDestination(action);
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        settings: RouteSettings(
          name: '/patient/ai/${patientAiActionCode(action)}',
        ),
        builder: (_) => destination,
      ),
    );
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Msaidizi wa AI / Uliza A-Health')),
        body: Column(
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Notice(
                'AI PROVIDER — LOCAL/STUB. Huu ni mwongoza huduma wa majaribio, si daktari. Hatoi utambuzi, tafsiri ya vipimo au maagizo ya dawa.',
                tone: NoticeTone.attention,
              ),
            ),
            Expanded(
              child: _messages.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(28),
                        child: Text(
                          'Uliza jinsi ya kufungua huduma zilizopo, kama miadi, daktari, dawa, vipimo au faragha.',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                      itemCount: _messages.length + (_sending ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (index == _messages.length) {
                          return const Padding(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            child: Row(
                              children: [
                                SizedBox(
                                  width: 18,
                                  height: 18,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2),
                                ),
                                SizedBox(width: 10),
                                Text('Msaidizi anaandaa jibu...'),
                              ],
                            ),
                          );
                        }
                        return _messageCard(_messages[index]);
                      },
                    ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        _error!,
                        style: const TextStyle(color: AppColors.clay),
                      ),
                    ),
                    TextButton(
                        onPressed: _retry, child: const Text('Jaribu tena')),
                  ],
                ),
              ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _input,
                        enabled: !_sending,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 4000,
                        decoration: const InputDecoration(
                          labelText: 'Andika swali au huduma unayotafuta',
                          counterText: '',
                          border: OutlineInputBorder(),
                        ),
                        onSubmitted: (_) => _send(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      tooltip: 'Tuma swali',
                      onPressed: _sending ? null : _send,
                      icon: const Icon(Icons.send_outlined),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );

  Widget _messageCard(_ConversationMessage message) {
    final background = message.isPatient ? AppColors.petrol : Colors.white;
    final foreground = message.isPatient ? Colors.white : AppColors.ink;
    return Align(
      alignment:
          message.isPatient ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 560),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(14),
          border: message.isPatient ? null : Border.all(color: AppColors.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              message.isPatient ? 'Wewe' : 'Msaidizi wa AI (LOCAL/STUB)',
              style: TextStyle(fontWeight: FontWeight.w700, color: foreground),
            ),
            const SizedBox(height: 6),
            Text(message.body, style: TextStyle(color: foreground)),
            if (message.escalated) ...[
              const SizedBox(height: 10),
              const Text(
                'Ikiwa uko kwenye hatari ya haraka, tafuta huduma ya dharura. SOS haitatumwa hadi uchague hatua hiyo kwenye ukurasa unaofuata.',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
            ],
            if (message.action != null) ...[
              const SizedBox(height: 10),
              OutlinedButton.icon(
                key: ValueKey(
                  'assistant-action-${patientAiActionCode(message.action!)}',
                ),
                onPressed: () => _openAction(message.action!),
                icon: Icon(
                  message.escalated
                      ? Icons.warning_amber_rounded
                      : Icons.arrow_forward,
                ),
                label: Text(patientAiActionLabel(message.action!)),
                style: OutlinedButton.styleFrom(
                  foregroundColor:
                      message.isPatient ? Colors.white : AppColors.petrol,
                  side: BorderSide(
                    color: message.isPatient ? Colors.white : AppColors.petrol,
                  ),
                ),
              ),
            ],
            if (message.unsupportedAction) ...[
              const SizedBox(height: 8),
              const Text(
                'Hatua hii haijaungwa mkono. Hakuna ukurasa uliofunguliwa.',
                style: TextStyle(fontStyle: FontStyle.italic),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ConversationMessage {
  const _ConversationMessage.patient(this.body)
      : isPatient = true,
        action = null,
        escalated = false,
        unsupportedAction = false;

  _ConversationMessage.assistant(PatientAiReply reply)
      : body = reply.body,
        isPatient = false,
        action = reply.action,
        escalated = reply.escalated,
        unsupportedAction = reply.unsupportedAction;

  final String body;
  final bool isPatient;
  final PatientNavigationAction? action;
  final bool escalated;
  final bool unsupportedAction;
}
