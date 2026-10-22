import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/db.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// The medication schedule, readable with no signal.
///
/// This is one of the three things the design says must survive losing the
/// network, and the reason is simple: a reminder that only works online is not
/// a reminder for the people this is built for.
class MedicationsScreen extends StatefulWidget {
  const MedicationsScreen({super.key});
  @override
  State<MedicationsScreen> createState() => _MedicationsScreenState();
}

class _MedicationsScreenState extends State<MedicationsScreen> {
  List<Map<String, Object?>> _rows = [];
  bool _loading = true;
  bool _online = true;
  String? _ownerId;
  DateTime? _lastSyncedAt;
  String? _message;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final ownerId = await Session.userId();
    var online = await Api.online;
    if (ownerId == null) {
      if (mounted)
        setState(() {
          _loading = false;
          _online = online;
        });
      return;
    }
    if (online) {
      try {
        final data = await Api.get('/adherence-logs', query: {'limit': 100});
        final rows = ((data['data'] as List?) ?? []).map((raw) {
          final l = raw as Map<String, dynamic>;
          return <String, Object?>{
            'id': l['id'] as String,
            'medication_name': l['medication_name'] ?? '',
            'dosage': l['dosage'] ?? '',
            'scheduled_at': l['scheduled_at'] ?? '',
            'reported_status': l['reported_status'] ?? 'unreported',
            'synced': 1,
          };
        }).toList();
        await Db.replaceMedicationSchedule(ownerId, rows);
      } catch (_) {
        online = false;
      }
    }
    final rows = await Db.medicationSchedule(ownerId);
    final lastSyncedAt = await Db.cacheSyncedAt('medication_schedule', ownerId);
    if (!mounted) return;
    setState(() {
      _rows = rows;
      _ownerId = ownerId;
      _lastSyncedAt = lastSyncedAt;
      _online = online;
      _loading = false;
    });
  }

  Future<void> _report(String id, String status) async {
    final ownerId = _ownerId;
    if (ownerId == null) return;
    final opId = newOpId();

    try {
      await Api.postDurable(
        opId: opId,
        path: '/adherence-logs/$id/confirm',
        syncPath: '/adherence-logs/{adherence_log_id}/confirm',
        pathParams: {'adherence_log_id': id},
        body: {'reported_status': status, 'channel': 'app'},
      );
      await Db.markReported(ownerId, id, status, syncStatus: 'confirmed');
      if (mounted) {
        setState(() {
          _rows = _rows
              .map(
                (r) => r['id'] == id
                    ? {
                        ...r,
                        'reported_status': status,
                        'synced': 1,
                        'sync_status': 'confirmed',
                      }
                    : r,
              )
              .toList();
          _message = null;
        });
      }
    } on Queued {
      await Db.markReported(ownerId, id, status, syncStatus: 'queued');
      if (mounted) {
        setState(() {
          _rows = _rows
              .map(
                (r) => r['id'] == id
                    ? {
                        ...r,
                        'reported_status': status,
                        'synced': 0,
                        'sync_status': 'queued',
                      }
                    : r,
              )
              .toList();
          _message = 'Pending sync: jibu bado halijathibitishwa na seva.';
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _message = e.message);
    } catch (_) {
      if (mounted) setState(() => _message = 'Jibu la dawa halijahifadhiwa.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final due =
        _rows.where((r) => r['reported_status'] == 'unreported').toList();
    final done =
        _rows.where((r) => r['reported_status'] != 'unreported').toList();

    return Scaffold(
      appBar: AppBar(title: const Text(S.medications)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (!_online) ...[
                    Notice(
                      _lastSyncedAt == null
                          ? 'Hakuna mtandao. Hakuna ratiba iliyosawazishwa kwenye kifaa hiki.'
                          : 'Cached data: ratiba ya dawa ilisawazishwa ${DateFormat('d MMM y, HH:mm').format(_lastSyncedAt!.toLocal())}.',
                      tone: NoticeTone.attention,
                    ),
                    const SizedBox(height: 16),
                  ],
                  if (_message != null) ...[
                    Notice(_message!, tone: NoticeTone.attention),
                    const SizedBox(height: 12),
                  ],
                  const SectionTitle('Zinazosubiri jibu'),
                  if (due.isEmpty)
                    const Empty('Huna dawa inayosubiri jibu kwa sasa.')
                  else
                    ...due.map(_dueCard),
                  if (done.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    const SectionTitle('Ulizojibu'),
                    ...done.map(_doneRow),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _dueCard(Map<String, Object?> r) {
    final at = DateTime.tryParse(r['scheduled_at'] as String? ?? '');
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Panel(
        accent: AppColors.amber,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${r['medication_name']} ${r['dosage']}',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
            ),
            if (at != null)
              Text(
                DateFormat('d MMM, HH:mm').format(at.toLocal()),
                style: const TextStyle(color: AppColors.inkSoft),
              ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: () => _report(r['id'] as String, 'taken'),
                    child: const Text(S.taken),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _report(r['id'] as String, 'missed'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      shape: const RoundedRectangleBorder(),
                      side: const BorderSide(color: AppColors.line),
                    ),
                    child: const Text(S.missed, style: TextStyle(fontSize: 16)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _doneRow(Map<String, Object?> r) {
    final syncStatus = r['sync_status'] as String? ??
        (r['synced'] == 1 ? 'confirmed' : 'queued');
    final taken = r['reported_status'] == 'taken';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(
            taken ? Icons.check : Icons.close,
            size: 18,
            color: taken ? AppColors.petrol : AppColors.inkSoft,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '${r['medication_name']} ${r['dosage']}',
              style: const TextStyle(fontSize: 15),
            ),
          ),
          if (syncStatus == 'queued')
            const Text(
              'Pending sync — haijathibitishwa',
              style: TextStyle(fontSize: 12, color: AppColors.amber),
            ),
          if (syncStatus == 'failed')
            const Text(
              'Inahitaji kuangaliwa mtandaoni',
              style: TextStyle(fontSize: 12, color: AppColors.clay),
            ),
        ],
      ),
    );
  }
}
