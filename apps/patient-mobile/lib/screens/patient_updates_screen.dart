import '../core/l10n.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import 'patient_community_screen.dart' show records, messageError;

class PatientUpdatesScreen extends StatefulWidget {
  const PatientUpdatesScreen({super.key});
  @override
  State<PatientUpdatesScreen> createState() => _PatientUpdatesScreenState();
}

class _PatientUpdatesScreenState extends State<PatientUpdatesScreen> {
  List<Map<String, dynamic>> _updates = [], _reports = [];
  String? _error;
  bool _loading = true;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        Api.get('/patient-platform/notifications'),
        Api.get('/patient-platform/reports')
      ]);
      if (mounted) {
        setState(() {
          _updates = records(r[0]);
          _reports = records(r[1]);
          _error = null;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = messageError(e);
          _loading = false;
        });
      }
    }
  }

  String label(dynamic key) =>
      {
        'patient.peer_invitation': L.tr(
            'Una invitation ya peer chat. Fungua Peer chats kuchagua kukubali au kukataa.'),
        'patient.peer_message': L.tr('Ujumbe mpya kwenye Peer chats.'),
        'patient.community_review':
            L.tr('Post yako imepitiwa. Fungua community kuona hali yake.'),
        'patient.report_resolved':
            L.tr('Ripoti yako imepitiwa. Angalia majibu hapa chini.'),
        'patient.feedback_updated':
            L.tr('Feedback yako ina majibu. Fungua Fuatilia feedback.')
      }[key] ??
      L.tr('Una taarifa mpya.');
  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
        appBar: AppBar(title: Text(L.tr('Taarifa na ripoti zangu'))),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(padding: const EdgeInsets.all(20), children: [
                  if (_error != null) ...[
                    Text(L.tr(_error!)),
                    TextButton(
                        onPressed: _load, child: Text(L.tr('Jaribu tena')))
                  ],
                  Text(L.tr('Taarifa za karibuni'),
                      style: Theme.of(context).textTheme.titleLarge),
                  if (_updates.isEmpty)
                    Padding(
                        padding: EdgeInsets.symmetric(vertical: 20),
                        child: Text(L.tr('Hakuna taarifa mpya.'))),
                  for (final n in _updates)
                    ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.notifications_outlined),
                        title: Text(L.tr(label(n['templateKey']))),
                        subtitle: Text(n['createdAt']
                            .toString()
                            .replaceFirst('T', ' ')
                            .substring(0, 16))),
                  const Divider(),
                  Text(L.tr('Ripoti ulizowasilisha'),
                      style: Theme.of(context).textTheme.titleLarge),
                  if (_reports.isEmpty)
                    Padding(
                        padding: EdgeInsets.symmetric(vertical: 20),
                        child: Text(L.tr('Hakuna ripoti ulizowasilisha.'))),
                  for (final r in _reports)
                    ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(r['reason']),
                        subtitle: Text(
                            '${r['status'] == 'open' ? L.tr('Inasubiri uchunguzi') : L.tr('Imepitiwa')}\n${r['resolution'] ?? ''}'))
                ])));
  }
}
