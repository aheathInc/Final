import '../core/l10n.dart';
import 'dart:math';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/thread_realtime.dart';
import 'emergency_screen.dart';

const platformPath = '/patient-platform';
String messageError(Object e) => e is ApiException
    ? e.message
    : L.tr('Haikuwezekana kuunganisha. Jaribu tena.');
List<Map<String, dynamic>> records(dynamic result) => (result['data'] as List)
    .map((e) => Map<String, dynamic>.from(e as Map))
    .toList();
String requestId() {
  final r = Random.secure();
  final b = List.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  final h = b.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

void emergency(BuildContext context) => Navigator.of(context)
    .push(MaterialPageRoute(builder: (_) => const EmergencyScreen()));
Widget safetyNote(BuildContext context) =>
    Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(L.tr(
          'Usiweke taarifa zinazomtambulisha mgonjwa. Community na peer chat si huduma ya dharura na hazifuatiliwi muda wote.')),
      TextButton.icon(
          onPressed: () => emergency(context),
          icon: const Icon(Icons.emergency_outlined),
          label: Text(L.tr('Nahitaji msaada wa dharura'))),
    ]);
Future<String?> askText(BuildContext context, String title,
    {String hint = 'Andika ujumbe', String action = 'Tuma'}) async {
  final text = TextEditingController();
  final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
              title: Text(L.tr(title)),
              content: TextField(
                  controller: text,
                  autofocus: true,
                  minLines: 3,
                  maxLines: 6,
                  maxLength: 4000,
                  decoration: InputDecoration(labelText: hint)),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: Text(L.tr('Ghairi'))),
                FilledButton(
                    style:
                        FilledButton.styleFrom(minimumSize: const Size(0, 52)),
                    onPressed: () {
                      if (text.text.trim().isNotEmpty) {
                        Navigator.pop(context, text.text.trim());
                      }
                    },
                    child: Text(action))
              ]));
  // The dialog's closing animation still owns the controller for a frame.
  Future.delayed(const Duration(milliseconds: 400), text.dispose);
  return result;
}

Future<void> reportContent(BuildContext context, String id, String kind) async {
  final text = TextEditingController();
  bool urgent = false;
  final shared = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
                title: Text(L.tr('Ripoti kwa msimamizi')),
                content: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(L.tr(
                      'Ujumbe uliochagua na sababu yako vitashirikiwa na wasimamizi. Mazungumzo mengine hayatashirikiwa.')),
                  TextField(
                      controller: text,
                      minLines: 2,
                      maxLines: 4,
                      maxLength: 4000,
                      decoration:
                          InputDecoration(labelText: L.tr('Sababu ya ripoti'))),
                  CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: urgent,
                      onChanged: (v) => setDialogState(() => urgent = v!),
                      title: Text(L.tr('Inahitaji kuchunguzwa kwa haraka'))),
                  Text(L.tr('Kwa hatari ya sasa, usisubiri moderation.')),
                  TextButton(
                      onPressed: () => emergency(context),
                      child: Text(L.tr('Pata msaada wa dharura'))),
                ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: Text(L.tr('Ghairi'))),
                  FilledButton(
                      style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 52)),
                      onPressed: () {
                        if (text.text.trim().isNotEmpty) {
                          Navigator.pop(dialogContext, true);
                        }
                      },
                      child: Text(L.tr('Shiriki na ripoti')))
                ],
              )));
  final reason = text.text.trim();
  Future.delayed(const Duration(milliseconds: 400), text.dispose);
  if (shared == true) {
    await Api.post('$platformPath/reports/$id', {
      'kind': kind,
      'reason': reason,
      'urgent': urgent,
      'share_with_moderators': true
    });
  }
}

class PatientCommunityScreen extends StatefulWidget {
  const PatientCommunityScreen({super.key});
  @override
  State<PatientCommunityScreen> createState() => _PatientCommunityScreenState();
}

