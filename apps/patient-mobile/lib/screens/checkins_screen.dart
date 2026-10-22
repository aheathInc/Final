import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/outbox.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// Scheduled check-ins (FR-FU-02). Answers outside the clinician's thresholds
/// are flagged as a deviation by the server — never here. A client that
/// decided what counted as concerning could be tricked into staying quiet.
class CheckInsScreen extends StatefulWidget {
  const CheckInsScreen({super.key});
  @override
  State<CheckInsScreen> createState() => _CheckInsScreenState();
}

class _CheckInsScreenState extends State<CheckInsScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  bool _online = true;
  String? _error;
  Map<String, String> _syncStates = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final ownerId = await Session.userId();
    final syncStates = ownerId == null
        ? <String, String>{}
        : await Outbox.checkInSyncStates(ownerId);
    final online = await Api.online;
    if (!online) {
      if (mounted) {
        setState(() {
          _items = [];
          _syncStates = syncStates;
          _online = false;
          _error = null;
          _loading = false;
        });
      }
      return;
    }
    try {
      final data = await Api.get(
        '/check-ins',
        query: {'limit': 50, 'status': 'due'},
      );
      final items =
          ((data['data'] as List?) ?? []).cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() {
        _items = items
            .map(
              (item) => {
                ...item,
                if (syncStates[item['id']] != null)
                  '_local_sync_status': syncStates[item['id']],
              },
            )
            .toList();
        _syncStates = syncStates;
        _online = true;
        _error = null;
        _loading = false;
      });
    } catch (_) {
      if (mounted)
        setState(() {
          _items = [];
          _syncStates = syncStates;
          _online = false;
          _error = null;
          _loading = false;
        });
    }
  }

  Future<void> _open(Map<String, dynamic> checkIn) async {
    final localStatus = checkIn['_local_sync_status'] as String?;
    if (localStatus == 'queued' || localStatus == 'sending') return;
    if (!_online) {
      setState(
        () => _error =
            'ONLINE REQUIRED: unganisha intaneti kabla ya kujibu swali hili.',
      );
      return;
    }
    final answered = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _CheckInForm(checkIn: checkIn)),
    );
    if (answered == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(S.checkIns)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (!_online) ...[
                  const Notice(
                    'Hakuna mtandao. Maswali ya follow-up hayajahifadhiwa kwa matumizi offline.',
                    tone: NoticeTone.attention,
                  ),
                  if (_syncStates.values.any(
                    (status) => status == 'queued' || status == 'sending',
                  ))
                    const Notice(
                      'Pending sync: jibu la follow-up linasubiri uthibitisho wa seva.',
                      tone: NoticeTone.attention,
                    ),
                  if (_syncStates.values.any((status) => status == 'failed'))
                    const Notice(
                      'Jibu la awali linahitaji kuangaliwa mtandaoni.',
                      tone: NoticeTone.attention,
                    ),
                  const SizedBox(height: 16),
                ],
                if (_error != null) ...[
                  Notice(_error!),
                  const SizedBox(height: 16),
                ],
                if (_items.isEmpty)
                  Empty(
                    _online
                        ? 'Huna swali linalosubiri jibu. Hii ni habari njema.'
                        : 'Hakuna swali la follow-up lililohifadhiwa kwenye kifaa hiki.',
                  )
                else
                  ..._items.map((c) {
                    final at = DateTime.tryParse(
                      c['scheduled_at'] as String? ?? '',
                    );
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Panel(
                        accent: AppColors.amber,
                        onTap: c['_local_sync_status'] == 'queued' ||
                                c['_local_sync_status'] == 'sending'
                            ? null
                            : () => _open(c),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Daktari anataka kujua hali yako',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            if (c['_local_sync_status'] == 'queued' ||
                                c['_local_sync_status'] == 'sending')
                              const Text(
                                'Pending sync — jibu halijathibitishwa na seva.',
                              ),
                            if (c['_local_sync_status'] == 'failed')
                              const Text(
                                'Jibu la awali halikuthibitishwa; unganisha intaneti kabla ya kujibu tena.',
                              ),
                            if (at != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                DateFormat('d MMM, HH:mm').format(at.toLocal()),
                                style: const TextStyle(
                                  color: AppColors.inkSoft,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    );
                  }),
              ],
            ),
    );
  }
}

class _CheckInForm extends StatefulWidget {
  const _CheckInForm({required this.checkIn});
  final Map<String, dynamic> checkIn;

  @override
  State<_CheckInForm> createState() => _CheckInFormState();
}

class _CheckInFormState extends State<_CheckInForm> {
  int _feeling = 3;
  final _note = TextEditingController();
  bool _busy = false;
  String? _message;
  bool _submitted = false;
  bool _queued = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    final id = widget.checkIn['id'] as String;
    try {
      final result = await Api.postDurable(
        opId: newOpId(),
        path: '/check-ins/$id/respond',
        syncPath: '/check-ins/{check_in_id}/respond',
        pathParams: {'check_in_id': id},
        body: {
          'responses': {'feeling': _feeling, 'note': _note.text},
          'channel': 'app',
          'client_created_at': DateTime.now().toIso8601String(),
        },
      );
      if (!mounted) return;
      final status = result is Map ? result['status'] as String? : null;
      setState(() {
        _submitted = true;
        _message = status == null
            ? 'Jibu limehifadhiwa na seva.'
            : 'Jibu limehifadhiwa na seva. Hali: $status';
        _busy = false;
      });
    } on Queued {
      setState(() {
        _queued = true;
        _message =
            'Pending sync: jibu lipo kwenye simu tu na halijathibitishwa na seva.';
        _busy = false;
      });
    } on ApiException catch (e) {
      setState(() {
        _message = e.message;
        _busy = false;
      });
    } catch (_) {
      setState(() {
        _message = S.errorGeneric;
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    const labels = [
      'Vibaya sana',
      'Vibaya',
      'Wastani',
      'Vizuri',
      'Vizuri sana',
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('Hali yako')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_submitted || _queued) ...[
            Notice(
              _message ?? 'Jibu limehifadhiwa na seva.',
              tone: NoticeTone.attention,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(_submitted || _queued),
              child: const Text('Funga'),
            ),
          ] else ...[
            const Text(
              'Unajisikiaje leo?',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 16),
            ...List.generate(5, (i) {
              final value = i + 1;
              final selected = _feeling == value;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: InkWell(
                  onTap: () => setState(() => _feeling = value),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 16,
                    ),
                    decoration: BoxDecoration(
                      color: selected ? AppColors.petrol : Colors.white,
                      border: Border.all(
                        color: selected ? AppColors.petrol : AppColors.line,
                      ),
                    ),
                    child: Text(
                      labels[i],
                      style: TextStyle(
                        fontSize: 17,
                        color: selected ? Colors.white : AppColors.ink,
                      ),
                    ),
                  ),
                ),
              );
            }),
            const SizedBox(height: 20),
            const Text(
              'Kuna kitu kingine unataka daktari ajue?',
              style: TextStyle(fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            TextField(controller: _note, maxLines: 3),
            if (_message != null) ...[
              const SizedBox(height: 16),
              Notice(_message!, tone: NoticeTone.attention),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'Inatuma...' : S.send),
            ),
          ],
        ],
      ),
    );
  }
}
