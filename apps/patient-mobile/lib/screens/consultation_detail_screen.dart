import '../core/l10n.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/patient_care.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/consultation_call_action.dart';
import 'checkins_screen.dart';
import 'feedback_screen.dart';
import 'thread_screen.dart';
import 'consultation_call_screen.dart';
import 'payment_bills_screen.dart';

class ConsultationDetailScreen extends StatefulWidget {
  const ConsultationDetailScreen({
    super.key,
    required this.consultation,
    this.requestedClinicianName,
  });

  final Map<String, dynamic> consultation;
  final String? requestedClinicianName;

  @override
  State<ConsultationDetailScreen> createState() =>
      _ConsultationDetailScreenState();
}

class _ConsultationDetailScreenState extends State<ConsultationDetailScreen> {
  final _care = PatientCareRepository();
  late ConsultationRecord _consultation;
  Map<String, dynamic>? _note;
  Map<String, dynamic>? _thread;
  List<Map<String, dynamic>> _prescriptions = [];
  List<Map<String, dynamic>> _adherenceLogs = [];
  List<Map<String, dynamic>> _checkIns = [];
  String? _error;
  bool _loading = true;
  int _polls = 0;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _consultation = ConsultationRecord.fromJson(widget.consultation);
    _load();
  }

  Future<void> _load({bool automatic = false}) async {
    if (automatic) _polls++;
    try {
      final status = await _care.queueStatus(_consultation.id);
      if (!mounted) return;
      setState(() {
        _consultation = _consultation.withStatus(status);
        _error = null;
        _loading = false;
      });
      _schedulePolling();

      final requests = <Future<void>>[
        _loadThread(),
      ];
      if (_consultation.status == 'completed') {
        requests.add(_loadOutcome());
      }
      await Future.wait(requests);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = L.tr(
            'Hali ya ombi haikupatikana. Angalia mtandao kisha ujaribu tena.');
        _loading = false;
      });
      _schedulePolling();
    }
  }

  void _schedulePolling() {
    _poll?.cancel();
    if (_consultation.isTerminal || _polls >= 30) return;
    _poll = Timer(const Duration(seconds: 20), () => _load(automatic: true));
  }

  Future<void> _loadThread() async {
    try {
      final thread = await _care.careThread(_consultation.careThreadId);
      if (!mounted) return;
      setState(() => _thread = thread);
      final cycleId = thread['active_follow_up_cycle_id'] as String?;
      if (cycleId != null) {
        try {
          final response = await _care.getFollowUpCheckIns(cycleId);
          if (mounted) setState(() => _checkIns = response);
        } catch (_) {
          // Existing due-check-in screen remains available if cycle history is
          // temporarily unreachable.
        }
      }
    } catch (_) {
      // Status and outcome remain useful even if thread metadata is unavailable.
    }
  }

  Future<void> _loadOutcome() async {
    try {
      final note = await _care.signedNote(_consultation.id);
      if (mounted) setState(() => _note = note);
    } catch (_) {
      if (mounted) {
        setState(() => _error = L.tr(
            'Ushauri umekamilika, lakini dokezo lililosainiwa halikupatikana sasa.'));
      }
    }

    final profileId = _consultation.patientProfileId ??
        (await Session.user())?['patient_profile_id'] as String?;
    if (profileId == null) return;
    try {
      final rows = await _care.prescriptions(profileId);
      final relevant =
          rows.where((p) => p['consultation_id'] == _consultation.id).toList();
      final logs = await _care.adherenceLogs(profileId);
      if (!mounted) return;
      final ids = relevant.map((p) => p['id']).whereType<String>().toSet();
      setState(() {
        _prescriptions = relevant;
        _adherenceLogs =
            logs.where((log) => ids.contains(log['prescription_id'])).toList();
      });
    } catch (_) {
      // Prescription reads can be retried with the status refresh.
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final status = _consultation.status;
    final assigned =
        _consultation.data['assigned_clinician'] as Map<String, dynamic>?;
    final assignedName = assigned?['full_name'] as String?;
    final queuePosition = _consultation.data['queue_position'];
    final wait = _consultation.data['estimated_wait_minutes'];
    final hospital = _consultation.data['consultation_mode'] == 'hospital';
    final modality = _consultation.data['modality'];
    final fee = _consultation.data['consultation_fee_amount'];
    return Scaffold(
      appBar: AppBar(title: Text(L.tr('Ombi la matibabu'))),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (_error != null) ...[
              Notice(_error!),
              const SizedBox(height: 12),
            ],
            Panel(
              accent:
                  status == 'completed' ? AppColors.petrol : AppColors.amber,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(L.tr('Hali ya ombi'),
                      style: TextStyle(color: AppColors.inkSoft)),
                  const SizedBox(height: 6),
                  Text(L.tr(consultationStatusLabel(status)),
                      style: const TextStyle(
                          fontSize: 18, fontWeight: FontWeight.w600)),
                  if (assignedName != null) ...[
                    const SizedBox(height: 10),
                    Text(L.tr("Daktari: {0}", [assignedName])),
                  ] else if (widget.requestedClinicianName != null) ...[
                    const SizedBox(height: 10),
                    Text(L.tr("Daktari uliomchagua: {0}",
                        [widget.requestedClinicianName])),
                  ],
                  if (queuePosition is num) ...[
                    const SizedBox(height: 8),
                    Text(L.tr(
                        "Nafasi kwenye foleni: {0}", [queuePosition.toInt()])),
                  ],
                  if (wait is num) ...[
                    const SizedBox(height: 4),
                    Text(L.tr("Muda wa kusubiri uliokadiriwa: dakika {0}",
                        [wait.toInt()])),
                  ],
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _loading ? null : _load,
                    icon: const Icon(Icons.refresh),
                    label: Text(L.tr('Sasisha hali')),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            SectionTitle(hospital
                ? L.tr('Hospital consultation')
                : L.tr('Remote consultation')),
            Panel(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(hospital
                      ? L.tr("Utafika {0} kuonana na daktari.", [
                          _consultation.data['facility_name'] ??
                              'hospital uliyochagua'
                        ])
                      : modality == 'video'
                          ? L.tr('Njia: Video call')
                          : modality == 'voice'
                              ? L.tr('Njia: Audio call')
                              : L.tr('Njia: Live chat')),
                  const SizedBox(height: 8),
                  Text(hospital
                      ? L.tr('Hakuna consultation fee (TZS 0).')
                      : fee == null
                          ? L.tr(
                              'Ada: TZS 5,000 kwa General Practice au TZS 8,000 kwa specialist.')
                          : L.tr("Consultation fee: TZS {0}", [fee])),
                  ConsultationCallAction(
                      consultation: _consultation.data,
                      onJoin: () => Navigator.of(context).push(
                          MaterialPageRoute(
                              builder: (_) => ConsultationCallScreen(
                                  consultationId: _consultation.id,
                                  video: modality == 'video')))),
                  if (!hospital)
                    TextButton(
                        onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(
                                builder: (_) => const PaymentBillsScreen())),
                        child: Text(L.tr('Angalia bili na malipo'))),
                ])),
            const SizedBox(height: 20),
            SectionTitle(L.tr('Ulichotuma')),
            Panel(
                child: Text(_consultation.symptomText?.trim().isNotEmpty == true
                    ? _consultation.symptomText!
                    : L.tr('Hakuna maelezo ya dalili yaliyohifadhiwa.'))),
            ...[
              const SizedBox(height: 20),
              SectionTitle(L.tr('Mazungumzo')),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => ThreadScreen(
                    careThreadId: _consultation.careThreadId,
                    title: _consultation.symptomText ?? L.tr('Matibabu'),
                  ),
                )),
                icon: const Icon(Icons.chat_bubble_outline),
                label: Text(L.tr('Fungua mazungumzo yale yale')),
              ),
              if (_thread?['status'] == 'closed')
                Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(L.tr(
                      'Mazungumzo yamefungwa; ujumbe wa awali unaweza kusomwa.')),
                ),
            ],
            if (status == 'completed') ...[
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => FeedbackScreen(
                    initialConsultationId: _consultation.id,
                  ),
                )),
                icon: const Icon(Icons.star_outline),
                label: Text(L.tr('Tathmini matibabu haya')),
              ),
              const SizedBox(height: 20),
              SectionTitle(L.tr('Ushauri uliosainiwa')),
              if (_note == null)
                Empty(L.tr('Dokezo lililosainiwa halijapatikana bado.'))
              else
                _noteCard(_note!),
              const SizedBox(height: 20),
              SectionTitle(L.tr('Dawa zilizoandikwa')),
              if (_prescriptions.isEmpty)
                Empty(L.tr('Hakuna agizo la dawa lililohusishwa na ombi hili.'))
              else
                ..._prescriptions.map(_prescriptionCard),
              if (_prescriptions.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(_adherenceLogs.isEmpty
                    ? L.tr(
                        'Hakuna kumbukumbu ya dozi iliyopokelewa kwa agizo hili bado.')
                    : L.tr("Kumbukumbu za dozi: {0}", [_adherenceLogs.length])),
              ],
            ],
            if (_checkIns.isNotEmpty) ...[
              const SizedBox(height: 24),
              SectionTitle(L.tr('Ufuatiliaji')),
              ..._checkIns.map((c) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title:
                        Text(L.tr("Hali: {0}", [c['status'] ?? 'imepangwa'])),
                    subtitle: Text((c['scheduled_at'] as String?) ?? ''),
                  )),
              FilledButton.tonal(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => const CheckInsScreen(),
                )),
                child: Text(L.tr('Jibu swali la ufuatiliaji')),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _noteCard(Map<String, dynamic> note) {
    return SignedConsultationNoteCard(note: note);
  }

  Widget _prescriptionCard(Map<String, dynamic> prescription) {
    final items =
        (prescription['items'] as List?)?.whereType<Map>().toList() ?? [];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
                '${item['medication_name'] ?? ''} · ${item['dosage'] ?? ''}\n' +
                    L.tr("Mara {0} kwa siku kwa siku {1}", [
                      item['frequency_per_day'] ?? '',
                      item['duration_days'] ?? ''
                    ]) +
                    '${item['instructions'] == null ? '' : '\n${item['instructions']}'}'),
          ),
      ])),
    );
  }
}

class SignedConsultationNoteCard extends StatelessWidget {
  const SignedConsultationNoteCard({super.key, required this.note});
  final Map<String, dynamic> note;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final signedAt = DateTime.tryParse(note['signed_at'] as String? ?? '');
    final flags =
        (note['red_flags_discussed'] as List?)?.whereType<String>().toList() ??
            [];
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (signedAt != null)
          Text(
              L.tr("Imesainiwa {0}",
                  [DateFormat('d MMM y, HH:mm').format(signedAt.toLocal())]),
              style: const TextStyle(color: AppColors.inkSoft)),
        const SizedBox(height: 8),
        Text(L.tr('Utambuzi'), style: TextStyle(fontWeight: FontWeight.w600)),
        Text((note['diagnosis_text'] as String?) ?? ''),
        const SizedBox(height: 10),
        Text(L.tr('Ushauri'), style: TextStyle(fontWeight: FontWeight.w600)),
        Text((note['advice_text'] as String?) ?? ''),
        if (flags.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(L.tr('Dalili za kuangalia'),
              style: TextStyle(fontWeight: FontWeight.w600)),
          ...flags.map((flag) => Text('• $flag')),
        ],
      ]),
    );
  }
}