class _PatientCommunityScreenState extends State<PatientCommunityScreen> {
  Map<String, dynamic>? _profile;
  String? _version, _error;
  bool _loading = true,
      _busy = false,
      _consent = false,
      _peer = false,
      _settings = false;
  List<Map<String, dynamic>> _spaces = [];
  final _alias = TextEditingController();
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _alias.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final result = await Api.get('$platformPath/profile');
      final p = result['profile'] as Map<String, dynamic>?;
      final spaces = p?['consentVersion'] == result['consent_version'] &&
              p?['suspended'] != true
          ? records(await Api.get('$platformPath/spaces'))
          : <Map<String, dynamic>>[];
      if (!mounted) return;
      setState(() {
        _profile = p;
        _version = result['consent_version'];
        _alias.text = p?['alias'] ?? '';
        _consent = p?['consentVersion'] == _version;
        _peer = p?['peerEnabled'] == true;
        _spaces = spaces;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = messageError(e);
          _loading = false;
        });
      }
    }
  }

  Future<void> _run(Future<void> Function() work) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await work();
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = messageError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final setup = _settings ||
        _profile?['consentVersion'] != _version ||
        _profile == null;
    return Scaffold(
        appBar: AppBar(title: Text(L.tr('Community ya afya')), actions: [
          IconButton(
              onPressed:
                  _busy ? null : () => setState(() => _settings = !_settings),
              icon: const Icon(Icons.privacy_tip_outlined),
              tooltip: L.tr('Consent na faragha'))
        ]),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(padding: const EdgeInsets.all(20), children: [
                  safetyNote(context),
                  if (_error != null) ...[
                    Text(L.tr(_error!),
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error)),
                    TextButton(
                        onPressed: _load, child: Text(L.tr('Jaribu tena')))
                  ],
                  if (_profile?['suspended'] == true)
                    Text(L.tr(
                        'Akaunti hii imesimamishwa kwenye community. Tumia maoni na malalamiko kuwasiliana na support.'))
                  else if (setup) ...[
                    Text(L.tr('Chagua unavyoshiriki'),
                        style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 12),
                    Text(L.tr(
                        'Tumia jina la utani. Members wataona posts zilizoidhinishwa. Wasimamizi watakagua posts na reports. Usitume rekodi binafsi au taarifa za mtu mwingine. Ukiondoa consent, utatoka kwenye communities na peer chats zitafungwa; posts zilizochapishwa na reports zitabaki kwa moderation.')),
                    const SizedBox(height: 16),
                    TextField(
                        controller: _alias,
                        maxLength: 60,
                        decoration:
                            InputDecoration(labelText: L.tr('Jina la utani'))),
                    CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: _consent,
                        onChanged:
                            _busy ? null : (v) => setState(() => _consent = v!),
                        title: Text(L.tr(
                            'Nimeelewa na ninakubali kushiriki kwenye community'))),
                    SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        value: _peer,
                        onChanged:
                            _busy ? null : (v) => setState(() => _peer = v),
                        title: Text(L.tr('Ruhusu peer chat')),
                        subtitle: Text(L.tr(
                            'Miaka 18+, tarehe ya kuzaliwa kwenye profile, community moja na invitation inayokubaliwa na wote.'))),
                    FilledButton(
                        style: FilledButton.styleFrom(
                            minimumSize: const Size(0, 52)),
                        onPressed: _busy
                            ? null
                            : () => _run(() async {
                                  await Api.post('$platformPath/consent', {
                                    'alias': _alias.text.trim(),
                                    'consent': _consent,
                                    'consent_version': _version,
                                    'peer_enabled': _peer
                                  });
                                  if (mounted) {
                                    setState(() => _settings = false);
                                  }
                                }),
                        child: Text(
                            _busy ? 'Inahifadhi...' : L.tr('Hifadhi chaguo'))),
                  ] else ...[
                    ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.forum_outlined),
                        title: Text(L.tr('Peer chats na invitations')),
                        subtitle:
                            Text(L.tr('Mazungumzo ya hiari kati ya patients')),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) => const PeerChatsScreen()))),
                    const Divider(),
                    Text(L.tr('Health communities'),
                        style: Theme.of(context).textTheme.titleLarge),
                    if (_spaces.isEmpty)
                      Padding(
                          padding: EdgeInsets.symmetric(vertical: 24),
                          child: Text(L.tr(
                              'Hakuna community iliyofunguliwa kwa sasa.'))),
                    for (final s in _spaces)
                      Padding(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(s['name'],
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleMedium),
                                Text(s['description']),
                                Wrap(spacing: 12, children: [
                                  if (s['joined'] == true)
                                    FilledButton.tonal(
                                        style: FilledButton.styleFrom(
                                            minimumSize: const Size(0, 52)),
                                        onPressed: () => Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                                builder: (_) =>
                                                    HealthSpaceScreen(
                                                        space: s))),
                                        child: Text(L.tr('Fungua community'))),
                                  TextButton(
                                      onPressed: _busy
                                          ? null
                                          : () => _run(() async {
                                                await Api.post(
                                                    '$platformPath/spaces/${s['id']}/membership',
                                                    {
                                                      'join':
                                                          s['joined'] != true
                                                    });
                                              }),
                                      child: Text(s['joined'] == true
                                          ? L.tr('Ondoka')
                                          : L.tr('Jiunge')))
                                ])
                              ])),
                  ],
                ])));
  }
}

