import '../core/l10n.dart';
import 'patient_community_screen.dart' show emergency;
import 'dart:async';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/phone.dart';
import '../core/patient_care.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../core/thread_realtime.dart';
import '../widgets/common.dart';

class ThreadScreen extends StatefulWidget {
  const ThreadScreen({
    super.key,
    required this.careThreadId,
    required this.title,
  });
  final String careThreadId;
  final String title;

  @override
  State<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends State<ThreadScreen> {
  final _draft = TextEditingController();
  final _scroll = ScrollController();
  final _care = PatientCareRepository();
  List<Map<String, dynamic>> _messages = [];
  String? _meId;
  Timer? _poll;
  String? _error;
  bool _sending = false;
  bool _canSend = false;
  bool _chatConsent = false;
  String? _pendingOpId;
  ThreadRealtime? _realtime;
  bool _live = false;
  late final int _identity;

  @override
  void initState() {
    super.initState();
    _identity = Session.identityChanges.value;
    Session.identityChanges.addListener(_identityChanged);
    _init();
    _realtime = ThreadRealtime(widget.careThreadId, () {
      if (mounted) _load();
    }, (live) {
      if (mounted) setState(() => _live = live);
    })
      ..start();
    _poll = Timer.periodic(const Duration(seconds: 8), (_) => _load());
  }

  void _identityChanged() {
    if (!mounted) return;
    setState(() {
      _messages = [];
      _draft.clear();
      _canSend = false;
      _chatConsent = false;
      _error = L.tr('Account imebadilika. Fungua tena mazungumzo yako.');
    });
  }

  Future<void> _init() async {
    final user = await Session.user();
    _meId = user?['id'] as String?;
    try {
      final thread = await _care.careThread(widget.careThreadId);
      final consent = await Api.get(
          '/care-threads/${widget.careThreadId}/communication-consent');
      if (mounted && _identity == Session.identityChanges.value) {
        setState(() {
          _chatConsent = consent['accepted'] == true;
          _canSend = thread['status'] != 'closed';
        });
      }
    } catch (_) {
      if (mounted && _identity == Session.identityChanges.value) {
        setState(
          () => _error = L.tr(
              'Mazungumzo hayakuweza kuthibitishwa. Unaweza kusoma ujumbe uliopo.'),
        );
      }
    }
    await _load();
  }

  Future<void> _load() async {
    if (_identity != Session.identityChanges.value) return;
    try {
      final messages = await _care.threadMessages(widget.careThreadId);
      if (!mounted || _identity != Session.identityChanges.value) return;
      setState(() {
        _messages = messages;
        _error = null;
      });
      _scrollToEnd();
      final owner = await Session.userId();
      final lifecycle = WidgetsBinding.instance.lifecycleState;
      if (mounted &&
          _identity == Session.identityChanges.value &&
          !Session.locked.value &&
          ModalRoute.of(context)?.isCurrent == true &&
          _meId != null &&
          owner == _meId &&
          (lifecycle == null || lifecycle == AppLifecycleState.resumed)) {
        final incoming = messages
            .where((m) => m['sender_user_id'] != _meId && m['read_at'] == null)
            .toList();
        if (incoming.isNotEmpty) {
          try {
            await Api.post('/care-threads/${widget.careThreadId}/messages/read',
                {'up_to_message_id': incoming.last['id']});
          } catch (_) {/* A failed acknowledgement must remain unread. */}
        }
      }
    } catch (_) {
      if (mounted && _identity == Session.identityChanges.value) {
        setState(() => _error = S.errorOffline);
      }
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  Future<void> _send() async {
    if (_identity != Session.identityChanges.value) return;
    final body = _draft.text.trim();
    if (body.isEmpty || !_canSend || !_chatConsent) return;
    final opId = _pendingOpId ??= newOpId();
    setState(() => _sending = true);

    try {
      await _care.sendMessage(
        opId: opId,
        careThreadId: widget.careThreadId,
        body: body,
        clientCreatedAt: DateTime.now().toUtc().toIso8601String(),
      );
      _pendingOpId = null;
      _draft.clear();
      await _load();
    } on ApiException catch (e) {
      setState(() {
        _draft.text = body;
        _error = e.message;
      });
    } catch (_) {
      // Put the text back rather than losing it.
      setState(() {
        _draft.text = body;
        _error = S.errorGeneric;
      });
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    Session.identityChanges.removeListener(_identityChanged);
    _poll?.cancel();
    _realtime?.close();
    _draft.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(L.tr(widget.title),
            maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Wrap(spacing: 8, children: [
                  TextButton(
                      onPressed: _sending
                          ? null
                          : () async {
                              final accepted = await showDialog<bool>(
                                  context: context,
                                  builder: (c) => AlertDialog(
                                          title: Text(_chatConsent
                                              ? L.tr('Simamisha chat?')
                                              : L.tr('Ruhusu care chat?')),
                                          content: Text(L.tr(
                                              'Ujumbe utahifadhiwa kwenye rekodi ya huduma na kuonekana kwa timu ya matibabu inayohusika na kesi hii. Hii si huduma ya dharura. Unaweza kusimamisha ujumbe mpya wakati wowote; rekodi zilizopo zitabaki.')),
                                          actions: [
                                            TextButton(
                                                onPressed: () =>
                                                    Navigator.pop(c),
                                                child: Text(L.tr('Ghairi'))),
                                            FilledButton(
                                                style: FilledButton.styleFrom(
                                                    minimumSize:
                                                        const Size(0, 52)),
                                                onPressed: () => Navigator.pop(
                                                    c, !_chatConsent),
                                                child: Text(_chatConsent
                                                    ? L.tr('Simamisha')
                                                    : L.tr('Nakubali')))
                                          ]));
                              if (accepted == null) return;
                              try {
                                await Api.post(
                                    '/care-threads/${widget.careThreadId}/communication-consent',
                                    {
                                      'accepted': accepted,
                                      'version': 'care-chat-v1'
                                    });
                                if (mounted) {
                                  setState(() => _chatConsent = accepted);
                                }
                              } catch (e) {
                                if (mounted) {
                                  setState(() => _error = e.toString());
                                }
                              }
                            },
                      child: Text(_chatConsent
                          ? L.tr('Consent ya chat')
                          : L.tr('Ruhusu chat ili kutuma ujumbe'))),
                  TextButton(
                      onPressed: () => emergency(context),
                      child: Text(L.tr('Msaada wa dharura')))
                ])),
            Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                    _live
                        ? L.tr('Live chat imeunganishwa')
                        : L.tr(
                            'Inaunganisha live chat. Ujumbe unasasishwa kiotomatiki.'),
                    style: const TextStyle(color: AppColors.inkSoft))),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Notice(_error!),
              ),
            Expanded(
              child: _messages.isEmpty
                  ? Empty(L.tr('Bado hamjaanza kuzungumza.'))
                  : ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.all(16),
                      itemCount: _messages.length,
                      itemBuilder: (context, i) {
                        final m = _messages[i];
                        final mine = m['sender_user_id'] == _meId;
                        final pending = m['_pending'] == true;
                        return Align(
                          alignment: mine
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: Container(
                            constraints: BoxConstraints(
                              maxWidth: MediaQuery.of(context).size.width * 0.8,
                            ),
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 10,
                            ),
                            color:
                                mine ? AppColors.petrol : AppColors.paperSunk,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  (m['body'] as String?) ?? '',
                                  style: TextStyle(
                                    color: mine ? Colors.white : AppColors.ink,
                                    fontSize: 16,
                                  ),
                                ),
                                if (pending) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    S.pendingSuffix,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: mine
                                          ? const Color(0xCCFFFFFF)
                                          : AppColors.inkSoft,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppColors.line)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _draft,
                      readOnly: _sending || !_canSend || !_chatConsent,
                      decoration: InputDecoration(
                        hintText: _canSend
                            ? L.tr('Andika ujumbe...')
                            : L.tr(
                                'Mazungumzo haya yamefungwa au hayajapakiwa.'),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: _sending ||
                            !_canSend ||
                            !_chatConsent ||
                            _draft.text.trim().isEmpty
                        ? null
                        : _send,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(80, 52),
                    ),
                    child: Text(S.send),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
