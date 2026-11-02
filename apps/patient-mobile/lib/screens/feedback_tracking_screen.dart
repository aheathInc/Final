import '../core/l10n.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import 'patient_community_screen.dart';

class FeedbackTrackingScreen extends StatefulWidget {
  const FeedbackTrackingScreen({super.key});
  @override
  State<FeedbackTrackingScreen> createState() => _FeedbackTrackingScreenState();
}

class _FeedbackTrackingScreenState extends State<FeedbackTrackingScreen> {
  final _subject = TextEditingController(), _body = TextEditingController();
  List<Map<String, dynamic>> _tickets = [];
  String? _error;
  String _kind = 'complaint';
  bool _busy = false, _loading = true, _urgent = false;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = records(await Api.get('$platformPath/feedback'));
      if (mounted) {
        setState(() {
          _tickets = r;
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

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = messageError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String label(String s) =>
      {
        'received': L.tr('Imepokelewa'),
        'in_review': L.tr('Inafanyiwa kazi'),
        'escalated': L.tr('Imepelekwa kwa uongozi'),
        'resolved': L.tr('Imetatuliwa')
      }[s] ??
      s;
  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
        appBar: AppBar(title: Text(L.tr('Fuatilia maoni na malalamiko'))),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(padding: const EdgeInsets.all(20), children: [
                  Text(L.tr(
                      'Feedback hii inaunganishwa na akaunti yako ili upate majibu. Kwa taarifa ya tukio bila jina, tumia sehemu ya kuripoti tukio.')),
                  TextButton.icon(
                      onPressed: () => emergency(context),
                      icon: const Icon(Icons.emergency_outlined),
                      label: Text(L.tr('Kwa dharura, pata msaada sasa'))),
                  if (_error != null) ...[
                    Text(L.tr(_error!),
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error)),
                    TextButton(
                        onPressed: _load, child: Text(L.tr('Jaribu tena')))
                  ],
                  DropdownButtonFormField<String>(
                      initialValue: _kind,
                      decoration: InputDecoration(labelText: L.tr('Aina')),
                      items: [
                        DropdownMenuItem(
                            value: 'complaint',
                            child: Text(L.tr('Malalamiko'))),
                        DropdownMenuItem(
                            value: 'suggestion', child: Text(L.tr('Pendekezo')))
                      ],
                      onChanged:
                          _busy ? null : (v) => setState(() => _kind = v!)),
                  const SizedBox(height: 12),
                  TextField(
                      controller: _subject,
                      maxLength: 150,
                      decoration: InputDecoration(
                          labelText: L.tr('Kichwa cha feedback'))),
                  TextField(
                      controller: _body,
                      minLines: 3,
                      maxLines: 6,
                      maxLength: 4000,
                      decoration: InputDecoration(
                          labelText: L.tr('Eleza kilichotokea au pendekezo'))),
                  CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: _urgent,
                      onChanged:
                          _busy ? null : (v) => setState(() => _urgent = v!),
                      title: Text(L.tr('Inahitaji kupelekwa kwa uongozi')),
                      subtitle: Text(L.tr(
                          'Hii haitumi ambulance wala kutoa huduma ya dharura.'))),
                  FilledButton(
                      onPressed: _busy
                          ? null
                          : () => _run(() async {
                                await Api.post('$platformPath/feedback', {
                                  'kind': _kind,
                                  'subject': _subject.text.trim(),
                                  'body': _body.text.trim(),
                                  'urgent': _urgent
                                });
                                _subject.clear();
                                _body.clear();
                              }),
                      child:
                          Text(_busy ? 'Inatuma...' : L.tr('Tuma feedback'))),
                  const SizedBox(height: 28),
                  Text(L.tr('Feedback zako'),
                      style: Theme.of(context).textTheme.titleLarge),
                  if (_tickets.isEmpty)
                    Padding(
                        padding: EdgeInsets.symmetric(vertical: 20),
                        child: Text(L.tr(
                            'Feedback utakazotuma zitaonekana hapa pamoja na maendeleo yake.'))),
                  for (final t in _tickets)
                    ExpansionTile(
                        tilePadding: EdgeInsets.zero,
                        title: Text(t['subject']),
                        subtitle: Text(
                            '${label(t['status'])} · ${t['id'].toString().substring(0, 8)}'),
                        children: [
                          Align(
                              alignment: Alignment.centerLeft,
                              child: Text(t['body'])),
                          for (final h in (t['history'] as List))
                            ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(L.tr(label(h['status']))),
                                subtitle: Text('${h['note']}\n${h['at']}')),
                          if (t['status'] != 'resolved' &&
                              t['escalated'] != true)
                            TextButton(
                                onPressed: _busy
                                    ? null
                                    : () => _run(() async {
                                          await Api.post(
                                              '$platformPath/feedback/${t['id']}/escalate',
                                              {});
                                        }),
                                child: Text(L.tr('Peleka kwa uongozi')))
                        ]),
                ])));
  }
}
