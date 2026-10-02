import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/consent_feedback_finance.dart';
import '../core/session.dart';
import '../widgets/common.dart';

const _consentScopes = <String>[
  'full_history',
  'current_thread',
  'medications_only',
  'investigations_only',
  'emergency_minimum',
];

const _granteeTypes = <String>[
  'clinician',
  'facility',
  'researcher',
  'emergency_responder',
];

class PrivacyConsentScreen extends StatefulWidget {
  const PrivacyConsentScreen({super.key});

  @override
  State<PrivacyConsentScreen> createState() => _PrivacyConsentScreenState();
}

class _PrivacyConsentScreenState extends State<PrivacyConsentScreen> {
  final _repository = ConsentFeedbackFinanceRepository();
  final _recipientId = TextEditingController();
  final _threadId = TextEditingController();
  final _reason = TextEditingController();
  String _scope = _consentScopes.first;
  String _grantee = _granteeTypes.first;
  DateTime? _expiry;
  String? _profileId;
  String? _error;
  bool _loading = true;
  bool _busy = false;
  List<Map<String, dynamic>> _consents = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _recipientId.dispose();
    _threadId.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final user = await Session.user();
      final profileId = user?['patient_profile_id'] as String?;
      if (profileId == null) {
        throw const FormatException('Akaunti hii haina wasifu wa mgonjwa.');
      }
      final rows = await _repository.consents(profileId);
      if (!mounted) return;
      setState(() {
        _profileId = profileId;
        _consents = rows;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _message(error);
        _loading = false;
      });
    }
  }

  String _message(Object error) => error is ApiException
      ? '${error.message} (${error.code ?? error.status})'
      : 'Taarifa hazikuweza kusomwa. Jaribu tena.';

  Future<void> _grant() async {
    final profileId = _profileId;
    if (profileId == null) return;
    final recipientId = _recipientId.text.trim();
    final threadId = _threadId.text.trim();
    if ((_grantee == 'clinician' || _grantee == 'facility') &&
        !_isUuid(recipientId)) {
      setState(() => _error = 'Weka kitambulisho halali cha mpokeaji.');
      return;
    }
    if (_scope == 'current_thread' && !_isUuid(threadId)) {
      setState(() => _error = 'Weka kitambulisho halali cha mazungumzo.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final persisted = await _repository.grantConsent(profileId, {
        'grantee_type': _grantee,
        if (_grantee == 'clinician') 'grantee_clinician_id': recipientId,
        if (_grantee == 'facility') 'grantee_facility_id': recipientId,
        if (threadId.isNotEmpty) 'care_thread_id': threadId,
        'scope': _scope,
        if (_expiry != null) 'expires_at': _expiry!.toUtc().toIso8601String(),
        if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
      });
      if (!mounted) return;
      setState(() {
        _consents = [
          persisted,
          ..._consents.where((row) => row['id'] != persisted['id']),
        ];
        _busy = false;
        _recipientId.clear();
        _threadId.clear();
        _reason.clear();
        _expiry = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Ruhusa imehifadhiwa na kuthibitishwa.')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _message(error);
        _busy = false;
      });
    }
  }

  Future<void> _revoke(String consentId) async {
    final profileId = _profileId;
    if (profileId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final persisted = await _repository.revokeConsent(profileId, consentId);
      if (!mounted) return;
      setState(() {
        _consents = _consents
            .map((row) => row['id'] == consentId ? persisted : row)
            .toList();
        _busy = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Kufutwa kwa ruhusa kumethibitishwa.')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _message(error);
        _busy = false;
      });
    }
  }

  bool _isUuid(String value) => RegExp(
        r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
      ).hasMatch(value);

  String _date(Object? value) {
    final date = DateTime.tryParse(value as String? ?? '');
    if (date == null) return '—';
    final local = date.toLocal();
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Faragha na ruhusa')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              const Notice(
                'Dhibiti ruhusa zilizohifadhiwa kwa wasifu wako. Kufuta ruhusa hakubadilishi moja kwa moja udhibiti wa huduma nyingine isipokuwa huduma hiyo inatekeleza ruhusa hiyo.',
                tone: NoticeTone.attention,
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Notice(_error!)
              ],
              const SizedBox(height: 20),
              const SectionTitle('Ruhusa zilizohifadhiwa'),
              if (_loading)
                const Center(child: CircularProgressIndicator())
              else if (_consents.isEmpty)
                const Empty('Hakuna ruhusa iliyohifadhiwa.')
              else
                ..._consents.map(_consentCard),
              const SizedBox(height: 24),
              const SectionTitle('Toa ruhusa mpya'),
              DropdownButtonFormField<String>(
                initialValue: _grantee,
                decoration:
                    const InputDecoration(labelText: 'Aina ya mpokeaji'),
                items: [
                  for (final item in _granteeTypes)
                    DropdownMenuItem(value: item, child: Text(item)),
                ],
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _grantee = value ?? _grantee),
              ),
              if (_grantee == 'clinician' || _grantee == 'facility') ...[
                const SizedBox(height: 10),
                TextField(
                  controller: _recipientId,
                  decoration: InputDecoration(
                    labelText: _grantee == 'clinician'
                        ? 'Kitambulisho cha clinician'
                        : 'Kitambulisho cha facility',
                  ),
                ),
              ],
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _scope,
                decoration: const InputDecoration(
                  labelText: 'Wigo unaoungwa mkono',
                ),
                items: [
                  for (final item in _consentScopes)
                    DropdownMenuItem(value: item, child: Text(item)),
                ],
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _scope = value ?? _scope),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _threadId,
                decoration: const InputDecoration(
                  labelText: 'Kitambulisho cha thread (hiari)',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _reason,
                maxLength: 500,
                decoration: const InputDecoration(
                  labelText: 'Sababu / madhumuni (hiari)',
                ),
              ),
              TextButton.icon(
                onPressed: _busy ? null : _chooseExpiry,
                icon: const Icon(Icons.event_outlined),
                label: Text(
                  _expiry == null
                      ? 'Weka mwisho wa muda (hiari)'
                      : 'Inaisha: ${_date(_expiry!.toIso8601String())}',
                ),
              ),
              if (_expiry != null)
                TextButton(
                  onPressed:
                      _busy ? null : () => setState(() => _expiry = null),
                  child: const Text('Ondoa mwisho wa muda'),
                ),
              FilledButton.icon(
                onPressed: _busy ? null : _grant,
                icon: const Icon(Icons.verified_user_outlined),
                label: const Text('Hifadhi ruhusa'),
              ),
            ],
          ),
        ),
      );

  Future<void> _chooseExpiry() async {
    final today = DateTime.now();
    final selected = await showDatePicker(
      context: context,
      initialDate: _expiry ?? today.add(const Duration(days: 30)),
      firstDate: today,
      lastDate: DateTime(today.year + 10),
    );
    if (selected != null && mounted) {
      setState(() => _expiry = DateTime(
            selected.year,
            selected.month,
            selected.day,
            23,
            59,
            59,
          ));
    }
  }

  Widget _consentCard(Map<String, dynamic> row) {
    final status = row['status'] as String? ?? 'unknown';
    final recipient = row['grantee_clinician_id'] ??
        row['grantee_facility_id'] ??
        row['grantee_type'] ??
        '—';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Mpokeaji: $recipient'),
            Text('Wigo: ${row['scope']}'),
            Text('Sababu: ${row['reason'] ?? 'haikutajwa'}'),
            Text('Hali: $status'),
            Text('Ilitolewa: ${_date(row['granted_at'])}'),
            if (row['expires_at'] != null)
              Text('Inaisha: ${_date(row['expires_at'])}'),
            if (row['revoked_at'] != null)
              Text('Ilifutwa: ${_date(row['revoked_at'])}'),
            if (status != 'revoked')
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: _busy ? null : () => _revoke(row['id'] as String),
                  child: const Text('Futa ruhusa'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
