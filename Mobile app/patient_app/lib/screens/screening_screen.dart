import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/phone.dart';
import '../core/patient_experience.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// Screening invitations and risk scores (FR-PS-01 to 03).
///
/// Displays backend-generated scores without adding clinical interpretation.
class ScreeningScreen extends StatefulWidget {
  const ScreeningScreen({super.key});
  @override
  State<ScreeningScreen> createState() => _ScreeningScreenState();
}

class _ScreeningScreenState extends State<ScreeningScreen> {
  List<Map<String, dynamic>> _invitations = [];
  List<Map<String, dynamic>> _scores = [];
  Map<String, Map<String, dynamic>> _programmes = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final user = await Session.user();
      final ppid = user?['patient_profile_id'] as String?;

      final values = await Future.wait([
        Api.get('/screening-invitations', query: {'limit': 100}),
        Api.get('/screening-programmes'),
      ]);
      final inv = values[0];
      final programmes = ((values[1]['data'] as List?) ?? [])
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList();
      List<Map<String, dynamic>> scores = [];
      if (ppid != null) {
        final s = await Api.get('/patient-profiles/$ppid/risk-scores');
        scores = riskScoresFromJson(s);
      }
      if (!mounted) return;
      setState(() {
        _invitations = screeningInvitationsFromJson(inv);
        _programmes = {for (final p in programmes) p['id'] as String: p};
        _scores = scores;
        _error = null;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = S.errorOffline;
          _loading = false;
        });
      }
    }
  }

  Future<void> _respond(String id, String response, {String? reason}) async {
    try {
      await Api.postDurable(
        opId: newOpId(),
        path: '/screening-invitations/$id/respond',
        syncPath: '/screening-invitations/{invitation_id}/respond',
        pathParams: {'invitation_id': id},
        body: {
          'response': response,
          if (reason != null) 'decline_reason': reason,
        },
      );
    } on Queued {
      // Queued is fine; the list refreshes either way.
    } catch (_) {
      // Falls through to the reload, which shows the true state.
    }
    _load();
  }

  Future<void> _decline(String id) async {
    final reasons = [
      'Ni mbali sana kufika',
      'Sina muda kwa sasa',
      'Sina uhakika ni kwa nini ninahitajika',
      'Sitaki kwa sasa',
    ];
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              // The reason is what tells the programme whether uptake is
              // limited by distance, cost, fear, or simply not knowing what
              // the test is for. Without it a decline teaches nobody anything.
              child: Text(
                'Kwa nini huwezi kwenda?',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
              ),
            ),
            ...reasons.map(
              (r) => ListTile(
                title: Text(r, style: const TextStyle(fontSize: 16)),
                onTap: () => Navigator.of(context).pop(r),
              ),
            ),
          ],
        ),
      ),
    );
    if (chosen != null) _respond(id, 'decline', reason: chosen);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(S.screening)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (_error != null) ...[
                    Notice(_error!),
                    const SizedBox(height: 16),
                  ],
                  const SectionTitle('Mialiko ya uchunguzi'),
                  if (_invitations.isEmpty)
                    const Empty('Huna mwaliko wa uchunguzi kwa sasa.')
                  else
                    ..._invitations.map(
                      (i) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Panel(
                          accent: AppColors.amber,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _programmes[i['programme_id']]?['name']
                                        as String? ??
                                    'Uchunguzi',
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              Text(
                                'Hali: ${i['status']}',
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              const SizedBox(height: 12),
                              Text('Ulipokea: ${_date(i['invited_at'])}'),
                              if (i['responded_at'] != null)
                                Text('Ulijibu: ${_date(i['responded_at'])}'),
                              if (i['status'] == 'pending') ...[
                                const SizedBox(height: 12),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    FilledButton(
                                      onPressed: () =>
                                          _respond(i['id'] as String, 'accept'),
                                      child: const Text('Nitakwenda'),
                                    ),
                                    OutlinedButton(
                                      onPressed: () =>
                                          _respond(i['id'] as String, 'defer'),
                                      child: const Text('Baadaye'),
                                    ),
                                    OutlinedButton(
                                      onPressed: () =>
                                          _decline(i['id'] as String),
                                      child: const Text('Siwezi'),
                                    ),
                                  ],
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ),
                  const SizedBox(height: 28),
                  const SectionTitle('Alama za kinga zilizohesabiwa na huduma'),
                  const Text('Alama hizi si utambuzi wa ugonjwa.'),
                  if (_scores.isEmpty)
                    const Empty('Bado hakuna alama za hatari zilizohesabiwa.')
                  else
                    ..._scores.map(_scoreCard),
                ],
              ),
            ),
    );
  }

  String _date(Object? raw) {
    final date = DateTime.tryParse(raw as String? ?? '');
    if (date == null) return 'tarehe haijatajwa';
    final local = date.toLocal();
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
  }

  Widget _scoreCard(Map<String, dynamic> s) {
    final band = s['band'] as String? ?? 'haijatajwa';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              s['condition_code'] as String? ?? '',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 4),
            Text(
              'Alama ya huduma: ${s['score']}  |  Kiwango: $band',
              style: const TextStyle(color: AppColors.inkSoft, fontSize: 15),
            ),
            if (s['model_version'] != null)
              Text('Toleo la modeli: ${s['model_version']}'),
            if (s['computed_at'] != null)
              Text('Imekokotolewa na huduma: ${_date(s['computed_at'])}'),
          ],
        ),
      ),
    );
  }
}
