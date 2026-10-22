import 'dart:async';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/phone.dart';
import '../core/patient_care.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
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
  String? _pendingOpId;

  @override
  void initState() {
    super.initState();
    _init();
    _poll = Timer.periodic(const Duration(seconds: 8), (_) => _load());
  }

  Future<void> _init() async {
    final user = await Session.user();
    _meId = user?['id'] as String?;
    try {
      final thread = await _care.careThread(widget.careThreadId);
      if (mounted) setState(() => _canSend = thread['status'] != 'closed');
    } catch (_) {
      if (mounted)
        setState(
          () => _error =
              'Mazungumzo hayakuweza kuthibitishwa. Unaweza kusoma ujumbe uliopo.',
        );
    }
    await _load();
  }

  Future<void> _load() async {
    try {
      final messages = await _care.threadMessages(widget.careThreadId);
      if (!mounted) return;
      setState(() {
        _messages = messages;
        _error = null;
      });
      _scrollToEnd();
    } catch (_) {
      if (mounted) setState(() => _error = S.errorOffline);
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
    final body = _draft.text.trim();
    if (body.isEmpty || !_canSend) return;
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
    _poll?.cancel();
    _draft.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Notice(_error!),
              ),
            Expanded(
              child: _messages.isEmpty
                  ? const Empty('Bado hamjaanza kuzungumza.')
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
                      readOnly: _sending || !_canSend,
                      decoration: InputDecoration(
                        hintText: _canSend
                            ? 'Andika ujumbe...'
                            : 'Mazungumzo haya yamefungwa au hayajapakiwa.',
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed:
                        _sending || !_canSend || _draft.text.trim().isEmpty
                            ? null
                            : _send,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(80, 52),
                    ),
                    child: const Text(S.send),
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
