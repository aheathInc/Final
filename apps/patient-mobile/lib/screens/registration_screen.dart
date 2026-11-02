import '../core/l10n.dart';
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../widgets/common.dart';
import '../widgets/residence_field.dart';
import 'security_screen.dart';
import 'login_screen.dart';

class RegistrationScreen extends StatefulWidget {
  const RegistrationScreen({super.key, this.initial});
  final Map<String, dynamic>? initial;
  @override
  State<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends State<RegistrationScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _residence = TextEditingController();
  final _birthDate = TextEditingController();
  final _kin = TextEditingController();
  final _kinPhone = TextEditingController();
  final _payer = TextEditingController();
  final _email = TextEditingController();
  Map<String, dynamic>? _data;
  Map<String, dynamic>? _options;
  DateTime? get _dob {
    try {
      return DateFormat('dd/MM/yyyy').parseStrict(_birthDate.text.trim());
    } catch (_) {
      return null;
    }
  }

  String? _sex;
  String _provider = 'mpesa';
  String? _error;
  bool _busy = false, _consent = false, _expired = false;
  bool _editingProfile = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _data = widget.initial;
    _fill();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 8), (_) {
      if (_data?['step'] == 'payment' &&
          _data?['payment'] != null &&
          !_busy &&
          !_expired) {
        _load(quiet: true);
      }
    });
  }

  void _fill() {
    _payer.text = _data?['phone_number'] as String? ?? '';
    final p = _data?['profile'] as Map?;
    if (p != null) {
      _name.text = p['full_name'] ?? '';
      _residence.text = p['residence'] ?? '';
      _kin.text = p['next_of_kin_name'] ?? '';
      _kinPhone.text = p['next_of_kin_phone'] ?? '';
      final savedDate = DateTime.tryParse(p['date_of_birth'] ?? '');
      _birthDate.text =
          savedDate == null ? '' : DateFormat('dd/MM/yyyy').format(savedDate);
      _sex = p['sex'];
      _consent = true;
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    for (final c in [
      _name,
      _residence,
      _birthDate,
      _kin,
      _kinPhone,
      _payer,
      _email
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final data = Map<String, dynamic>.from(
          await Api.registration('GET', '/auth/registration'));
      final options = _options ??
          Map<String, dynamic>.from(
              await Api.registration('GET', '/payments/registration/options'));
      if (!mounted) return;
      setState(() {
        final first = _data == null;
        _data = data;
        _options = options;
        _error = null;
        if (first) _fill();
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _expired = e.status == 401;
        });
      }
    } catch (_) {
      if (mounted && !quiet) {
        setState(() => _error = L.tr(
            'Mtandao haupatikani. Jaribu tena; maendeleo yako yamehifadhiwa.'));
      }
    }
  }

  Future<void> _action(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _expired = e.status == 401;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = L.tr(
            'Ombi halijathibitishwa. Angalia hali yake kabla ya kujaribu tena.'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveProfile() async {
    setState(() => _error = null);
    final invalid = _form.currentState!.validateGranularly();
    if (invalid.isNotEmpty) {
      await Scrollable.ensureVisible(invalid.first.context,
          duration: const Duration(milliseconds: 250), alignment: .2);
      return;
    }
    await _action(() async {
      final data =
          await Api.registration('PUT', '/auth/registration/profile', body: {
        'full_name': _name.text.trim(),
        'date_of_birth': DateFormat('yyyy-MM-dd').format(_dob!),
        'sex': _sex,
        'residence': _residence.text.trim(),
        'next_of_kin_name': _kin.text.trim(),
        'next_of_kin_phone': toE164(_kinPhone.text),
        'consent_version': _data!['consent_version'],
      });
      if (mounted) {
        setState(() {
          _data = Map<String, dynamic>.from(data);
          _editingProfile = false;
        });
      }
    });
  }

  Future<void> _pay() async {
    if (!_form.currentState!.validate()) return;
    await _action(() async {
      await Api.registration('POST', '/payments/registration/intents', body: {
        'provider': _provider,
        'payer_phone': toE164(_payer.text),
        if (_options?['requires_email'] == true)
          'payer_email': _email.text.trim(),
      });
      await _load();
    });
  }

  Future<void> _restart() async {
    await Session.clearRegistration();
    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
    }
  }

  Widget _field(TextEditingController c, String label,
          {bool phone = false, int max = 150}) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: TextFormField(
              controller: c,
              maxLength: max,
              keyboardType: phone ? TextInputType.phone : TextInputType.text,
              textCapitalization:
                  phone ? TextCapitalization.none : TextCapitalization.words,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: label, counterText: ''),
              validator: (v) => phone
                  ? (toE164(v ?? '') == null
                      ? L.tr('Weka namba sahihi, mfano 0712345678.')
                      : null)
                  : ((v ?? '').trim().length < 3
                      ? L.tr("Jaza {0}.", [label])
                      : null)));

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final step = _data?['step'] as String? ?? 'profile';
    if (step == 'security' && !_expired) {
      return SecurityScreen(
          registration: true, receipt: _data?['bill'] as Map?);
    }
    final profile = step == 'profile' || _editingProfile;
    final payment = _data?['payment'] as Map?;
    final pending = ['processing', 'pending', 'requires_action']
        .contains(payment?['status']);
    final simulated = _options?['environment'] == 'simulated';
    return Scaffold(
      appBar: AppBar(title: Text(L.tr('Usajili wa mgonjwa'))),
      body: SafeArea(
          child: SingleChildScrollView(
        key:
            ValueKey(profile ? 'registration-profile' : 'registration-payment'),
        padding: const EdgeInsets.all(20),
        child: Center(
            child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Form(
              key: _form,
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                        profile ? L.tr('Taarifa zako') : L.tr('Ada ya usajili'),
                        style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 8),
                    Text(profile
                        ? L.tr('Hatua 2 kati ya 4 · Simu imethibitishwa')
                        : L.tr('Hatua 3 kati ya 4 · Malipo ya mara moja')),
                    const SizedBox(height: 12),
                    LinearProgressIndicator(
                        value: profile ? .5 : .75,
                        semanticsLabel: L.tr('Maendeleo ya usajili')),
                    const SizedBox(height: 24),
                    if (_error != null) ...[
                      Notice(_error!),
                      const SizedBox(height: 16)
                    ],
                    if (_expired) ...[
                      Text(L.tr(
                          'Thibitisha simu tena. Taarifa na malipo yaliyothibitishwa hayatafutwa.')),
                      FilledButton(
                          onPressed: _restart,
                          child: Text(L.tr('Thibitisha simu tena'))),
                    ] else if (_data == null) ...[
                      OutlinedButton(
                          onPressed: _load, child: Text(L.tr('Pakia usajili'))),
                    ] else if (profile) ...[
                      Text(L.tr("Namba iliyothibitishwa: {0}",
                          [_data!['phone_number']])),
                      const SizedBox(height: 20),
                      _field(_name, L.tr('Jina kamili')),
                      TextFormField(
                        controller: _birthDate,
                        enabled: !_busy,
                        keyboardType: TextInputType.datetime,
                        textInputAction: TextInputAction.next,
                        onChanged: (_) => setState(() {}),
                        autovalidateMode: AutovalidateMode.onUserInteraction,
                        decoration: InputDecoration(
                          labelText: L.tr('Tarehe ya kuzaliwa'),
                          hintText: 'DD/MM/YYYY',
                          helperText:
                              L.tr('Siku/Mwezi/Mwaka, mfano 10/07/1995'),
                          suffixIcon: IconButton(
                              tooltip: L.tr('Chagua tarehe ya kuzaliwa'),
                              icon: const Icon(Icons.calendar_today_outlined),
                              onPressed: _busy
                                  ? null
                                  : () async {
                                      final now = DateTime.now();
                                      final first = DateTime(
                                          now.year - 120, now.month, now.day);
                                      final date = _dob;
                                      final picked = await showDatePicker(
                                          context: context,
                                          initialDate: date != null &&
                                                  !date.isBefore(first) &&
                                                  !date.isAfter(now)
                                              ? date
                                              : DateTime(now.year - 25, 1, 1),
                                          firstDate: first,
                                          lastDate: now,
                                          helpText: L.tr('Tarehe ya kuzaliwa'),
                                          initialDatePickerMode:
                                              DatePickerMode.year,
                                          initialEntryMode:
                                              DatePickerEntryMode.calendarOnly);
                                      if (picked != null && mounted) {
                                        setState(() => _birthDate.text =
                                            DateFormat('dd/MM/yyyy')
                                                .format(picked));
                                      }
                                    }),
                        ),
                        validator: (value) {
                          if ((value ?? '').trim().isEmpty) {
                            return L.tr('Weka tarehe ya kuzaliwa.');
                          }
                          final date = _dob, now = DateTime.now();
                          if (date == null) {
                            return L.tr('Weka tarehe sahihi kwa DD/MM/YYYY.');
                          }
                          if (date.isAfter(now) ||
                              date.isBefore(DateTime(
                                  now.year - 120, now.month, now.day))) {
                            return L.tr(
                                'Weka tarehe kati ya miaka 120 iliyopita na leo.');
                          }
                          return null;
                        },
                      ),
                      if (_dob != null)
                        Text(L.tr("Umri: {0} miaka", [
                          DateTime.now().year -
                              _dob!.year -
                              (DateTime.now().month < _dob!.month ||
                                      (DateTime.now().month == _dob!.month &&
                                          DateTime.now().day < _dob!.day)
                                  ? 1
                                  : 0)
                        ])),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                          initialValue: _sex,
                          decoration:
                              InputDecoration(labelText: L.tr('Jinsia')),
                          items: [
                            DropdownMenuItem(
                                value: 'female', child: Text(L.tr('Mwanamke'))),
                            DropdownMenuItem(
                                value: 'male', child: Text(L.tr('Mwanaume'))),
                            DropdownMenuItem(
                                value: 'other', child: Text(L.tr('Nyingine')))
                          ],
                          onChanged:
                              _busy ? null : (v) => setState(() => _sex = v),
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          validator: (v) =>
                              v == null ? L.tr('Chagua jinsia.') : null),
                      const SizedBox(height: 16),
                      ResidenceField(controller: _residence, enabled: !_busy),
                      const SizedBox(height: 24),
                      Text(L.tr('Ndugu wa karibu'),
                          style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 12),
                      _field(_kin, L.tr('Jina la ndugu')),
                      _field(_kinPhone, L.tr('Simu ya ndugu'),
                          phone: true, max: 20),
                      Text(L.tr(
                          'Tumia mawasiliano ya mtu anayekubali kuwa ndugu wa kuwasiliana naye. Hii haimpi access ya taarifa zako za afya.')),
                      const SizedBox(height: 12),
                      FormField<bool>(
                        initialValue: _consent,
                        autovalidateMode: AutovalidateMode.onUserInteraction,
                        validator: (v) => v == true
                            ? null
                            : L.tr(
                                'Kubali matumizi ya taarifa ili kuendelea na usajili.'),
                        builder: (field) => Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              CheckboxListTile(
                                  contentPadding: EdgeInsets.zero,
                                  value: _consent,
                                  title: Text(L.tr(
                                      'Nakubali taarifa hizi kutumika kuunda account na kusaidia huduma yangu. Nimejulisha ndugu niliyemtaja.')),
                                  onChanged: _busy
                                      ? null
                                      : (v) {
                                          field.didChange(v ?? false);
                                          setState(() => _consent = v ?? false);
                                        }),
                              if (field.hasError)
                                Padding(
                                    padding: const EdgeInsets.only(left: 12),
                                    child: Text(field.errorText!,
                                        style: TextStyle(
                                            color: Theme.of(context)
                                                .colorScheme
                                                .error))),
                            ]),
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                          onPressed: _busy ? null : _saveProfile,
                          child: Text(_busy
                              ? 'Inahifadhi...'
                              : L.tr('Hifadhi na endelea'))),
                    ] else ...[
                      Text('TSh 4,000',
                          style: Theme.of(context).textTheme.headlineMedium),
                      const SizedBox(height: 8),
                      Text(L.tr(
                          'Ada ya kufungua account, hulipwa mara moja. Vipimo, dawa na huduma nyingine zina gharama zake; consultation iliyoainishwa free haitozwi consultation fee.')),
                      const SizedBox(height: 12),
                      SelectableText(L.tr("Kumbukumbu: {0}",
                          [_data!['bill']?['reference'] ?? ''])),
                      if (simulated) ...[
                        const SizedBox(height: 16),
                        Notice(L.tr(
                            'MAJARIBIO: hakuna pesa halisi zitakazokatwa. Provider wa malipo bado hajaunganishwa.'))
                      ],
                      const SizedBox(height: 24),
                      if (!pending) ...[
                        if (_data?['profile']?['full_name'] != null)
                          Text(L.tr("Account ya {0}",
                              [_data!['profile']['full_name']])),
                        TextButton.icon(
                            onPressed: _busy
                                ? null
                                : () => setState(() => _editingProfile = true),
                            icon: const Icon(Icons.edit_outlined),
                            label: Text(L.tr('Kagua / badilisha taarifa'))),
                        const SizedBox(height: 12),
                        if (payment?['status'] == 'failed')
                          Notice(L.tr(
                              'Malipo hayakufanikiwa. Unaweza kujaribu tena.')),
                        DropdownButtonFormField<String>(
                            initialValue: _provider,
                            decoration: InputDecoration(
                                labelText: L.tr('Mtandao wa malipo')),
                            items: const [
                              DropdownMenuItem(
                                  value: 'mpesa', child: Text('M-Pesa')),
                              DropdownMenuItem(
                                  value: 'tigo_pesa',
                                  child: Text('Mixx by Yas')),
                              DropdownMenuItem(
                                  value: 'airtel_money',
                                  child: Text('Airtel Money'))
                            ],
                            onChanged: _busy
                                ? null
                                : (v) => setState(() => _provider = v!)),
                        const SizedBox(height: 16),
                        _field(_payer, L.tr('Namba itakayolipa'),
                            phone: true, max: 20),
                        if (_options?['requires_email'] == true)
                          TextFormField(
                              controller: _email,
                              keyboardType: TextInputType.emailAddress,
                              decoration: InputDecoration(
                                  labelText: L.tr('Barua pepe ya risiti')),
                              validator: (v) =>
                                  RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                                          .hasMatch(v ?? '')
                                      ? null
                                      : L.tr('Weka barua pepe sahihi.')),
                        const SizedBox(height: 16),
                        FilledButton(
                            onPressed: _busy || _options == null ? null : _pay,
                            child: Text(_busy
                                ? 'Inaomba...'
                                : simulated
                                    ? L.tr('Anza malipo ya majaribio')
                                    : L.tr('Lipa TSh 4,000'))),
                      ] else ...[
                        const Icon(Icons.hourglass_top_rounded, size: 36),
                        const SizedBox(height: 12),
                        Text(simulated
                            ? L.tr(
                                'Malipo ya majaribio yanasubiri uthibitisho.')
                            : L.tr(
                                'Thibitisha malipo kwenye simu yako. Usiombe malipo mengine wakati tunakagua haya.')),
                        if (kDebugMode && simulated)
                          Padding(
                              padding: const EdgeInsets.only(top: 16),
                              child: OutlinedButton(
                                  onPressed: _busy
                                      ? null
                                      : () => _action(() async {
                                            await Api.registration('POST',
                                                '/payments/registration/simulate',
                                                body: {});
                                            await _load();
                                          }),
                                  child: Text(
                                      L.tr('Thibitisha malipo ya majaribio')))),
                      ],
                      const SizedBox(height: 16),
                      OutlinedButton(
                          onPressed: _busy ? null : () => _action(_load),
                          child: Text(L.tr('Angalia hali ya malipo'))),
                    ],
                    const SizedBox(height: 16),
                    if (!_expired)
                      TextButton(
                          onPressed: _busy ? null : _restart,
                          child:
                              Text(L.tr('Endelea baadaye / badilisha namba'))),
                  ])),
        )),
      )),
    );
  }
}
