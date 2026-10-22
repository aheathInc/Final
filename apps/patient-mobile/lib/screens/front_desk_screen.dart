import 'dart:async';
import 'package:flutter/material.dart';
import '../core/front_desk.dart';
import '../core/api.dart' show ApiException;
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'consultation_detail_screen.dart';
import 'emergency_screen.dart';

/// Online-only hospital intake. Never puts registration/clearance into the outbox.
class FrontDeskScreen extends StatefulWidget {
  const FrontDeskScreen({super.key, this.repository});
  final FrontDeskRepository? repository;
  @override
  State<FrontDeskScreen> createState() => _FrontDeskScreenState();
}
class _FrontDeskScreenState extends State<FrontDeskScreen> with WidgetsBindingObserver {
  late final FrontDeskRepository _repo;
  final _purpose = TextEditingController();
  List<Map<String, dynamic>> _facilities = [], _departments = [], _suggestions = [];
  List<FrontDeskVisit> _visits = [];
  Map<String, dynamic>? _board, _pendingRequest;
  FrontDeskVisit? _selected;
  String? _facilityId, _departmentId, _clinicianId, _owner, _error, _notice;
  bool _share = false, _urgent = false, _busy = true, _sessionChanged = false, _showVisits = false;
  int _generation = 0, _polls = 0;
  Timer? _poll;
  bool _foreground = true;
  @override
  void initState() {
    super.initState(); _repo = widget.repository ?? FrontDeskRepository();
    WidgetsBinding.instance.addObserver(this);
    Session.identityChanges.addListener(_invalidateIdentity);
    _initialise();
  }
  @override
  void dispose() {
    _generation += 1; _poll?.cancel(); _purpose.dispose();
    Session.identityChanges.removeListener(_invalidateIdentity);
    WidgetsBinding.instance.removeObserver(this); super.dispose();
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) { _foreground = state == AppLifecycleState.resumed; }
  void _invalidateIdentity() {
    ++_generation; _poll?.cancel(); _purpose.clear();
    if (!mounted) return;
    setState(() { _sessionChanged = true; _busy = false; _owner = null;
      _selected = null; _visits = []; _pendingRequest = null; _board = null;
      _departments = []; _suggestions = []; _facilityId = null; _departmentId = null; _clinicianId = null;
      _error = null; _notice = null; _share = false; _urgent = false;
    });
  }
  Future<bool> _current(int generation) async {
    final owner = _owner;
    if (!mounted || _sessionChanged || generation != _generation || owner == null) return false;
    final currentOwner = await Session.userId();
    // Recheck AFTER asynchronous secure-storage read: logout/dispose can occur while awaiting it.
    return mounted && !_sessionChanged && generation == _generation && owner == _owner && currentOwner == owner;
  }
  Future<void> _initialise() async {
    if (!mounted || _sessionChanged) return;
    setState(() { _busy = true; _error = null; });
    final generation = ++_generation;
    _owner = await Session.userId();
    if (_owner == null) { if (mounted) setState(() { _busy = false; _sessionChanged = true; }); return; }
    try {
      final results = await Future.wait([_repo.facilities(), _repo.visits()]);
      if (!await _current(generation)) return;
      setState(() { _facilities = results[0] as List<Map<String, dynamic>>; _visits = results[1] as List<FrontDeskVisit>; _busy = false; });
    } catch (_) { if (await _current(generation)) setState(() { _busy = false; _error = 'Huduma haijapatikana. Hakuna ombi jipya lililotumwa.'; }); }
  }
  Future<void> _chooseFacility(String? id) async {
    final generation = ++_generation;
    setState(() { _facilityId = id; _share = false; _departmentId = null; _clinicianId = null; _departments = []; _suggestions = []; _board = null; _error = null; _busy = id != null; });
    if (id == null) return;
    try { final rows = await _repo.departments(id); if (await _current(generation)) setState(() => _departments = rows); }
    catch (_) { if (await _current(generation)) setState(() => _error = 'Idara hazikupatikana. Jaribu kuchagua kituo tena.'); }
    finally { if (await _current(generation)) setState(() => _busy = false); }
  }
  Future<void> _chooseDepartment(String? id) async {
    final facility = _facilityId; if (facility == null) return;
    final generation = ++_generation;
    setState(() { _departmentId = id; _share = false; _clinicianId = null; _board = null; _error = null; _busy = id != null; });
    if (id == null) return;
    try { final board = await _repo.board(facility, id); if (await _current(generation)) setState(() => _board = board); }
    catch (_) { if (await _current(generation)) setState(() => _error = 'Availability ya madaktari haijathibitishwa. Chagua idara tena kujaribu.'); }
    finally { if (await _current(generation)) setState(() => _busy = false); }
  }
  Future<void> _suggest() async {
    if (_facilityId == null || _purpose.text.trim().isEmpty) return;
    final generation = ++_generation;
    setState(() { _busy = true; _error = null; _suggestions = []; });
    try {
      final data = await _repo.suggest(_facilityId!, _purpose.text.trim());
      if (!await _current(generation)) return;
      final rows = (data['suggestions'] as List).map(deskRecord).toList();
      setState(() { _suggestions = rows; _notice = rows.isEmpty ? 'Hakuna idara iliyolinganishwa. Chagua mwenyewe au omba msaada wa hospitali.' : 'Haya ni mapendekezo ya majina ya huduma tu. Chagua idara; haya si matokeo ya uchunguzi wa kitabibu.'; });
    } catch (_) { if (await _current(generation)) setState(() => _error = 'Pendekezo halikupatikana; bado unaweza kuchagua idara.'); }
    finally { if (await _current(generation)) setState(() => _busy = false); }
  }
  Future<void> _register() async {
    if (_urgent || !_share || _facilityId == null || _departmentId == null || _purpose.text.trim().isEmpty) return;
    _pendingRequest ??= Map<String, dynamic>.unmodifiable({
      'request_key': newFrontDeskRequestKey(), 'facility_id': _facilityId, 'department_id': _departmentId,
      if (_clinicianId != null) 'requested_clinician_id': _clinicianId,
      'purpose': _purpose.text.trim(), 'share_with_department': true, 'urgent_help_requested': false,
    });
    final generation = ++_generation;
    setState(() { _busy = true; _error = null; _notice = null; });
    try {
      final visit = await _repo.register(_pendingRequest!);
      if (!await _current(generation)) return;
      setState(() { _selected = visit; _pendingRequest = null; _showVisits = true; _purpose.clear(); _share = false; _notice = 'Ziara imehifadhiwa. Hii si uthibitisho wa malipo, bima au kuruhusiwa kuruka triage.'; });
      _startPolling();
      try {
        final rows = await _repo.visits();
        if (await _current(generation)) setState(() => _visits = rows);
      } catch (_) {
        if (await _current(generation)) setState(() => _notice = 'Ziara ${visit.ticket} imehifadhiwa. Orodha haikusasishwa; tumia Refresh.');
      }
    } catch (error) {
      if (await _current(generation)) setState(() {
        final rejected = error is ApiException && {403, 404, 409, 422}.contains(error.status);
        if (rejected) _pendingRequest = null; // Server explicitly rejected; a corrected request may use a new key.
        _error = rejected
          ? 'Ombi limekataliwa: $error. Kagua Ziara zangu au rekebisha chaguo lako.'
          : 'Ombi halijathibitishwa: $error. Retry hutumia request ileile. Angalia Ziara zangu kabla ya ombi jingine.';
      });
    } finally { if (await _current(generation)) setState(() => _busy = false); }
  }
  Future<void> _refresh({String? visitId}) async {
    if (_busy || _sessionChanged) return;
    final generation = ++_generation;
    final id = visitId ?? _selected?.id;
    setState(() { _busy = true; _error = null; _selected = null; _visits = []; });
    try {
      final rows = await _repo.visits();
      final selected = id == null ? null : await _repo.visit(id);
      if (!await _current(generation)) return;
      setState(() { _visits = rows; _selected = selected; });
    } catch (_) { if (await _current(generation)) setState(() => _error = 'Hali ya ziara haikupatikana. Hatujaonyesha data ya zamani kama hali ya sasa.'); }
    finally { if (await _current(generation)) setState(() => _busy = false); }
  }
  void _startPolling() {
    _poll?.cancel(); _polls = 0;
    _poll = Timer.periodic(const Duration(seconds: 15), (timer) {
      if (!mounted || _sessionChanged || ++_polls > 20 || (_selected != null && {'completed','cancelled'}.contains(_selected!.status))) { timer.cancel(); return; }
      if (_foreground && _showVisits && !_busy && ModalRoute.of(context)?.isCurrent == true) { _refresh(); }
    });
  }
  Future<void> _action(FrontDeskVisit visit, String action) async {
    final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: Text(action == 'check-in' ? 'Umefika hospitalini?' : 'Ghairi ziara?'),
      content: Text(action == 'check-in' ? 'Thibitisha umefika kituoni. Bado utahitaji ukaguzi wa kituo na clinician.' : 'Ziara itaghairiwa. Hatuondoi rekodi za matibabu.'),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Rudi')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Thibitisha'))],
    ));
    if (confirmed != true || !mounted || _sessionChanged) return;
    final generation = ++_generation; setState(() { _busy = true; _error = null; });
    try {
      final result = await _repo.action(visit, action);
      if (await _current(generation)) setState(() {
        _selected = result;
        _visits = _visits.map((item) => item.id == result.id ? result : item).toList();
      });
    }
    catch (error) { if (await _current(generation)) setState(() => _error = 'Hatua haijathibitishwa: $error. Refresh kwanza.'); }
    finally { if (await _current(generation)) setState(() => _busy = false); }
  }
  Future<void> _openConsultation(FrontDeskVisit visit) async {
    final id = visit.consultationId; if (id == null) return;
    final generation = ++_generation; setState(() { _busy = true; _error = null; });
    try {
      final consultation = await _repo.consultation(id); if (!await _current(generation)) return;
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ConsultationDetailScreen(consultation: consultation)));
    } catch (_) { if (await _current(generation)) setState(() => _error = 'Consultation haikupatikana. Jaribu tena.'); }
    finally { if (await _current(generation)) setState(() => _busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final locked = _busy || _pendingRequest != null;
    return Scaffold(appBar: AppBar(title: const Text('Huduma hospitalini')), body: _sessionChanged
      ? const Center(child: Padding(padding: EdgeInsets.all(24), child: Text('Kikao kimebadilika. Rudi Home na ufungue huduma hii tena.')))
      : RefreshIndicator(onRefresh: _refresh, child: ListView(padding: const EdgeInsets.all(16), children: [
        const Notice('Hii ni foleni ya wagonjwa waliosajiliwa AHP pekee. Sio foleni nzima ya hospitali. Usitumie foleni hii kusubiri msaada wa dharura.'),
        const SizedBox(height: 12),
        SegmentedButton<bool>(segments: const [ButtonSegment(value: false, label: Text('Ziara mpya')), ButtonSegment(value: true, label: Text('Ziara zangu'))], selected: {_showVisits},
          onSelectionChanged: _busy ? null : (values) { setState(() => _showVisits = values.first); if (values.first) { _refresh(); _startPolling(); } }),
        const SizedBox(height: 16),
        if (_busy) const LinearProgressIndicator(),
        if (_error != null) ...[Notice(_error!),
          if (!_showVisits && _facilities.isEmpty) TextButton(onPressed: _busy ? null : _initialise, child: const Text('Pakia huduma tena'))],
        if (_notice != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(_notice!, style: const TextStyle(color: AppColors.inkSoft))),
        if (!_showVisits) ...[
          if (_facilities.isEmpty && !_busy && _error == null) const Empty('Hakuna kituo chenye digital front desk iliyowashwa. Wasiliana na hospitali yako.'),
          DropdownButtonFormField<String>(value: _facilityId, isExpanded: true, decoration: const InputDecoration(labelText: 'Hospitali / kituo'),
            items: _facilities.map((f) => DropdownMenuItem(value: f['id'] as String, child: Text(f['name'] as String))).toList(), onChanged: locked ? null : _chooseFacility),
          const SizedBox(height: 16),
          TextField(controller: _purpose, enabled: !locked, maxLength: 2000, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Unahitaji huduma gani?', helperText: 'Mfano: huduma ya meno. Hii si diagnosis.')),
          TextButton.icon(onPressed: locked || _facilityId == null ? null : _suggest, icon: const Icon(Icons.assistant_direction_outlined), label: const Text('Tafuta idara kwa maelezo yangu')),
          if (_suggestions.isNotEmpty) Wrap(spacing: 8, children: _suggestions.map((s) => ActionChip(label: Text(s['department_name'] as String), onPressed: locked ? null : () => _chooseDepartment(s['department_id'] as String))).toList()),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(value: _departmentId, isExpanded: true, decoration: const InputDecoration(labelText: 'Idara unayochagua'),
            items: _departments.map((d) => DropdownMenuItem(value: d['id'] as String, child: Text(d['name'] as String))).toList(), onChanged: locked || _facilityId == null ? null : _chooseDepartment),
          if (_board != null) ...[
            const SizedBox(height: 16),
            Text('Foleni ya idara (AHP): ${_board!['department_pool_waiting']} · muda wa kusubiri haujakadiriwa', style: const TextStyle(color: AppColors.inkSoft)),
            DropdownButtonFormField<String>(value: _clinicianId ?? '', isExpanded: true, decoration: const InputDecoration(labelText: 'Daktari (hiari)'),
              items: [const DropdownMenuItem(value: '', child: Text('Daktari yeyote wa idara aliyeidhinishwa')),
                ...((_board!['providers'] as List?) ?? []).map((raw) { final p = deskRecord(raw); return DropdownMenuItem(value: p['id'] as String, enabled: p['receiving_new_patients'] == true,
                  child: Text('${p['full_name'] ?? 'Clinician'}${p['receiving_new_patients'] == true ? '' : ' — hapokei sasa'}', overflow: TextOverflow.ellipsis)); })],
              onChanged: locked ? null : (id) => setState(() => _clinicianId = id == '' ? null : id)),
            ...((_board!['providers'] as List?) ?? []).map((raw) { final p = deskRecord(raw); return Padding(padding: const EdgeInsets.only(top: 8), child: Text('${p['full_name'] ?? 'Clinician'}: ${p['active_ahp_consultations']} consultation zinazoendelea · ${p['waiting_for_this_clinician']} wanaomsubiri (AHP).', style: Theme.of(context).textTheme.bodySmall)); }),
          ],
          const SizedBox(height: 16),
          CheckboxListTile(contentPadding: EdgeInsets.zero, value: _urgent, onChanged: locked ? null : (v) => setState(() => _urgent = v ?? false), title: const Text('Nahitaji msaada wa haraka / dharura')),
          if (_urgent) ...[const Notice('Omba msaada wa wahudumu wa hospitali sasa; usisubiri namba ya foleni. Hii haitumi ombi la dharura lenyewe.'), TextButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const EmergencyScreen())), child: const Text('Fungua huduma ya Dharura'))],
          CheckboxListTile(contentPadding: EdgeInsets.zero, value: _share, onChanged: locked ? null : (v) => setState(() => _share = v ?? false),
            title: const Text('Naridhia idara hii kuona ombi langu la huduma'), subtitle: const Text('Ruhusa hii si ruhusa ya kufungua historia yako yote ya matibabu.')),
          FilledButton(onPressed: _busy || _urgent || !_share || _departmentId == null ? null : _register,
            child: Text(_pendingRequest == null ? 'Sajili ziara' : 'Jaribu ombi lilelile tena')),
          if (_pendingRequest != null) const Padding(padding: EdgeInsets.only(top: 12), child: Text('Ombi limefungwa kwa retry salama. Angalia Ziara zangu kujua kama lilihifadhiwa. Halikuwekwa offline.')),
        ] else ...[
          const Text('Ziara 50 za karibuni. Chagua ziara ili kuona hali yake ya sasa.'),
          TextButton.icon(onPressed: _busy ? null : () => _refresh(), icon: const Icon(Icons.refresh), label: const Text('Sasisha ziara')),
          if (!_busy && _error == null && _visits.isEmpty && _selected == null) const Empty('Bado hakuna ziara iliyohifadhiwa.'),
          for (final visit in _visits) ListTile(contentPadding: EdgeInsets.zero, title: Text('${visit.ticket} · ${deskRecord(visit.data['facility'])['name']}'), subtitle: Text(frontDeskStatusLabel(visit.status)),
            trailing: const Icon(Icons.chevron_right), onTap: _busy ? null : () async { await _refresh(visitId: visit.id); _startPolling(); }),
          if (_selected != null) _visitCard(_selected!),
          const SizedBox(height: 12), const Text('Tunafanya refresh yenye kikomo ukiwa kwenye ukurasa huu. Unaweza kusasisha mwenyewe wakati wowote. Hii si makadirio ya muda wa hospitali.'),
        ],
      ])));
  }
  Widget _visitCard(FrontDeskVisit visit) {
    final clearance = deskRecord(visit.data['clearance']);
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(visit.ticket, style: Theme.of(context).textTheme.titleLarge), Text(frontDeskStatusLabel(visit.status)),
      const SizedBox(height: 12), Text('${deskRecord(visit.data['facility'])['name']} · ${deskRecord(visit.data['department'])['name']}'),
      Text('Malipo: ${frontDeskCheckLabel(clearance['payment'] as String)}'),
      Text('Bima: ${frontDeskCheckLabel(clearance['insurance'] as String)}'),
      Text('Ukaguzi wa kliniki: ${frontDeskCheckLabel(clearance['clinical_review'] as String)}'),
      if (visit.data['queue_position'] != null) Text('Nafasi ya utawala kwenye foleni yako: ${visit.data['queue_position']}. Triage ya kliniki inaweza kubadili utaratibu.'),
      if (clearance['clinical_review'] == 'escalated') const Notice('Omba msaada wa clinician sasa. Hujapangiwa foleni ya kawaida.'),
      const SizedBox(height: 12),
      if (visit.status == 'preregistered') FilledButton(onPressed: _busy ? null : () => _action(visit, 'check-in'), child: const Text('Nimefika kituoni')),
      if (visit.status == 'called') const Notice('Daktari amekuita. Fuata maelekezo ya idara; hili halimaanishi consultation imeanza.'),
      if (visit.consultationId != null) FilledButton(onPressed: _busy ? null : () => _openConsultation(visit), child: const Text('Fungua consultation / mazungumzo')),
      if (visit.canCancel) TextButton(onPressed: _busy ? null : () => _action(visit, 'cancel'), child: const Text('Ghairi ziara')),
    ])));
  }
}
