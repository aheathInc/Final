import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/db.dart';
import '../core/phone.dart';
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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final online = await Api.online;
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
        await Db.replaceMedicationSchedule(rows);
      } catch (_) {
        // Whatever is cached still shows.
      }
    }
    final rows = await Db.medicationSchedule();
    if (!mounted) return;
    setState(() { _rows = rows; _online = online; _loading = false; });
  }

  Future<void> _report(String id, String status) async {
    // Written locally first, so the answer is visible immediately whether or
    // not there is signal.
    await Db.markReported(id, status);
    setState(() {
      _rows = _rows.map((r) => r['id'] == id
          ? {...r, 'reported_status': status, 'synced': 0} : r).toList();
    });

    try {
      await Api.postDurable(
        opId: newOpId(),
        path: '/adherence-logs/$id/confirm',
        syncPath: '/adherence-logs/{adherence_log_id}/confirm',
        pathParams: {'adherence_log_id': id},
        body: {'reported_status': status, 'channel': 'app'},
      );
      await Db.markSynced(id);
      if (mounted) {
        setState(() {
          _rows = _rows.map((r) => r['id'] == id ? {...r, 'synced': 1} : r).toList();
        });
      }
    } on Queued {
      // Stays marked unsynced; the outbox will send it.
    } catch (_) {
      // Same: the local answer stands and will be retried.
    }
  }

  @override
  Widget build(BuildContext context) {
    final due = _rows.where((r) => r['reported_status'] == 'unreported').toList();
    final done = _rows.where((r) => r['reported_status'] != 'unreported').toList();

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
                    const Notice(S.offlineBanner, tone: NoticeTone.attention),
                    const SizedBox(height: 16),
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
            Text('${r['medication_name']} ${r['dosage']}',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500)),
            if (at != null)
              Text(DateFormat('d MMM, HH:mm').format(at.toLocal()),
                  style: const TextStyle(color: AppColors.inkSoft)),
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
    final synced = r['synced'] == 1;
    final taken = r['reported_status'] == 'taken';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(taken ? Icons.check : Icons.close,
              size: 18, color: taken ? AppColors.petrol : AppColors.inkSoft),
          const SizedBox(width: 10),
          Expanded(
            child: Text('${r['medication_name']} ${r['dosage']}',
                style: const TextStyle(fontSize: 15)),
          ),
          if (!synced)
            const Text(S.pendingSuffix,
                style: TextStyle(fontSize: 12, color: AppColors.amber)),
        ],
      ),
    );
  }
}
