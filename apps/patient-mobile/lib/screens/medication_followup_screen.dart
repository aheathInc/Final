import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/care_continuity.dart' show newCareRequestKey;
import '../core/l10n.dart';
import '../core/medication_followup.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/profile_card.dart';
import 'care_continuity_screen.dart';
import 'patient_care_medicines_screen.dart';
import 'patient_community_screen.dart' show emergency;

class MedicationFollowupScreen extends StatefulWidget {
  const MedicationFollowupScreen({super.key, this.repository});
  final MedicationRepository? repository;
  @override
  State<MedicationFollowupScreen> createState() =>
      _MedicationFollowupScreenState();
}

class _MedicationFollowupScreenState extends State<MedicationFollowupScreen>
    with WidgetsBindingObserver {
  final _defaultRepository = MedicationRepository();
  MedicationRepository get _repo => widget.repository ?? _defaultRepository;
  Map<String, dynamic>? _data;
  Map<String, dynamic> _device = {};
  List<Map<String, dynamic>> _doses = [];
  final _keys = <String, String>{};
  String? _profile, _error;
  int _days = 7, _generation = 0;
  bool _loading = true, _busy = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Session.identityChanges.addListener(_changed);
    _load();
  }

  @override
  void dispose() {
    _generation++;
    WidgetsBinding.instance.removeObserver(this);
    Session.identityChanges.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    _generation++;
    setState(() {
      _data = null;
      _doses = [];
      _profile = null;
      _keys.clear();
    });
    _load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _deviceStatus();
  }

  Future<void> _deviceStatus() async {
    final status = await MedicationReminders.status();
    if (mounted) setState(() => _device = status);
  }

  Future<void> _load() async {
    final generation = ++_generation, identity = Session.identityChanges.value;
    setState(() => _loading = true);
    try {
      final owner = await Session.userId();
      if (owner == null) throw StateError('Signed out');
      final results = await Future.wait<dynamic>([
        _repo.summary(days: _days, profileId: _profile),
        _repo.doses(profileId: _profile),
        MedicationReminders.status()
      ]);
      if (!mounted ||
          generation != _generation ||
          identity != Session.identityChanges.value) {
        return;
      }
      setState(() {
        _data = results[0] as Map<String, dynamic>;
        _doses = results[1] as List<Map<String, dynamic>>;
        _device = results[2] as Map<String, dynamic>;
        _error = null;
      });
      await MedicationReminders.refill(_data!, identity);
    } catch (e) {
      if (mounted &&
          generation == _generation &&
          identity == Session.identityChanges.value) {
        setState(() => _error = e is ApiException
            ? e.message
            : L.tr('Taarifa za dawa hazijapatikana. Jaribu tena.'));
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _action(
      String fingerprint, Future<void> Function(String) action) async {
    if (_busy) return;
    final identity = Session.identityChanges.value;
    final key = _keys.putIfAbsent(fingerprint, newCareRequestKey);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action(key);
      if (!mounted || identity != Session.identityChanges.value) return;
      _keys.remove(fingerprint);
      await _load();
      await MedicationReminders.refresh(force: true);
      await _deviceStatus();
    } catch (e) {
      if (mounted && identity == Session.identityChanges.value) {
        setState(() {
          if (e is ApiException &&
              {400, 403, 404, 409, 422}.contains(e.status)) {
            _keys.remove(fingerprint);
          }
          _error = e is ApiException
              ? e.message
              : L.tr('Jibu halijathibitishwa. Sasisha kabla ya kujaribu tena.');
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _when(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '');
    return date == null
        ? '—'
        : DateFormat('dd MMM, HH:mm').format(date.toLocal());
  }

  Future<void> _skip(Map<String, dynamic> dose) async {
    String? reason;
    final note = TextEditingController();
    final accepted = await showDialog<bool>(
        context: context,
        builder: (context) => StatefulBuilder(
            builder: (context, setDialog) => AlertDialog(
                  title: Text(L.tr('Kwa nini umeruka dozi?')),
                  content: SingleChildScrollView(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                    DropdownButtonFormField<String>(
                        isExpanded: true,
                        decoration: InputDecoration(labelText: L.tr('Sababu')),
                        items: [
                          for (final entry in {
                            'forgot': L.tr('Nilisahau'),
                            'ran_out': L.tr('Dawa zimekwisha'),
                            'side_effects': L.tr('Nimepata madhara'),
                            'other': L.tr('Nyingine')
                          }.entries)
                            DropdownMenuItem(
                                value: entry.key, child: Text(entry.value)),
                        ],
                        onChanged: (v) => setDialog(() => reason = v)),
                    const SizedBox(height: 14),
                    TextField(
                        controller: note,
                        maxLength: 500,
                        maxLines: 3,
                        decoration: InputDecoration(
                            labelText: L.tr('Maelezo ya hiari'))),
                    if (reason == 'side_effects')
                      Text(L.tr(
                          'Wasiliana na daktari kuhusu madhara. Kwa hatari ya sasa, tumia msaada wa dharura.')),
                  ])),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: Text(L.tr('Ghairi'))),
                    FilledButton(
                        onPressed: reason == null
                            ? null
                            : () => Navigator.pop(context, true),
                        child: Text(L.tr('Thibitisha kuruka dozi')))
                  ],
                )));
    final text = note.text;
    Future.delayed(const Duration(milliseconds: 400), note.dispose);
    if (accepted == true && mounted) {
      await _action(
          '${dose['id']}:skip:$reason:$text',
          (key) => _repo.report(dose,
              taken: false, reason: reason, note: text, key: key));
    }
  }

  Future<void> _supply(Map<String, dynamic> item) async {
    final form = GlobalKey<FormState>();
    final stock = item['supply'] as Map?;
    final qty =
            TextEditingController(text: stock?['remaining']?.toString() ?? ''),
        units = TextEditingController(
            text: stock?['units_per_dose']?.toString() ?? ''),
        unit =
            TextEditingController(text: stock?['unit_label']?.toString() ?? ''),
        threshold = TextEditingController(
            text: stock?['low_stock_threshold']?.toString() ?? '');
    double? number(String? v) =>
        double.tryParse((v ?? '').replaceAll(',', '.'));
    String? valid(String? v) => number(v) == null ||
            !number(v)!.isFinite ||
            number(v)! < 0 ||
            number(v)! > 1000000
        ? L.tr('Weka kiasi sahihi kisicho hasi.')
        : null;
    final saved = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
                title: Text(L.tr('Akiba ya dawa uliyonayo')),
                content: SingleChildScrollView(
                    child: Form(
                        key: form,
                        child:
                            Column(mainAxisSize: MainAxisSize.min, children: [
                          Text(L.tr(
                              'Hesabu dawa zilizobaki sasa. Hii ni kumbukumbu ya akiba, si maagizo mapya ya kutumia dawa.')),
                          const SizedBox(height: 16),
                          TextFormField(
                              controller: qty,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                      decimal: true),
                              decoration: InputDecoration(
                                  labelText: L.tr('Kiasi kilichobaki sasa')),
                              validator: valid),
                          TextFormField(
                              controller: unit,
                              maxLength: 30,
                              decoration: InputDecoration(
                                  labelText: L.tr(
                                      'Kipimo cha akiba (mfano vidonge au ml)')),
                              validator: (v) => (v ?? '').trim().isEmpty
                                  ? L.tr('Weka kipimo cha akiba.')
                                  : null),
                          TextFormField(
                              controller: units,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                      decimal: true),
                              decoration: InputDecoration(
                                  labelText:
                                      L.tr('Kiasi cha akiba kwa dozi (hiari)'),
                                  helperText: L.tr(
                                      'Kwa hesabu ya akiba tu; fuata maagizo ya daktari.'),
                                  helperMaxLines: 3),
                              validator: (v) => (v ?? '').trim().isEmpty
                                  ? null
                                  : number(v) == null ||
                                          !number(v)!.isFinite ||
                                          number(v)! <= 0 ||
                                          number(v)! > 100000
                                      ? L.tr('Weka kiasi halali.')
                                      : null),
                          const SizedBox(height: 14),
                          TextFormField(
                              controller: threshold,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                      decimal: true),
                              decoration: InputDecoration(
                                  labelText: L.tr(
                                      'Nikumbushe akiba ikifika kiasi gani?')),
                              validator: valid),
                        ]))),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: Text(L.tr('Ghairi'))),
                  FilledButton(
                      onPressed: () {
                        if (form.currentState!.validate()) {
                          Navigator.pop(context, true);
                        }
                      },
                      child: Text(L.tr('Hifadhi')))
                ]));
    final quantity = number(qty.text),
        perDose = number(units.text),
        low = number(threshold.text),
        unitText = unit.text.trim();
    Future.delayed(const Duration(milliseconds: 400), () {
      qty.dispose();
      units.dispose();
      unit.dispose();
      threshold.dispose();
    });
    if (saved == true && mounted) {
      await _action(
          '${item['id']}:stock:$quantity:$perDose:$low:$unitText',
          (key) => _repo.supply(item,
              quantity: quantity!,
              unitsPerDose: perDose,
              unit: unitText,
              threshold: low!,
              key: key));
    }
  }

  Widget _section(String title) => Padding(
      padding: const EdgeInsets.only(top: 26, bottom: 12),
      child: Text(L.tr(title),
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(fontWeight: FontWeight.w700)));
  Widget _stats() {
    final s = _data!['summary'] as Map;
    return ProfileCard(
        emphasis: true,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(L.tr('Siku {0}', [(_data!['window'] as Map?)?['days'] ?? _days]),
              style: const TextStyle(color: Colors.white)),
          Text(
              s['reported_taken_percent'] == null
                  ? '—'
                  : '${s['reported_taken_percent']}%',
              style: const TextStyle(
                  fontSize: 40,
                  color: Colors.white,
                  fontWeight: FontWeight.w700)),
          Text(L.tr('Dozi ulizoripoti kuwa umekunywa'),
              style: const TextStyle(
                  color: Colors.white, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text(
              L.tr('{0} kati ya dozi {1} zilizotarajiwa',
                  [s['taken'], s['due']]),
              style: const TextStyle(color: Colors.white)),
          const SizedBox(height: 14),
          Text(
              L.tr(
                  'Kutokujibu hakumaanishi umeruka dawa. Ripoti hizi si uthibitisho wa kitabibu.'),
              style: TextStyle(
                  color: Colors.white.withValues(alpha: .9), fontSize: 13)),
          const SizedBox(height: 12),
          Wrap(spacing: 14, runSpacing: 8, children: [
            Text(L.tr('Zimerukwa: {0}', [s['skipped']]),
                style: const TextStyle(color: Colors.white)),
            Text(L.tr('Hazijathibitishwa: {0}', [s['unconfirmed']]),
                style: const TextStyle(color: Colors.white)),
            if ((s['delayed'] as num) > 0)
              Text(L.tr('Zimeripotiwa kuchelewa: {0}', [s['delayed']]),
                  style: const TextStyle(color: Colors.white))
          ]),
        ]));
  }

  Widget _trend() {
    final p = AppPalette.of(context);
    final rows = (_data!['trend'] as List).cast<Map>();
    return ProfileCard(
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(spacing: 12, runSpacing: 6, children: [
        Text(L.tr('Nimekunywa'), style: TextStyle(color: p.petrol)),
        Text(L.tr('Nimeruka'), style: TextStyle(color: p.clay)),
        Text(L.tr('Sijathibitisha'), style: TextStyle(color: p.inkSoft))
      ]),
      if (rows.isEmpty)
        Padding(
            padding: const EdgeInsets.only(top: 14),
            child:
                Text(L.tr('Hakuna dozi zinazotarajiwa kwenye kipindi hiki.'))),
      for (final row in rows)
        Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Semantics(
                label: L.tr(
                    '{0}: nimekunywa {1}, nimeruka {2}, sijathibitisha {3}', [
                  row['date'],
                  row['taken'],
                  row['skipped'],
                  (row['unconfirmed'] as num) + (row['delayed'] as num)
                ]),
                child: Row(children: [
                  SizedBox(
                      width: 58,
                      child: Text(
                          DateFormat('dd/MM')
                              .format(DateTime.parse(row['date'] as String)),
                          style: const TextStyle(fontSize: 13))),
                  Expanded(
                      child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: Row(children: [
                            for (final entry in {
                              p.petrol: (row['taken'] as num).toInt(),
                              p.clay: (row['skipped'] as num).toInt(),
                              p.line: (row['unconfirmed'] as num).toInt() +
                                  (row['delayed'] as num).toInt()
                            }.entries)
                              if (entry.value > 0)
                                Expanded(
                                    flex: entry.value,
                                    child: Container(
                                        height: 12, color: entry.key)),
                          ]))),
                  const SizedBox(width: 10),
                  Text('${row['taken']}/${row['due']}',
                      style: const TextStyle(fontSize: 13)),
                ]))),
      const SizedBox(height: 14),
      Text(L.tr('Ratiba hai pekee · Africa/Dar_es_Salaam'),
          style: TextStyle(color: p.inkSoft, fontSize: 12)),
    ]));
  }

  Widget _dose(Map<String, dynamic> d) {
    final time = DateTime.parse(d['scheduled_at'] as String);
    final finalReport = {'taken', 'missed'}.contains(d['reported_status']);
    final actionable = !_busy &&
        !finalReport &&
        d['schedule_status'] == 'active' &&
        !time.isAfter(DateTime.now());
    final status = {
          'taken': L.tr('Nimekunywa'),
          'missed': L.tr('Nimeruka'),
          'delayed': L.tr('Nimeripoti kuchelewa')
        }[d['reported_status']] ??
        (time.isAfter(DateTime.now())
            ? L.tr('Inakuja')
            : L.tr('Bado haijathibitishwa'));
    return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: ProfileCard(
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
              Text(d['medication_name'] as String,
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              Text('${d['dosage']} · ${_when(d['scheduled_at'])}'),
              const SizedBox(height: 8),
              Text(status,
                  style: TextStyle(
                      color: AppPalette.of(context).petrol,
                      fontWeight: FontWeight.w600)),
              if (d['snoozed_until'] != null)
                Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(L.tr(
                        'Kikumbusho kimesogezwa hadi {0}; muda wa dozi haujabadilishwa.',
                        [_when(d['snoozed_until'])]))),
              if (actionable) ...[
                const SizedBox(height: 14),
                Wrap(spacing: 10, runSpacing: 8, children: [
                  FilledButton.icon(
                      onPressed: () => _action('${d['id']}:taken',
                          (key) => _repo.report(d, taken: true, key: key)),
                      icon: const Icon(Icons.check_rounded),
                      label: Text(L.tr('Nimekunywa'))),
                  OutlinedButton(
                      onPressed: () => _skip(d), child: Text(L.tr('Nimeruka'))),
                  PopupMenuButton<int>(
                      tooltip: L.tr('Nikumbushe baadaye'),
                      onSelected: (minutes) => _action(
                          '${d['id']}:snooze:$minutes',
                          (key) => _repo.snooze(d, minutes, key)),
                      itemBuilder: (_) => [
                            for (final minutes in [5, 10, 15, 30])
                              PopupMenuItem(
                                  value: minutes,
                                  child: Text(
                                      L.tr('Baada ya dakika {0}', [minutes])))
                          ],
                      child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Text(L.tr('Nikumbushe baadaye')))),
                ])
              ],
              if (d['schedule_status'] != 'active')
                Text(L.tr('Ratiba haiko hai; wasiliana na daktari.')),
            ])));
  }

  Widget _medicine(Map<String, dynamic> item) {
    final stock = item['supply'] as Map?;
    final url = Uri.tryParse(item['image_url'] as String? ?? '');
    return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: ProfileCard(
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SizedBox(
                    width: 72,
                    height: 72,
                    child: url?.scheme == 'https'
                        ? Image.network(url.toString(),
                            fit: BoxFit.contain,
                            errorBuilder: (_, __, ___) =>
                                const Icon(Icons.medication_outlined, size: 40))
                        : const Icon(Icons.medication_outlined, size: 40)),
                const SizedBox(width: 14),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text(item['medication_name'] as String,
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 6),
                      Text(item['dosage'] as String)
                    ]))
              ]),
              if (url?.scheme != 'https')
                Text(L.tr('Picha iliyoidhinishwa haijapatikana.'),
                    style: TextStyle(
                        color: AppPalette.of(context).inkSoft, fontSize: 12)),
              if (item['instructions'] != null) ...[
                const SizedBox(height: 12),
                Text(item['instructions'] as String)
              ],
              if (item['education'] != null) ...[
                const SizedBox(height: 12),
                Text(item['education'] as String)
              ],
              const SizedBox(height: 10),
              Text(L.tr('Taarifa kutoka kwa daktari aliyeandika dawa.'),
                  style: TextStyle(
                      color: AppPalette.of(context).inkSoft, fontSize: 12)),
              const Divider(height: 24),
              if (stock == null)
                Text(L.tr('Akiba haijarekodiwa.'))
              else ...[
                Text(
                    L.tr('Akiba iliyokadiriwa: {0} {1}',
                        [stock['remaining'], stock['unit_label']]),
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Text(
                    L.tr(
                        'Makadirio kutoka kiasi ulichoingiza na dozi ulizoripoti; si stock iliyothibitishwa na pharmacy.'),
                    style: TextStyle(
                        color: AppPalette.of(context).inkSoft, fontSize: 12)),
                if (stock['low_stock'] == true)
                  Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: Notice(
                          L.tr(
                              'Akiba imepungua. Wasiliana na pharmacy au hospitali kuhusu refill.'),
                          tone: NoticeTone.attention)),
              ],
              const SizedBox(height: 10),
              OutlinedButton.icon(
                  onPressed: _busy ? null : () => _supply(item),
                  icon: const Icon(Icons.inventory_2_outlined),
                  label: Text(L.tr('Sasisha akiba niliyonayo'))),
            ])));
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final p = AppPalette.of(context);
    final profiles = (_data?['profiles'] as List? ?? []).cast<Map>();
    final nearby = _doses.where((d) {
      final at = DateTime.parse(d['scheduled_at'] as String);
      return at.isAfter(DateTime.now().subtract(const Duration(days: 1))) &&
          at.isBefore(DateTime.now().add(const Duration(days: 1)));
    }).toList();
    return Scaffold(
        appBar: AppBar(title: Text(L.tr('Dawa na ufuatiliaji')), actions: [
          IconButton(
              tooltip: L.tr('Sasisha'),
              onPressed: _loading || _busy ? null : _load,
              icon: const Icon(Icons.refresh_rounded))
        ]),
        body: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
                padding: const EdgeInsets.all(20),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  Center(
                      child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 720),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (profiles.length > 1)
                                  DropdownButtonFormField<String>(
                                      key: ValueKey(_data?['patient']['id']),
                                      initialValue:
                                          _data?['patient']['id'] as String?,
                                      decoration: InputDecoration(
                                          labelText: L.tr('Mgonjwa')),
                                      items: [
                                        for (final profile in profiles)
                                          DropdownMenuItem(
                                              value: profile['id'] as String,
                                              child: Text(profile['full_name']
                                                  as String))
                                      ],
                                      onChanged: _busy
                                          ? null
                                          : (id) {
                                              setState(() {
                                                _profile = id;
                                                _data = null;
                                                _doses = [];
                                                _keys.clear();
                                              });
                                              _load();
                                            }),
                                if (_error != null) ...[
                                  Notice(_error!, tone: NoticeTone.attention),
                                  TextButton(
                                      onPressed: _load,
                                      child: Text(L.tr('Jaribu tena')))
                                ],
                                if (_loading && _data == null)
                                  const Padding(
                                      padding: EdgeInsets.all(40),
                                      child: Center(
                                          child: CircularProgressIndicator())),
                                if (_loading && _data != null)
                                  const LinearProgressIndicator(),
                                if (_data != null) ...[
                                  ProfileCard(
                                      padding: EdgeInsets.zero,
                                      child: Column(children: [
                                        SwitchListTile(
                                            value: _device['enabled'] == true,
                                            onChanged: _busy ||
                                                    _device['available'] ==
                                                        false
                                                ? null
                                                : (enabled) =>
                                                    _action('device:$enabled',
                                                        (_) async {
                                                      await MedicationReminders
                                                          .enable(enabled);
                                                    }),
                                            title: Text(L.tr(
                                                'Vikumbusho kwenye simu hii')),
                                            subtitle: Text(L.tr(
                                                'Arifa yenye sauti, bila kuonyesha jina la dawa kwenye lock screen.'))),
                                        if (_device['enabled'] == true &&
                                            _device['notifications_allowed'] !=
                                                true)
                                          Padding(
                                              padding: const EdgeInsets.all(16),
                                              child: Text(L.tr(
                                                  'Ruhusa ya arifa haijatolewa. Vikumbusho havitatoa taarifa.'))),
                                        if (_device['enabled'] == true &&
                                            _device['exact_allowed'] != true)
                                          Padding(
                                              padding: const EdgeInsets.all(16),
                                              child: Column(children: [
                                                Text(L.tr(
                                                    'Muda wa arifa unaweza kuchelewa bila ruhusa ya alarm sahihi.')),
                                                TextButton(
                                                    onPressed:
                                                        MedicationReminders
                                                            .exactSettings,
                                                    child: Text(L.tr(
                                                        'Ruhusu alarm sahihi')))
                                              ])),
                                        if (_device['enabled'] == true)
                                          Padding(
                                              padding:
                                                  const EdgeInsets.fromLTRB(
                                                      16, 0, 16, 16),
                                              child: Text(L.tr(
                                                  'Vikumbusho vya karibu vilivyohifadhiwa: {0}',
                                                  [
                                                    _device['scheduled_count'] ??
                                                        0
                                                  ]))),
                                        if (_device['enabled'] == true &&
                                            (_device['coverage_end'] as num? ??
                                                    0) >
                                                0)
                                          Padding(
                                            padding: const EdgeInsets.fromLTRB(
                                                16, 0, 16, 16),
                                            child: Text(L.tr(
                                                'Vikumbusho vimehifadhiwa hadi {0}. Fungua app ukiwa na intaneti kusasisha ratiba.',
                                                [
                                                  _when(DateTime
                                                          .fromMillisecondsSinceEpoch(
                                                              (_device['coverage_end']
                                                                      as num)
                                                                  .toInt())
                                                      .toIso8601String())
                                                ])),
                                          ),
                                      ])),
                                  const SizedBox(height: 20),
                                  Wrap(spacing: 10, children: [
                                    for (final days in [7, 30])
                                      ChoiceChip(
                                          label: Text(L.tr('Siku {0}', [days])),
                                          selected: _days == days,
                                          onSelected: _busy
                                              ? null
                                              : (_) {
                                                  setState(() => _days = days);
                                                  _load();
                                                })
                                  ]),
                                  const SizedBox(height: 12),
                                  _stats(),
                                  _section('Mwenendo wa dozi'),
                                  _trend(),
                                  _section('Dozi za karibu'),
                                  if (nearby.isEmpty)
                                    Text(L.tr(
                                        'Hakuna dozi iliyopangiwa karibu na sasa.')),
                                  ...nearby.take(60).map(_dose),
                                  OutlinedButton.icon(
                                      onPressed: () => Navigator.of(context)
                                          .push(MaterialPageRoute(
                                              builder: (_) =>
                                                  const CareContinuityScreen())),
                                      icon: const Icon(
                                          Icons.calendar_month_outlined),
                                      label: Text(L.tr(
                                          'Ratiba nzima na mipangilio ya SMS'))),
                                  _section('Maelekezo na akiba'),
                                  ...(_data!['medicines'] as List).map((item) =>
                                      _medicine(Map<String, dynamic>.from(
                                          item as Map))),
                                  if (_data!['medicines_truncated'] == true)
                                    Text(L.tr(
                                        'Orodha imefikia kikomo. Angalia maagizo yote.')),
                                  TextButton.icon(
                                      onPressed: () => Navigator.of(context)
                                          .push(MaterialPageRoute(
                                              builder: (_) =>
                                                  const PatientCareMedicinesScreen())),
                                      icon: const Icon(
                                          Icons.description_outlined),
                                      label: Text(
                                          L.tr('Maagizo yote na pharmacy'))),
                                  const SizedBox(height: 16),
                                  Text(
                                      L.tr(
                                          'SMS na WhatsApp halisi zinahitaji huduma iliyowezeshwa. Hakuna ujumbe wa WhatsApp unaotumwa kwa sasa.'),
                                      style: TextStyle(
                                          color: p.inkSoft, fontSize: 13)),
                                  TextButton.icon(
                                      onPressed: () => emergency(context),
                                      icon:
                                          const Icon(Icons.emergency_outlined),
                                      label: Text(L.tr('Msaada wa dharura'))),
                                ],
                              ])))
                ])));
  }
}
