import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/patient_care.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'checkins_screen.dart';
import 'feedback_screen.dart';
import 'thread_screen.dart';

class ConsultationDetailScreen extends StatefulWidget {
  const ConsultationDetailScreen({
    super.key,
    required this.consultation,
    this.requestedClinicianName,
  });

  final Map<String, dynamic> consultation;
  final String? requestedClinicianName;

  @override
  State<ConsultationDetailScreen> createState() => _ConsultationDetailScreenState();
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
        _error = 'Hali ya ombi haikupatikana. Angalia mtandao kisha ujaribu tena.';
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
        setState(() => _error = 'Ushauri umekamilika, lakini dokezo lililosainiwa halikupatikana sasa.');
      }
    }

    final profileId = _consultation.patientProfileId ??
        (await Session.user())?['patient_profile_id'] as String?;
    if (profileId == null) return;
    try {
      final rows = await _care.prescriptions(profileId);
      final relevant = rows.where((p) => p['consultation_id'] == _consultation.id).toList();
      final logs = await _care.adherenceLogs(profileId);
      if (!mounted) return;
      final ids = relevant.map((p) => p['id']).whereType<String>().toSet();
      setState(() {
        _prescriptions = relevant;
        _adherenceLogs = logs.where((log) => ids.contains(log['prescription_id'])).toList();
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
    final status = _consultation.status;
    final assigned = _consultation.data['assigned_clinician'] as Map<String, dynamic>?;
    final assignedName = assigned?['full_name'] as String?;
    final queuePosition = _consultation.data['queue_position'];
    final wait = _consultation.data['estimated_wait_minutes'];
    return Scaffold(
      appBar: AppBar(title: const Text('Ombi la matibabu')),
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
              accent: status == 'completed' ? AppColors.petrol : AppColors.amber,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Hali ya ombi', style: TextStyle(color: AppColors.inkSoft)),
                  const SizedBox(height: 6),
                  Text(consultationStatusLabel(status),
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                  if (assignedName != null) ...[
                    const SizedBox(height: 10),
                    Text('Daktari: $assignedName'),
                  ] else if (widget.requestedClinicianName != null) ...[
                    const SizedBox(height: 10),
                    Text('Daktari uliomchagua: ${widget.requestedClinicianName}'),
                  ],
                  if (queuePosition is num) ...[
                    const SizedBox(height: 8),
                    Text('Nafasi kwenye foleni: ${queuePosition.toInt()}'),
                  ],
                  if (wait is num) ...[
                    const SizedBox(height: 4),
                    Text('Muda wa kusubiri uliokadiriwa: dakika ${wait.toInt()}'),
                  ],
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _loading ? null : _load,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Sasisha hali'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            const SectionTitle('Ulichotuma'),
            Panel(child: Text(_consultation.symptomText?.trim().isNotEmpty == true
                ? _consultation.symptomText!
                : 'Hakuna maelezo ya dalili yaliyohifadhiwa.')),
            ...[
              const SizedBox(height: 20),
              const SectionTitle('Mazungumzo'),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => ThreadScreen(
                    careThreadId: _consultation.careThreadId,
                    title: _consultation.symptomText ?? 'Matibabu',
                  ),
                )),
                icon: const Icon(Icons.chat_bubble_outline),
                label: const Text('Fungua mazungumzo yale yale'),
              ),
              if (_thread?['status'] == 'closed')
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text('Mazungumzo yamefungwa; ujumbe wa awali unaweza kusomwa.'),
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
                label: const Text('Tathmini matibabu haya'),
              ),
              const SizedBox(height: 20),
              const SectionTitle('Ushauri uliosainiwa'),
              if (_note == null)
                const Empty('Dokezo lililosainiwa halijapatikana bado.')
              else
                _noteCard(_note!),
              const SizedBox(height: 20),
              const SectionTitle('Dawa zilizoandikwa'),
              if (_prescriptions.isEmpty)
                const Empty('Hakuna agizo la dawa lililohusishwa na ombi hili.')
              else
              ..._prescriptions.map(_prescriptionCard),
              if (_prescriptions.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(_adherenceLogs.isEmpty
                    ? 'Hakuna kumbukumbu ya dozi iliyopokelewa kwa agizo hili bado.'
                    : 'Kumbukumbu za dozi: ${_adherenceLogs.length}'),
              ],
            ],
            if (_checkIns.isNotEmpty) ...[
              const SizedBox(height: 24),
              const SectionTitle('Ufuatiliaji'),
              ..._checkIns.map((c) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('Hali: ${c['status'] ?? 'imepangwa'}'),
                subtitle: Text((c['scheduled_at'] as String?) ?? ''),
              )),
              FilledButton.tonal(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => const CheckInsScreen(),
                )),
                child: const Text('Jibu swali la ufuatiliaji'),
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
    final items = (prescription['items'] as List?)?.whereType<Map>().toList() ?? [];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text('${item['medication_name'] ?? ''} · ${item['dosage'] ?? ''}\n'
                'Mara ${item['frequency_per_day'] ?? ''} kwa siku kwa siku ${item['duration_days'] ?? ''}'
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
    final signedAt = DateTime.tryParse(note['signed_at'] as String? ?? '');
    final flags = (note['red_flags_discussed'] as List?)?.whereType<String>().toList() ?? [];
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (signedAt != null)
          Text('Imesainiwa ${DateFormat('d MMM y, HH:mm').format(signedAt.toLocal())}',
              style: const TextStyle(color: AppColors.inkSoft)),
        const SizedBox(height: 8),
        const Text('Utambuzi', style: TextStyle(fontWeight: FontWeight.w600)),
        Text((note['diagnosis_text'] as String?) ?? ''),
        const SizedBox(height: 10),
        const Text('Ushauri', style: TextStyle(fontWeight: FontWeight.w600)),
        Text((note['advice_text'] as String?) ?? ''),
        if (flags.isNotEmpty) ...[
          const SizedBox(height: 10),
          const Text('Dalili za kuangalia', style: TextStyle(fontWeight: FontWeight.w600)),
          ...flags.map((flag) => Text('• $flag')),
        ],
      ]),
    );
  }
}