class HealthSpaceScreen extends StatefulWidget {
  const HealthSpaceScreen({required this.space, super.key});
  final Map<String, dynamic> space;
  @override
  State<HealthSpaceScreen> createState() => _HealthSpaceScreenState();
}

class _HealthSpaceScreenState extends State<HealthSpaceScreen> {
  List<Map<String, dynamic>> _posts = [];
  String? _error, _cursor;
  bool _loading = true, _busy = false;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool more = false}) async {
    try {
      final r = await Api.get(
          '$platformPath/spaces/${widget.space['id']}/posts',
          query: {if (more && _cursor != null) 'cursor': _cursor});
      if (mounted) {
        setState(() {
          _posts = more ? [..._posts, ...records(r)] : records(r);
          _cursor = r['next_cursor'];
          _error = null;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = messageError(e);
          _loading = false;
          _posts = [];
        });
      }
    }
  }

  Future<void> _run(Future<void> Function() work) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await work();
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = messageError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _post([String? parent]) async {
    final body = await askText(context,
        parent == null ? L.tr('Mjadala mpya') : L.tr('Jibu la mjadala'),
        hint: L.tr('Post itasubiri moderation.'));
    if (body != null) {
      await _run(() async {
        await Api.post('$platformPath/spaces/${widget.space['id']}/posts',
            {'body': body, if (parent != null) 'parent_id': parent});
      });
    }
  }

  Widget _row(Map<String, dynamic> p) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(
            '${p['author_alias']} ${p['author_role'] == 'clinician' ? L.tr('· Daktari aliyethibitishwa') : ''}',
            style: Theme.of(context).textTheme.titleSmall),
        if (p['parentId'] != null)
          Text(L.tr('Jibu la mjadala'),
              style: TextStyle(fontStyle: FontStyle.italic)),
        SelectableText(p['body']),
        Text(p['status'] == 'approved'
            ? L.tr('Imeidhinishwa')
            : p['status'] == 'pending'
                ? L.tr('Inasubiri moderation')
                : L.tr("Haijaonyeshwa: {0}", [p['reason'] ?? p['status']])),
        if (p['status'] == 'approved')
          Wrap(spacing: 8, children: [
            TextButton(
                onPressed: _busy ? null : () => _post(p['parentId'] ?? p['id']),
                child: Text(L.tr('Jibu'))),
            if (p['mine'] != true &&
                p['peer_available'] == true &&
                p['author_role'] == 'patient')
              TextButton(
                  onPressed: _busy
                      ? null
                      : () => _run(() async {
                            await Api.post(
                                '$platformPath/posts/${p['id']}/invite', {});
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                                  content: Text(L.tr(
                                      'Invitation imehifadhiwa. Angalia Peer chats.'))));
                            }
                          }),
                  child: Text(L.tr('Omba peer chat'))),
            TextButton(
                onPressed: _busy
                    ? null
                    : () => _run(() => reportContent(context, p['id'], 'post')),
                child: Text(L.tr('Ripoti'))),
          ]),
        const Divider(),
      ]));
  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final roots = _posts.where((p) => p['parentId'] == null).toList();
    final rootIds = roots.map((p) => p['id']).toSet();
    return Scaffold(
        appBar: AppBar(title: Text(widget.space['name'])),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(padding: const EdgeInsets.all(20), children: [
                  safetyNote(context),
                  FilledButton.icon(
                      onPressed: _busy ? null : _post,
                      icon: const Icon(Icons.edit_outlined),
                      label: Text(L.tr('Anzisha mjadala'))),
                  if (_error != null)
                    Text(L.tr(_error!),
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error)),
                  if (_posts.isEmpty)
                    Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Text(L.tr(
                            'Hakuna posts bado. Anzisha mjadala unaoheshimu faragha.'))),
                  for (final root in roots) ...[
                    _row(root),
                    for (final reply in _posts
                        .where((p) => p['parentId'] == root['id'])
                        .toList()
                        .reversed)
                      Padding(
                          padding: const EdgeInsets.only(left: 16),
                          child: _row(reply))
                  ],
                  for (final reply in _posts.where((p) =>
                      p['parentId'] != null &&
                      !rootIds.contains(p['parentId'])))
                    _row(reply),
                  if (_cursor != null)
                    TextButton(
                        onPressed: () => _load(more: true),
                        child: Text(L.tr('Onyesha zaidi'))),
                ])));
  }
}

