import '../core/l10n.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/messages_repository.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/profile_card.dart';
import 'patient_community_screen.dart';
import 'patient_updates_screen.dart';
import 'thread_screen.dart';
import 'new_consultation_screen.dart';

class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key, this.repository, this.onOpen});
  final MessagesRepository? repository;
  final void Function(Map<String, dynamic>)? onOpen;
  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen>
    with WidgetsBindingObserver {
  final _search = TextEditingController();
  final _defaultRepository = MessagesRepository();
  List<Map<String, dynamic>> _threads = [];
  String? _error, _cursor;
  bool _loading = true, _more = false, _unread = false;
  int _generation = 0;
  Timer? _poll;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Session.identityChanges.addListener(_identityChanged);
    _load();
    _poll = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!Session.locked.value &&
          ModalRoute.of(context)?.isCurrent == true &&
          (WidgetsBinding.instance.lifecycleState == null ||
              WidgetsBinding.instance.lifecycleState ==
                  AppLifecycleState.resumed)) {
        _load(quiet: true);
      }
    });
  }

  void _identityChanged() {
    _generation++;
    setState(() {
      _threads = [];
      _cursor = null;
      _more = false;
      _search.clear();
    });
    _load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !Session.locked.value) {
      _load(quiet: true);
    }
  }

  @override
  void dispose() {
    _generation++;
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    Session.identityChanges.removeListener(_identityChanged);
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool more = false, bool quiet = false}) async {
    if (_more || (quiet && _loading)) return;
    // Keep loaded pagination until an explicit refresh rather than silently
    // dropping older conversations during a background update.
    if (quiet && _threads.length > 25) return;
    final generation = ++_generation, identity = Session.identityChanges.value;
    setState(() {
      if (more) {
        _more = true;
      } else if (!quiet) {
        _loading = true;
      }
    });
    try {
      final owner = await Session.userId();
      if (owner == null) throw StateError('signed out');
      final page = await (widget.repository ?? _defaultRepository)
          .conversations(cursor: more ? _cursor : null);
      if (!mounted ||
          generation != _generation ||
          identity != Session.identityChanges.value) {
        return;
      }
      final rows = (page['data'] as List)
          .map((r) => Map<String, dynamic>.from(r as Map))
          .toList();
      setState(() {
        final unique = <String, Map<String, dynamic>>{
          if (more)
            for (final t in _threads) t['id'] as String: t
        };
        for (final row in rows) {
          unique[row['id'] as String] = row;
        }
        _threads = unique.values.toList();
        _cursor = (page['meta'] as Map?)?['next_cursor'] as String?;
        _error = null;
      });
    } catch (_) {
      if (mounted &&
          generation == _generation &&
          identity == Session.identityChanges.value) {
        setState(() => _error = L.tr(
            'Mazungumzo hayajapatikana. Angalia mtandao kisha ujaribu tena.'));
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() {
          _loading = false;
          _more = false;
        });
      }
    }
  }

  Future<void> _open(Map<String, dynamic> thread) async {
    if (widget.onOpen != null) {
      widget.onOpen!(thread);
      return;
    }
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ThreadScreen(
            careThreadId: thread['id'] as String,
            title: thread['clinician_name'] as String? ??
                L.tr('Timu ya matibabu'))));
    if (mounted) _load(quiet: true);
  }

  void _page(Widget page) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  String _time(dynamic raw) {
    final date = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (date == null) return '';
    final now = DateTime.now();
    return DateUtils.isSameDay(date, now)
        ? DateFormat('HH:mm').format(date)
        : DateFormat('dd/MM/yy').format(date);
  }

  Widget _shortcut(IconData icon, String label, VoidCallback onTap) => Expanded(
      child: ProfileCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
          onTap: onTap,
          child: Column(children: [
            Icon(icon, color: AppPalette.of(context).petrol),
            const SizedBox(height: 8),
            Text(L.tr(label),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.labelLarge)
          ])));
  Widget _conversation(Map<String, dynamic> thread) {
    final p = AppPalette.of(context);
    final last = thread['last_message'] as Map?;
    final unread = (thread['unread_count'] as num?)?.toInt() ?? 0;
    final name =
        thread['clinician_name'] as String? ?? L.tr('Timu ya matibabu');
    final body = last?['body'] as String?;
    final preview = body?.trim().isNotEmpty == true
        ? body!
        : last != null
            ? L.tr('Kiambatisho')
            : L.tr('Hakuna ujumbe bado');
    return Semantics(
        button: true,
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(vertical: 10),
          leading: CircleAvatar(
              radius: 25,
              backgroundColor: p.mintWash,
              child: Icon(Icons.medical_services_outlined, color: p.petrol)),
          title: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
                child: Text(name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 16,
                        fontWeight:
                            unread > 0 ? FontWeight.w700 : FontWeight.w600))),
            const SizedBox(width: 8),
            Text(_time(last?['created_at'] ?? thread['updated_at']),
                style: TextStyle(fontSize: 12, color: p.inkSoft))
          ]),
          subtitle:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if ((thread['reason_summary'] as String? ?? '').isNotEmpty)
              Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Text(thread['reason_summary'] as String,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 13, color: p.petrol))),
            const SizedBox(height: 4),
            Text(preview,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: p.inkSoft, fontSize: 14)),
            if (thread['status'] == 'closed')
              Padding(
                  padding: EdgeInsets.only(top: 4),
                  child: Text(L.tr('Yamefungwa · Kusoma tu'),
                      style: TextStyle(fontSize: 12))),
          ]),
          trailing: unread > 0
              ? Semantics(
                  label: L.tr("Ujumbe {0} haujasomwa", [unread]),
                  child: Badge(
                      backgroundColor: p.petrol,
                      textColor: p.surface,
                      label: Text(unread > 99 ? '99+' : '$unread')))
              : null,
          onTap: () => _open(thread),
        ));
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final query = _search.text.trim().toLowerCase();
    final visible = _threads
        .where((t) =>
            (!_unread || ((t['unread_count'] as num?) ?? 0) > 0) &&
            '${t['clinician_name'] ?? ''} ${t['reason_summary'] ?? ''}'
                .toLowerCase()
                .contains(query))
        .toList();
    return Scaffold(
      appBar: AppBar(title: Text(L.tr('Ujumbe')), actions: [
        IconButton(
            tooltip: L.tr('Taarifa na ripoti'),
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => _page(const PatientUpdatesScreen())),
        IconButton(
            tooltip: L.tr('Onyesha upya'),
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _loading ? null : () => _load()),
      ]),
      body: RefreshIndicator(
          onRefresh: () => _load(),
          child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                Center(
                    child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 720),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              TextField(
                                  controller: _search,
                                  onChanged: (_) => setState(() {}),
                                  textInputAction: TextInputAction.search,
                                  decoration: InputDecoration(
                                      hintText:
                                          L.tr('Tafuta daktari au mazungumzo'),
                                      prefixIcon:
                                          const Icon(Icons.search_rounded),
                                      suffixIcon: query.isEmpty
                                          ? null
                                          : IconButton(
                                              tooltip: L.tr('Futa utafutaji'),
                                              onPressed: () =>
                                                  setState(_search.clear),
                                              icon: const Icon(
                                                  Icons.close_rounded)))),
                              const SizedBox(height: 18),
                              Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    _shortcut(
                                        Icons.groups_outlined,
                                        L.tr('Jamii ya afya'),
                                        () => _page(
                                            const PatientCommunityScreen())),
                                    const SizedBox(width: 12),
                                    _shortcut(
                                        Icons.forum_outlined,
                                        L.tr('Peer chats'),
                                        () => _page(const PeerChatsScreen())),
                                  ]),
                              const SizedBox(height: 24),
                              Text(L.tr('Mazungumzo ya huduma'),
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w700)),
                              const SizedBox(height: 10),
                              Wrap(spacing: 8, children: [
                                ChoiceChip(
                                    label: Text(L.tr('Yote')),
                                    selected: !_unread,
                                    onSelected: (_) =>
                                        setState(() => _unread = false)),
                                ChoiceChip(
                                    label: Text(L.tr('Hayajasomwa')),
                                    selected: _unread,
                                    onSelected: (_) =>
                                        setState(() => _unread = true))
                              ]),
                              const SizedBox(height: 8),
                              if (_error != null) ...[
                                Notice(
                                    '$_error${_threads.isEmpty ? '' : L.tr(' Orodha hii inaweza kuwa ya zamani.')}',
                                    tone: NoticeTone.attention),
                                Align(
                                    alignment: Alignment.centerLeft,
                                    child: TextButton(
                                        onPressed: () => _load(),
                                        child: Text(L.tr('Jaribu tena'))))
                              ],
                              if (_loading && _threads.isEmpty)
                                const Padding(
                                    padding: EdgeInsets.all(36),
                                    child: Center(
                                        child: CircularProgressIndicator()))
                              else if (visible.isEmpty && _error == null)
                                Padding(
                                    padding: const EdgeInsets.symmetric(
                                        vertical: 32),
                                    child: Column(children: [
                                      Icon(Icons.chat_bubble_outline_rounded,
                                          size: 42,
                                          color: AppPalette.of(context).petrol),
                                      const SizedBox(height: 14),
                                      Text(
                                          query.isNotEmpty
                                              ? L.tr(
                                                  'Hakuna matokeo kwenye orodha hii')
                                              : _unread
                                                  ? L.tr(
                                                      'Hakuna ujumbe ambao haujasomwa kwenye orodha hii')
                                                  : L.tr(
                                                      'Mazungumzo yako yataonekana hapa'),
                                          textAlign: TextAlign.center),
                                      if (query.isEmpty && !_unread) ...[
                                        const SizedBox(height: 8),
                                        Text(
                                            L.tr(
                                                'Anza consultation ili kuwasiliana na timu yako ya matibabu.'),
                                            textAlign: TextAlign.center),
                                        const SizedBox(height: 16),
                                        FilledButton.icon(
                                            onPressed: () => _page(
                                                const NewConsultationScreen()),
                                            icon: const Icon(Icons.add_rounded),
                                            label:
                                                Text(L.tr('Anza consultation')))
                                      ],
                                    ]))
                              else
                                ...visible.map((t) => Column(children: [
                                      _conversation(t),
                                      Divider(
                                          height: 1,
                                          color: AppPalette.of(context).line)
                                    ])),
                              if (_cursor != null)
                                Padding(
                                    padding: const EdgeInsets.only(top: 16),
                                    child: OutlinedButton(
                                        onPressed: _more
                                            ? null
                                            : () => _load(more: true),
                                        child: Text(_more
                                            ? 'Inapakia...'
                                            : L.tr('Pakia mazungumzo zaidi')))),
                              const SizedBox(height: 24),
                              Text(
                                  L.tr(
                                      'Ujumbe si huduma ya dharura na haufuatiliwi muda wote.'),
                                  style: TextStyle(
                                      color: AppPalette.of(context).inkSoft,
                                      fontSize: 13)),
                              Align(
                                  alignment: Alignment.centerLeft,
                                  child: TextButton.icon(
                                      onPressed: () => emergency(context),
                                      icon:
                                          const Icon(Icons.emergency_outlined),
                                      label: Text(L.tr('Msaada wa dharura')))),
                            ]))),
              ])),
    );
  }
}
