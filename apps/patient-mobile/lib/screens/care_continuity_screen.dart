import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart' show ApiException;
import '../core/care_continuity.dart';
import '../core/session.dart';
import '../core/theme.dart';
import 'checkins_screen.dart';
import 'thread_screen.dart';

class CareContinuityScreen extends StatefulWidget {
  const CareContinuityScreen({super.key, this.repository});
  final CareContinuityRepository? repository;
  @override
  State<CareContinuityScreen> createState() => _CareContinuityScreenState();
}
class _CareContinuityScreenState extends State<CareContinuityScreen> with WidgetsBindingObserver {
  late final CareContinuityRepository _repo;
  CareOverview? _data;
  List<Map<String, dynamic>> _doses = [];
  String? _profile, _owner, _error, _notice;
  bool _loading = true, _busy = false, _signedOut = false, _foreground = true;
  int _generation = 0, _tab = 0, _pollCount = 0;
  Timer? _poll;
  final Map<String, String> _keys = {};
  @override
  void initState() {
    super.initState(); _repo = widget.repository ?? CareContinuityRepository();
    Session.identityChanges.addListener(_identityChanged); WidgetsBinding.instance.addObserver(this);
    _load();
    // Bounded in-app freshness; not a background notification or handset alarm.
    _poll = Timer.periodic(const Duration(seconds: 60), (_) {
      if (_pollCount++ >= 30) { _poll?.cancel(); return; }
      if (_foreground && !_busy && !_loading && !_signedOut) _load(quiet: true);
    });
  }
  @override
  void dispose() { _generation++; _poll?.cancel(); _keys.clear();
    Session.identityChanges.removeListener(_identityChanged); WidgetsBinding.instance.removeObserver(this); super.dispose(); }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) { _foreground = state == AppLifecycleState.resumed; }
  void _identityChanged() {
    _generation++; _poll?.cancel(); _keys.clear();
    if (!mounted) return;
    setState(() { _data = null; _doses = []; _profile = null; _owner = null; _error = null; _notice = null;
      _signedOut = true; _loading = false; _busy = false; });
  }
  Future<bool> _current(int revision, String? owner) async {
    if (!mounted || _signedOut || revision != _generation || owner == null) return false;
    final active = await Session.userId();
    return mounted && !_signedOut && revision == _generation && active == owner && _owner == owner;
  }
  Future<void> _load({bool more = false, bool quiet = false}) async {
    if (_signedOut || _busy) return;
    final generation = ++_generation;
    final owner = await Session.userId();
    if (!mounted || generation != _generation || _signedOut) return;
    _owner = owner;
    if (owner == null) { _identityChanged(); return; }
    setState(() { _loading = !quiet; _error = null; });
    try {
      final data = await _repo.overview(profileId: _profile, cursor: more ? _data?.nextCursor : null);
      if (!await _current(generation, owner)) return;
      setState(() { _data = data; _profile = data.patient['id'] as String;
        _doses = more ? [..._doses, ...data.doses] : data.doses; });
    } catch (e) {
      if (await _current(generation, owner)) setState(() { _data = null; _doses = []; _error = e is ApiException ? e.message : 'Ufuatiliaji haujapatikana. Jaribu tena.'; });
    } finally { if (await _current(generation, owner)) setState(() => _loading = false); }
  }
  Future<void> _mutate(String fingerprint, Future<void> Function(String key) operation, String message) async {
    if (_busy || _signedOut) return;
    final generation = _generation, owner = _owner;
    final key = _keys.putIfAbsent(fingerprint, newCareRequestKey);
    setState(() { _busy = true; _error = null; _notice = null; });
    try {
      await operation(key);
      if (!await _current(generation, owner)) return;
      _keys.remove(fingerprint);
      setState(() { _busy = false; _notice = message; });
      await _load();
    } catch (e) {
      if (await _current(generation, owner)) setState(() {
        if (e is ApiException && {400, 403, 404, 409, 422}.contains(e.status)) _keys.remove(fingerprint);
        _error = e is ApiException ? e.message : 'Seva haijathibitisha jibu. Tumia Sasisha kabla ya kujaribu tena.';
        _busy = false;
      });
    }
  }
  String _when(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '');
    return date == null ? '—' : DateFormat('dd MMM, HH:mm').format(date.toLocal());
  }
  String _doseLabel(String value) => {
    'taken': 'Nimethibitisha nimetumia', 'patient_reported_skipped': 'Nimeripoti sikutumia',
    'patient_reported_delayed': 'Nimeripoti kuchelewa', 'not_confirmed': 'Bado haijathibitishwa', 'upcoming': 'Inakuja',
  }[value] ?? value;
  Widget _message(String message, {bool problem = false}) => Container(
    width: double.infinity, margin: const EdgeInsets.only(bottom: 16), padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: problem ? const Color(0xFFFFF1EC) : AppColors.paperSunk,
      borderRadius: BorderRadius.circular(16), border: Border.all(color: problem ? AppColors.clay : AppColors.line)),
    child: Semantics(liveRegion: true, child: Text(message, style: TextStyle(color: problem ? AppColors.clay : AppColors.inkSoft, fontSize: 14))),
  );
  Widget _panel(List<Widget> children) => Container(
    margin: const EdgeInsets.only(bottom: 16), padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: AppColors.line)),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
  );
  Widget _dose(Map<String, dynamic> d) {
    final state = d['state'] as String? ?? 'not_confirmed';
    final confirmedTiming = d['schedule_status'] == 'active' || d['schedule_status'] == 'paused';
    final canReport = confirmedTiming && {'unreported', 'delayed'}.contains(d['reported_status']) &&
      (DateTime.tryParse(d['scheduled_at'] as String)?.isAfter(DateTime.now()) == false);
    return _panel([
      Row(children: [const Icon(Icons.medication_outlined, color: AppColors.petrol), const SizedBox(width: 10),
        Expanded(child: Text(d['medication_name'] as String, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 18)))]),
      const SizedBox(height: 10), Text('${d['dosage']} · ${_when(d['scheduled_at'])}'),
      const SizedBox(height: 6), Text(_doseLabel(state), key: ValueKey('dose-state-${d['id']}'), style: const TextStyle(color: AppColors.inkSoft, fontSize: 14)),
      if (!confirmedTiming) ...[const SizedBox(height: 8), const Text('Daktari bado hajathibitisha muda wa kikumbusho. Fuata maagizo yako; usibadili matumizi kutokana na saa iliyoonyeshwa.', style: TextStyle(fontSize: 13, color: AppColors.inkSoft))],
      if (canReport) ...[const SizedBox(height: 14), Wrap(spacing: 8, runSpacing: 8, children: [
        for (final choice in [('taken', 'Nimetumia'), ('missed', 'Sikutumia'), ('delayed', 'Nimechelewa')])
          OutlinedButton(onPressed: _busy ? null : () => _mutate('dose:${d['id']}:${d['version']}:${choice.$1}',
            (key) => _repo.reportDose(d, choice.$1, key), 'Jibu lako limethibitishwa na seva.'), child: Text(choice.$2)),
      ])],
    ]);
  }
  List<Widget> _medications(CareOverview data) => [
    _message('Kikumbusho si uthibitisho wa kutumia dawa. Usipojibu, mfumo huonyesha “Bado haijathibitishwa”; hauandiki kwamba hukutumia dawa.'),
    if (_doses.isEmpty) _panel([const Text('Hakuna dozi kwenye kipindi hiki.', style: TextStyle(fontWeight: FontWeight.w600)),
      const SizedBox(height: 6), const Text('Ratiba huonekana baada ya daktari kuthibitisha muda wa dawa kwenye prescription yako.')]),
    ..._doses.map(_dose),
    if (data.nextCursor != null) OutlinedButton(onPressed: _loading || _busy ? null : () => _load(more: true), child: const Text('Onyesha zaidi')),
    if (data.plans.isNotEmpty) ...[const SizedBox(height: 12), const Text('Ratiba zilizowekwa na daktari', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)), const SizedBox(height: 12),
      ...data.plans.map((item) {
        final plan = item['plan'] == null ? null : careObject(item['plan']);
        return _panel([Text(item['medication_name']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w600)), const SizedBox(height: 6),
          Text(plan == null ? 'Muda wa kikumbusho haujawekwa.' : '${(plan['times'] as List).join(' · ')}  (${plan['timezone']})'),
          if (plan != null) Text('Kuanzia ${plan['start_date']} · ${plan['status']}', style: const TextStyle(fontSize: 13, color: AppColors.inkSoft))]);
      }),
    ],
  ];
  List<Widget> _followup(CareOverview data) => [
    if (data.cycles.isEmpty) _panel([const Text('Hakuna mpango wa ufuatiliaji unaoendelea.'), const SizedBox(height: 8), const Text('Daktari akipanga ufuatiliaji baada ya consultation, utaonekana hapa.')]),
    ...data.cycles.map((cycle) => _panel([
      const Text('Mpango wa ufuatiliaji', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
      const SizedBox(height: 6), Text('Mwisho wa kipindi: ${_when(cycle['end_date'])}'),
      if (cycle['review_due'] == true) ...[const SizedBox(height: 8), const Text('Kipindi kimeisha; ukaguzi wa daktari unasubiri. Hii haimaanishi umepona.', style: TextStyle(color: AppColors.inkSoft))],
      const SizedBox(height: 12), OutlinedButton.icon(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ThreadScreen(
        careThreadId: cycle['care_thread_id'] as String, title: 'Mawasiliano ya ufuatiliaji'))), icon: const Icon(Icons.chat_bubble_outline), label: const Text('Wasiliana na daktari')),
      if (careRows(cycle['checkins']).isNotEmpty) OutlinedButton.icon(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CheckInsScreen())),
        icon: const Icon(Icons.checklist), label: const Text('Jibu maswali ya ufuatiliaji')),
      ...careRows(cycle['contacts']).map((contact) => Padding(padding: const EdgeInsets.only(top: 12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${contact['channel'] == 'phone' ? 'Mawasiliano ya simu' : 'Mazungumzo kwenye app'} · ${_when(contact['scheduled_at'])}', style: const TextStyle(fontWeight: FontWeight.w600)),
        Text(contact['purpose'] as String), Text('Hali: ${contact['status']}', style: const TextStyle(color: AppColors.inkSoft, fontSize: 13)),
      ]))),
    ])),
    _message('Ratiba ya simu haimaanishi simu imepigwa. Kwa hali ya dharura, tafuta msaada wa haraka; usisubiri ujumbe wa follow-up.'),
  ];
  List<Widget> _reminders(CareOverview data) => [
    _panel([
      const Text('Vikumbusho vya ujumbe mfupi', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
      const SizedBox(height: 8), const Text('Kwa hiari yako, ruhusu ujumbe wa jumla kwenye namba ya akaunti/guardian. Hautajumuisha jina la dawa. Inahitaji SMS provider aliyesanidiwa.'),
      SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Ruhusu SMS'), value: data.preference['sms_enabled'] as bool,
        onChanged: _busy ? null : (value) => _mutate('preference:${data.patient['id']}:${data.preference['version']}:$value',
          (key) => _repo.preference(data.patient['id'] as String, data.preference['version'] as int, value, key), 'Chaguo la vikumbusho limehifadhiwa.')),
    ]),
    if (data.reminders.isEmpty) _panel([const Text('Hakuna kikumbusho kipya. Vikumbusho hutengenezwa kwa muda uliothibitishwa na daktari.')]),
    ...data.reminders.map((r) => _panel([
      Text(r['adherence_log_id'] != null ? 'Kikumbusho cha mpango wa dawa' : 'Kikumbusho cha check-in', style: const TextStyle(fontWeight: FontWeight.w600)),
      const SizedBox(height: 6), Text(_when(r['due_at'])), Text('Delivery: ${r['delivery']}', style: const TextStyle(fontSize: 13, color: AppColors.inkSoft)),
      if (r['delivery'] == 'simulated') const Text('Majaribio ya ndani; hakuna SMS ya carrier iliyothibitishwa.', style: TextStyle(fontSize: 13)),
      if (r['read_at'] == null) TextButton(onPressed: _busy ? null : () => _mutate('read:${r['id']}',
        (key) => _repo.markRead(r['id'] as String, key), 'Kikumbusho kimewekwa kuwa kimesomwa.'), child: const Text('Nimesoma')),
    ])),
  ];
  @override
  Widget build(BuildContext context) {
    final data = _data;
    return Scaffold(appBar: AppBar(title: const Text('Ufuatiliaji wangu'), actions: [IconButton(tooltip: 'Sasisha', onPressed: _busy || _signedOut ? null : () => _load(), icon: const Icon(Icons.refresh))]),
      body: SafeArea(child: _signedOut ? Center(child: Padding(padding: const EdgeInsets.all(24), child: _message('Akaunti imebadilika. Rudi Home kisha ufungue ufuatiliaji upya.')))
      : RefreshIndicator(onRefresh: () => _load(), child: ListView(padding: const EdgeInsets.all(20), physics: const AlwaysScrollableScrollPhysics(), children: [
        Container(padding: const EdgeInsets.all(22), margin: const EdgeInsets.only(bottom: 20), decoration: BoxDecoration(color: AppColors.petrol, borderRadius: BorderRadius.circular(24)), child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('TUKO PAMOJA, HATA BAADA YA HUDUMA', style: TextStyle(color: Color(0xFFD5E9DF), fontSize: 11, letterSpacing: 1.2)), SizedBox(height: 10),
          Text('Hatua ndogo.\nUfuatiliaji wa karibu.', style: TextStyle(color: Colors.white, fontSize: 27, fontWeight: FontWeight.w600, height: 1.15)), SizedBox(height: 10),
          Text('Ratiba, majibu yako na mawasiliano ya daktari — sehemu moja.', style: TextStyle(color: Color(0xFFE4F0E8), fontSize: 14)),
        ])),
        if (_loading) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
        if (_error != null) _message(_error!, problem: true),
        if (_notice != null) _message(_notice!),
        if (data != null && !_loading) ...[
          if (data.profiles.length > 1) DropdownButtonFormField<String>(value: _profile, decoration: const InputDecoration(labelText: 'Mgonjwa'),
            items: data.profiles.map((p) => DropdownMenuItem(value: p['id'] as String, child: Text(p['full_name'] as String))).toList(),
            onChanged: _busy ? null : (id) { _generation++; setState(() { _profile = id; _data = null; _doses = []; }); _load(); }),
          const SizedBox(height: 14), Wrap(spacing: 8, children: [for (final tab in [(0, 'Dawa'), (1, 'Follow-up'), (2, 'Vikumbusho')])
            ChoiceChip(label: Text(tab.$2), selected: _tab == tab.$1, onSelected: (_) => setState(() => _tab = tab.$1))]),
          const SizedBox(height: 20), ...(_tab == 0 ? _medications(data) : _tab == 1 ? _followup(data) : _reminders(data)),
          Text('Taarifa za seva: ${_when(data.raw['as_of'])}', style: const TextStyle(color: AppColors.inkSoft, fontSize: 12)),
        ],
        if (_busy) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
      ]))),
    );
  }
}