class PeerChatsScreen extends StatefulWidget {
  const PeerChatsScreen({super.key});
  @override
  State<PeerChatsScreen> createState() => _PeerChatsScreenState();
}

class _PeerChatsScreenState extends State<PeerChatsScreen> {
  List<Map<String, dynamic>> _chats = [];
  String? _error;
  bool _loading = true, _busy = false;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = records(await Api.get('$platformPath/peers'));
      if (mounted) {
        setState(() {
          _chats = r;
          _error = null;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _chats = [];
          _error = messageError(e);
          _loading = false;
        });
      }
    }
  }

  Future<void> _decision(String id, bool accept) async {
    setState(() => _busy = true);
    try {
      await Api.post('$platformPath/peers/$id/decision', {'accept': accept});
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = messageError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(L.tr('Peer chats'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(20), children: [
                safetyNote(context),
                if (_error != null) ...[
                  Text(L.tr(_error!)),
                  TextButton(onPressed: _load, child: Text(L.tr('Jaribu tena')))
                ],
                if (_chats.isEmpty && _error == null)
                  Text(L.tr(
                      'Omba peer chat kutoka kwenye post ya member. Hakuna majina ya patients yanayotafutwa hadharani.')),
                for (final c in _chats)
                  Column(children: [
                    ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(c['alias']),
                        subtitle: Text(c['status']),
                        trailing: c['status'] == 'accepted'
                            ? const Icon(Icons.chevron_right)
                            : null,
                        onTap: c['status'] == 'accepted'
                            ? () async {
                                await Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                        builder: (_) =>
                                            PeerConversationScreen(chat: c)));
                                await _load();
                              }
                            : null),
                    if (c['incoming'] == true && c['status'] == 'pending')
                      Wrap(spacing: 12, children: [
                        FilledButton(
                            style: FilledButton.styleFrom(
                                minimumSize: const Size(0, 52)),
                            onPressed:
                                _busy ? null : () => _decision(c['id'], true),
                            child: Text(L.tr('Kubali chat'))),
                        TextButton(
                            onPressed:
                                _busy ? null : () => _decision(c['id'], false),
                            child: Text(L.tr('Kataa'))),
                      ]),
                    const Divider(),
                  ]),
              ]),
            ),
    );
  }
}

class PeerConversationScreen extends StatefulWidget {
  const PeerConversationScreen({required this.chat, super.key});
  final Map<String, dynamic> chat;
  @override
  State<PeerConversationScreen> createState() => _PeerConversationScreenState();
}

