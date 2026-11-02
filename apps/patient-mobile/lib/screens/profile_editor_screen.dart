import '../core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/patient_care.dart';
import '../core/profile_repository.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class ProfileEditorScreen extends StatefulWidget {
  const ProfileEditorScreen(
      {super.key,
      required this.account,
      required this.profile,
      required this.repository,
      this.medical = false});
  final Map<String, dynamic> account, profile;
  final PatientProfileRepository repository;
  final bool medical;
  @override
  State<ProfileEditorScreen> createState() => _ProfileEditorScreenState();
}

class _ProfileEditorScreenState extends State<ProfileEditorScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController(),
      _allergies = TextEditingController(),
      _conditions = TextEditingController(),
      _contact = TextEditingController();
  late Map<String, dynamic> _account, _profile;
  late String _language;
  late int _identity;
  bool _busy = false, _conflict = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _identity = Session.identityChanges.value;
    _account = Map.from(widget.account);
    _profile = Map.from(widget.profile);
    _fill();
    Session.identityChanges.addListener(_identityChanged);
  }

  void _identityChanged() {
    if (mounted) setState(() {});
  }

  void _fill() {
    _name.text = _account['full_name'] as String? ?? '';
    _language = ['sw', 'en', 'fr'].contains(_account['preferred_language'])
        ? _account['preferred_language'] as String
        : 'sw';
    _allergies.text = (_profile['allergies'] as List? ?? []).join(', ');
    _conditions.text =
        (_profile['chronic_conditions'] as List? ?? []).join(', ');
    _contact.text = _profile['emergency_contact'] as String? ?? '';
  }

  @override
  void dispose() {
    Session.identityChanges.removeListener(_identityChanged);
    for (final controller in [_name, _allergies, _conditions, _contact]) {
      controller.dispose();
    }
    super.dispose();
  }

  bool get _current => mounted && _identity == Session.identityChanges.value;
  List<String> _items(String text) => text
      .split(',')
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toSet()
      .toList();
  Future<void> _save() async {
    if (!_form.currentState!.validate() || !_current) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (!await widget.repository.online()) {
        throw ApiException(0, L.tr('OFFLINE'),
            L.tr('Unganisha intaneti kabla ya kuhifadhi mabadiliko.'));
      }
      if (!_current) return;
      if (widget.medical) {
        await widget.repository.saveMedical(
            profileClinicalUpdateBody(
                profileVersion: (_profile['version'] as num).toInt(),
                allergies: _items(_allergies.text),
                chronicConditions: _items(_conditions.text),
                emergencyContact:
                    _contact.text.trim().isEmpty ? null : _contact.text.trim()),
            expectedIdentity: _identity);
      } else {
        await widget.repository.saveAccount({
          'base_version': (_account['version'] as num).toInt(),
          'full_name': _name.text.trim(),
          'preferred_language': _language
        }, expectedIdentity: _identity);
      }
      if (mounted && _current) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (_current) {
        setState(() {
          _conflict = e.status == 409;
          _error = _conflict
              ? L.tr(
                  'Taarifa zimebadilishwa sehemu nyingine. Pakia taarifa za sasa kabla ya kuhifadhi tena.')
              : e.message;
        });
      }
    } catch (_) {
      if (_current) {
        setState(() => _error = L.tr(
            'Mabadiliko hayajathibitishwa. Angalia mtandao kisha ujaribu tena.'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reload() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final rows = await Future.wait(
          [widget.repository.account(), widget.repository.profile()]);
      if (!_current) return;
      setState(() {
        _account = rows[0];
        _profile = rows[1];
        _fill();
        _conflict = false;
      });
    } catch (_) {
      if (_current) {
        setState(() => _error =
            L.tr('Taarifa hazijapatikana. Maandishi yako hayajafutwa.'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _registrationDetails() {
    final p = AppPalette.of(context);
    final dob = DateTime.tryParse(_profile['date_of_birth'] as String? ?? '');
    final rows = <String, String>{
      if (_account['phone_number'] != null)
        'Namba ya account': _account['phone_number'].toString(),
      if (dob != null)
        'Tarehe ya kuzaliwa': DateFormat('dd/MM/yyyy').format(dob),
      if (_profile['sex'] != null)
        'Jinsia': {
              'female': L.tr('Mwanamke'),
              'male': L.tr('Mwanaume'),
              'other': L.tr('Nyingine')
            }[_profile['sex']] ??
            _profile['sex'].toString(),
      if ((_profile['residence'] as String? ?? '').isNotEmpty)
        'Mahali unapoishi': _profile['residence'] as String,
      if ((_profile['next_of_kin_name'] as String? ?? '').isNotEmpty)
        'Ndugu wa karibu': _profile['next_of_kin_name'] as String,
      if ((_profile['next_of_kin_phone'] as String? ?? '').isNotEmpty)
        'Simu ya ndugu': _profile['next_of_kin_phone'] as String,
    };
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 28),
      SectionTitle(L.tr('Taarifa za usajili')),
      ...rows.entries.map((row) => Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(row.key, style: TextStyle(color: p.inkSoft, fontSize: 14)),
            const SizedBox(height: 4),
            Text(row.value)
          ]))),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(
          title: Text(widget.medical
              ? L.tr('Taarifa za afya')
              : L.tr('Taarifa binafsi'))),
      body: !_current
          ? Center(
              child:
                  Text(L.tr('Account imebadilika. Fungua taarifa zako tena.')))
          : SafeArea(
              child: Center(
                  child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 640),
                      child: Form(
                          key: _form,
                          child: ListView(
                              padding: const EdgeInsets.all(20),
                              children: [
                                Text(
                                    widget.medical
                                        ? L.tr(
                                            'Hifadhi taarifa muhimu zinazosaidia huduma zako za afya.')
                                        : L.tr(
                                            'Sasisha jina lako na lugha ya mawasiliano.'),
                                    style:
                                        Theme.of(context).textTheme.bodyLarge),
                                const SizedBox(height: 22),
                                if (!widget.medical) ...[
                                  TextFormField(
                                      controller: _name,
                                      enabled: !_busy,
                                      maxLength: 150,
                                      textCapitalization:
                                          TextCapitalization.words,
                                      decoration: InputDecoration(
                                          labelText: L.tr('Jina kamili'),
                                          counterText: ''),
                                      validator: (v) =>
                                          (v ?? '').trim().length < 3
                                              ? L.tr('Weka jina kamili.')
                                              : null),
                                  const SizedBox(height: 18),
                                  DropdownButtonFormField<String>(
                                      key: ValueKey(_language),
                                      initialValue: _language,
                                      decoration: InputDecoration(
                                          labelText:
                                              L.tr('Lugha ya mawasiliano')),
                                      items: const [
                                        DropdownMenuItem(
                                            value: 'sw',
                                            child: Text('Kiswahili')),
                                        DropdownMenuItem(
                                            value: 'en',
                                            child: Text('English')),
                                        DropdownMenuItem(
                                            value: 'fr',
                                            child: Text('Français'))
                                      ],
                                      onChanged: _busy
                                          ? null
                                          : (v) => setState(
                                              () => _language = v ?? 'sw')),
                                ] else ...[
                                  TextFormField(
                                      controller: _allergies,
                                      enabled: !_busy,
                                      minLines: 1,
                                      maxLines: 3,
                                      decoration: InputDecoration(
                                          labelText: L.tr('Mizio (Allergies)'),
                                          hintText: L
                                              .tr('Mfano: Penicillin, Karanga'),
                                          helperText: L.tr(
                                              'Tenganisha kwa koma. Acha wazi kama hakuna.'),
                                          helperMaxLines: 2),
                                      validator: (v) =>
                                          _items(v ?? '').length > 50
                                              ? L.tr('Weka mizio isiyozidi 50.')
                                              : null),
                                  const SizedBox(height: 20),
                                  TextFormField(
                                      controller: _conditions,
                                      enabled: !_busy,
                                      minLines: 1,
                                      maxLines: 3,
                                      decoration: InputDecoration(
                                          labelText: L.tr('Magonjwa ya kudumu'),
                                          hintText: L.tr('Mfano: Kisukari'),
                                          helperText: L.tr(
                                              'Tenganisha kwa koma. Acha wazi kama hakuna.'),
                                          helperMaxLines: 2),
                                      validator: (v) => _items(v ?? '').length >
                                              50
                                          ? L.tr('Weka magonjwa yasiyozidi 50.')
                                          : null),
                                  const SizedBox(height: 20),
                                  TextFormField(
                                      controller: _contact,
                                      enabled: !_busy,
                                      maxLength: 100,
                                      keyboardType: TextInputType.phone,
                                      decoration: InputDecoration(
                                          labelText: L.tr('Namba ya dharura'),
                                          counterText: '',
                                          hintText: L
                                              .tr('Namba ya ndugu au rafiki'))),
                                ],
                                const SizedBox(height: 22),
                                if (_error != null) ...[
                                  Notice(_error!),
                                  const SizedBox(height: 16)
                                ],
                                FilledButton.icon(
                                    onPressed: _busy || _conflict || !_current
                                        ? null
                                        : _save,
                                    icon: const Icon(Icons.check_rounded),
                                    label: Text(_busy
                                        ? 'Inahifadhi...'
                                        : L.tr('Hifadhi mabadiliko'))),
                                if (_conflict)
                                  TextButton(
                                      onPressed: _busy ? null : _reload,
                                      child:
                                          Text(L.tr('Pakia taarifa za sasa'))),
                                if (!widget.medical) _registrationDetails(),
                              ]))))),
    );
  }
}
