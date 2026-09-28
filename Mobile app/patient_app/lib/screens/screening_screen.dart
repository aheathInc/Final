import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// Screening invitations and risk scores (FR-PS-01 to 03).
///
/// The action tier is read from the score's band as the server computed it.
/// A client that decided "this looks urgent" on its own would be a second
/// clinical opinion nobody reviewed.
class ScreeningScreen extends StatefulWidget {
  const ScreeningScreen({super.key});
  @override
  State<ScreeningScreen> createState() => _ScreeningScreenState();
}

class _ScreeningScreenState extends State<ScreeningScreen> {
  List<Map<String, dynamic>> _invitations = [];
  List<Map<String, dynamic>> _scores = [];
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

      final inv = await Api.get('/screening-invitations', query: {'limit': 20});
      List<Map<String, dynamic>> scores = [];
      if (ppid != null) {
        final s = await Api.get('/patient-profiles/$ppid/risk-scores');
        scores = ((s['data'] as List?) ?? []).cast<Map<String, dynamic>>();
      }
      if (!mounted) return;
      setState(() {
        _invitations = ((inv['data'] as List?) ?? [])
            .cast<Map<String, dynamic>>()
            .where((i) => i['status'] == 'pending')
            .toList();
        _scores = scores;
        _error = null;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = S.errorOffline; _loading = false; });
    }
  }

  Future<void> _respond(String id, String response, {String? reason}) async {
    try {
      await Api.postDurable(
        opId: newOpId(),
        path: '/screening-invitations/$id/respond',
        syncPath: '/screening-invitations/{invitation_id}/respond',
        pathParams: {'invitation_id': id},
        body: {'response': response, if (reason != null) 'decline_reason': reason},
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
              child: Text('Kwa nini huwezi kwenda?',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500)),
            ),
            ...reasons.map((r) => ListTile(
                  title: Text(r, style: const TextStyle(fontSize: 16)),
                  onTap: () => Navigator.of(context).pop(r),
                )),
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
                  if (_error != null) ...[Notice(_error!), const SizedBox(height: 16)],

                  const SectionTitle('Mialiko ya uchunguzi'),
                  if (_invitations.isEmpty)
                    const Empty('Huna mwaliko wa uchunguzi kwa sasa.')
                  else
                    ..._invitations.map((i) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Panel(
                            accent: AppColors.amber,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Umealikwa kufanya uchunguzi',
                                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
                                const SizedBox(height: 12),
                                Row(children: [
                                  Expanded(
                                    child: FilledButton(
                                      onPressed: () => _respond(i['id'] as String, 'accept'),
                                      child: const Text('Nitakwenda'),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: OutlinedButton(
                                      onPressed: () => _decline(i['id'] as String),
                                      style: OutlinedButton.styleFrom(
                                        minimumSize: const Size.fromHeight(52),
                                        shape: const RoundedRectangleBorder(),
                                        side: const BorderSide(color: AppColors.line),
                                      ),
                                      child: const Text('Siwezi', style: TextStyle(fontSize: 16)),
                                    ),
                                  ),
                                ]),
                              ],
                            ),
                          ),
                        )),

                  const SizedBox(height: 28),
                  const SectionTitle('Hatari zangu'),
                  if (_scores.isEmpty)
                    const Empty('Bado hakuna alama za hatari zilizohesabiwa.')
                  else
                    ..._scores.map(_scoreCard),
                ],
              ),
            ),
    );
  }

  Widget _scoreCard(Map<String, dynamic> s) {
    final band = s['band'] as String? ?? 'low';
    final colour = switch (band) {
      'very_high' || 'high' => AppColors.clay,
      'moderate' => AppColors.amber,
      _ => null,
    };
    final advice = switch (band) {
      'very_high' => 'Ona daktari haraka iwezekanavyo.',
      'high' => 'Panga kuonana na daktari.',
      'moderate' => 'Fuatilia afya yako na fanya uchunguzi ukialikwa.',
      _ => 'Endelea na tabia nzuri za afya.',
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Panel(
        accent: colour,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_conditionName(s['condition_code'] as String? ?? ''),
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500)),
            const SizedBox(height: 4),
            Text(advice, style: TextStyle(color: colour ?? AppColors.inkSoft, fontSize: 15)),
          ],
        ),
      ),
    );
  }

  static String _conditionName(String code) => switch (code) {
        'hypertension' => 'Shinikizo la damu',
        'type2_diabetes' => 'Kisukari aina ya pili',
        _ => code.replaceAll('_', ' '),
      };
}