class _PeerConversationScreenState extends State<PeerConversationScreen>
    with WidgetsBindingObserver {
  List<Map<String, dynamic>> _messages = [];
  String? _error, _cursor, _pendingKey;
  bool _busy = false, _connected = false;
  final _text = TextEditingController();
  ThreadRealtime? _realtime;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _realtime = ThreadRealtime(widget.chat['id'], _load, (v) {
      if (mounted) setState(() => _connected = v);
    });
    _realtime!.start();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _realtime?.close();
    _text.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
    if (state == AppLifecycleState.paused) setState(() => _messages = []);
  }

  Future<void> _load({bool more = false}) async {
    try {
      final r = await Api.get(
          '$platformPath/peers/${widget.chat['id']}/messages',
          query: {if (more && _cursor != null) 'cursor': _cursor});
      if (mounted) {
        setState(() {
          _messages = more ? [..._messages, ...records(r)] : records(r);
          _cursor = r['next_cursor'];
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _messages = [];
          _error = messageError(e);
        });
      }
    }
  }

  Future<void> _send() async {
    if (_busy || _text.text.trim().isEmpty) return;
    setState(() => _busy = true);
    _pendingKey ??= requestId();
    try {
      await Api.post('$platformPath/peers/${widget.chat['id']}/messages',
          {'body': _text.text.trim(), 'request_key': _pendingKey});
      _text.clear();
      _pendingKey = null;
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = messageError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _block() async {
    final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
                title: Text(L.tr('Zuia mawasiliano?')),
                content: Text(L.tr(
                    'Chat hii itafungwa na member hataweza kukutumia invitation nyingine.')),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c, false),
                      child: Text(L.tr('Ghairi'))),
                  FilledButton(
                      style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 52)),
                      onPressed: () => Navigator.pop(c, true),
                      child: Text(L.tr('Zuia')))
                ]));
    if (ok != true) return;
    try {
      await Api.post('$platformPath/peers/${widget.chat['id']}/block', {});
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => _error = messageError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
        appBar: AppBar(title: Text(widget.chat['alias']), actions: [
          IconButton(
              onPressed: _block,
              icon: const Icon(Icons.block),
              tooltip: L.tr('Zuia mawasiliano'))
        ]),
        body: SafeArea(
            child: Column(children: [
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(children: [
                Expanded(
                    child: Text(_connected
                        ? L.tr('Imeunganishwa moja kwa moja')
                        : L.tr('Inaunganisha; unaweza kujaribu refresh'))),
                IconButton(
                    onPressed: _load,
                    icon: const Icon(Icons.refresh),
                    tooltip: L.tr('Sasisha')),
                IconButton(
                    onPressed: () => emergency(context),
                    icon: const Icon(Icons.emergency_outlined),
                    tooltip: L.tr('Msaada wa dharura'))
              ])),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.all(12),
                child: Text(L.tr(_error!),
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error))),
          Expanded(
              child: ListView(
                  reverse: true,
                  padding: const EdgeInsets.all(16),
                  children: [
                for (final m in _messages)
                  Align(
                      alignment: m['mine'] == true
                          ? Alignment.centerRight
                          : Alignment.centerLeft,
                      child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 520),
                          child: Card(
                              color: m['mine'] == true
                                  ? Theme.of(context)
                                      .colorScheme
                                      .secondaryContainer
                                  : null,
                              child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        SelectableText(m['body']),
                                        Text(
                                            (m['created_at'] as String)
                                                .replaceFirst('T', ' ')
                                                .substring(0, 16),
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodySmall),
                                        TextButton(
                                            onPressed: () async {
                                              try {
                                                await reportContent(context,
                                                    m['id'], 'message');
                                              } catch (e) {
                                                if (mounted) {
                                                  setState(() =>
                                                      _error = messageError(e));
                                                }
                                              }
                                            },
                                            child: Text(L.tr('Ripoti ujumbe')))
                                      ]))))),
                if (_cursor != null)
                  TextButton(
                      onPressed: () => _load(more: true),
                      child: Text(L.tr('Ujumbe wa awali')))
              ])),
          Padding(
              padding: const EdgeInsets.all(12),
              child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Expanded(
                    child: TextField(
                        controller: _text,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 4000,
                        onChanged: (_) => _pendingKey = null,
                        decoration: InputDecoration(
                            labelText: L.tr('Ujumbe binafsi')))),
                IconButton(
                    onPressed: _busy ? null : _send,
                    icon: const Icon(Icons.send),
                    tooltip: L.tr('Tuma ujumbe'))
              ]))
        ])));
  }
}
