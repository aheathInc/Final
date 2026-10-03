import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/db.dart';
import '../core/patient_care.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class PatientCareMedicinesScreen extends StatefulWidget {
  const PatientCareMedicinesScreen({super.key});
  @override
  State<PatientCareMedicinesScreen> createState() =>
      _PatientCareMedicinesScreenState();
}

class _PatientCareMedicinesScreenState
    extends State<PatientCareMedicinesScreen> {
  final _care = PatientCareRepository();
  final _search = TextEditingController();
  final _latitudeInput = TextEditingController();
  final _longitudeInput = TextEditingController();
  List<Map<String, dynamic>> _prescriptions = [], _availability = [];
  List<Map<String, Object?>> _logs = [];
  String? _error, _availabilityError;
  String? _ownerId;
  DateTime? _lastSyncedAt;
  double? _latitude, _longitude;
  bool _loading = true,
      _searching = false,
      _availabilitySearched = false,
      _offline = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    _latitudeInput.dispose();
    _longitudeInput.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final ownerId = await Session.userId();
    if (ownerId == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _offline = true;
          _error = 'Ingia tena ili kufungua taarifa zako zilizohifadhiwa.';
        });
      }
      return;
    }
    final online = await Api.online;
    if (!online) {
      final cached = await Db.medicationSchedule(ownerId);
      final lastSyncedAt = await Db.cacheSyncedAt(
        'medication_schedule',
        ownerId,
      );
      if (mounted) {
        setState(() {
          _ownerId = ownerId;
          _logs = cached;
          _lastSyncedAt = lastSyncedAt;
          _offline = true;
          _loading = false;
          _error = null;
        });
      }
      return;
    }
    try {
      final profile = await Api.get('/patient-profiles/me');
      final id = profile['id'] as String;
      final location = profile['default_location'];
      final values = await Future.wait([
        _care.prescriptions(id),
        _care.adherenceLogs(id),
      ]);
      final rows = values[1].map(adherenceCacheRow).toList();
      await Db.replaceMedicationSchedule(ownerId, rows);
      final cached = await Db.medicationSchedule(ownerId);
      final serverIds = rows.map((r) => r['id']).toSet();
      final pending = cached.where(
        (r) => r['synced'] == 0 && !serverIds.contains(r['id']),
      );
      final byId = <Object?, Map<String, Object?>>{
        for (final row in rows) row['id']: row,
        for (final row in pending) row['id']: row,
      };
      if (mounted)
        setState(() {
          _latitude =
              location is Map ? (location['lat'] as num?)?.toDouble() : null;
          _longitude =
              location is Map ? (location['lng'] as num?)?.toDouble() : null;
          if (_latitude != null && _latitudeInput.text.isEmpty) {
            _latitudeInput.text = _latitude.toString();
          }
          if (_longitude != null && _longitudeInput.text.isEmpty) {
            _longitudeInput.text = _longitude.toString();
          }
          _prescriptions = values[0];
          _logs = byId.values.toList();
          _ownerId = ownerId;
          _lastSyncedAt = DateTime.now().toUtc();
          _offline = false;
          _loading = false;
          _error = null;
        });
    } catch (_) {
      final cached = await Db.medicationSchedule(ownerId);
      final lastSyncedAt = await Db.cacheSyncedAt(
        'medication_schedule',
        ownerId,
      );
      if (mounted)
        setState(() {
          _logs = cached;
          _ownerId = ownerId;
          _lastSyncedAt = lastSyncedAt;
          _offline = true;
          _loading = false;
          _error = 'Internet haipatikani. Unaona ratiba iliyohifadhiwa tu.';
        });
    }
  }

  Future<void> _report(Map<String, Object?> log, String status) async {
    final id = log['id'] as String;
    final ownerId = _ownerId;
    if (ownerId == null) return;
    final opId = newOpId();
    try {
      final updated = await _care.confirmDose(
        opId: opId,
        adherenceLogId: id,
        reportedStatus: status,
      );
      final savedStatus = updated['reported_status'] as String? ?? status;
      await Db.markReported(ownerId, id, savedStatus, syncStatus: 'confirmed');
      if (mounted)
        setState(
          () => _logs = _logs
              .map(
                (r) => r['id'] == id
                    ? {
                        ...r,
                        'reported_status': savedStatus,
                        'synced': 1,
                        'sync_status': 'confirmed',
                      }
                    : r,
              )
              .toList(),
        );
    } on Queued {
      await Db.markReported(ownerId, id, status, syncStatus: 'queued');
      if (mounted)
        setState(
          () => _logs = _logs
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
              .toList(),
        );
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Jibu la dozi halikuhifadhiwa.');
    }
  }

  Future<void> _find() async {
    final name = _search.text.trim();
    if (name.isEmpty) return;
    final latitude = double.tryParse(_latitudeInput.text.trim());
    final longitude = double.tryParse(_longitudeInput.text.trim());
    if (latitude == null ||
        longitude == null ||
        latitude.abs() > 90 ||
        longitude.abs() > 180) {
      setState(
        () => _error =
            'Weka latitudo (-90 hadi 90) na longitudo (-180 hadi 180) ili kutafuta eneo hilo.',
      );
      return;
    }
    setState(() {
      _searching = true;
      _availability = [];
      _availabilityError = null;
      _availabilitySearched = false;
    });
    if (!await Api.online) {
      if (mounted) {
        setState(() {
          _searching = false;
          _availabilityError =
              'INTERNET REQUIRED. Upatikanaji wa dawa hauwezi kukaguliwa ukiwa offline.';
        });
      }
      return;
    }
    try {
      final rows = await _care.medicationAvailability(
        name: name,
        latitude: latitude,
        longitude: longitude,
      );
      if (mounted)
        setState(() {
          _availability = rows;
          _searching = false;
          _availabilitySearched = true;
        });
    } catch (e) {
      if (mounted)
        setState(() {
          _availabilityError =
              e is ApiException ? e.message : 'Utafutaji haujafaulu.';
          _searching = false;
        });
    }
  }

  String _date(Object? raw) {
    final d = DateTime.tryParse(raw as String? ?? '');
    return d == null ? '' : DateFormat('d MMM, HH:mm').format(d.toLocal());
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Dawa na maduka ya dawa')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_offline)
                      Notice(
                        _lastSyncedAt == null
                            ? 'Cached data haipo. Ratiba ya dawa inahitaji intaneti ili kupakiwa.'
                            : 'Cached data: ratiba ya dozi ilisawazishwa ${_date(_lastSyncedAt!.toIso8601String())}. Maagizo kamili na upatikanaji vinahitaji intaneti.',
                        tone: NoticeTone.attention,
                      ),
                    if (_error != null) Notice(_error!),
                    const SectionTitle('Maagizo ya daktari'),
                    if (_prescriptions.isEmpty)
                      Empty(
                        _offline
                            ? 'Maagizo kamili ya dawa yanahitaji intaneti; rekodi tupu iliyohifadhiwa haimaanishi kuwa huna agizo.'
                            : 'Hakuna agizo la dawa lililopo kwenye rekodi zako.',
                      ),
                    MedicationPrescriptionCards(
                      prescriptions: _prescriptions,
                      formatDate: _date,
                    ),
                    const SectionTitle('Ratiba na uthibitisho wa dozi'),
                    if (_logs.isEmpty)
                      const Empty('Hakuna dozi zilizopangiwa.'),
                    ..._logs.map(
                      (l) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Panel(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${l['medication_name']} ${l['dosage']}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w500),
                              ),
                              Text(
                                '${_date(l['scheduled_at'])} • ${l['reported_status']}',
                              ),
                              if (l['reported_status'] == 'unreported')
                                Row(
                                  children: [
                                    TextButton(
                                      onPressed: () => _report(l, 'taken'),
                                      child: const Text('Nimetumia'),
                                    ),
                                    TextButton(
                                      onPressed: () => _report(l, 'missed'),
                                      child: const Text('Sikutumia'),
                                    ),
                                  ],
                                ),
                              if (l['sync_status'] == 'queued' ||
                                  l['synced'] == 0 &&
                                      l['sync_status'] != 'failed')
                                const Text(
                                  'Pending sync — jibu halijathibitishwa na seva.',
                                  style: TextStyle(color: AppColors.amber),
                                ),
                              if (l['sync_status'] == 'failed')
                                const Text(
                                  'Jibu linahitaji kuangaliwa mtandaoni; halijathibitishwa.',
                                  style: TextStyle(color: AppColors.clay),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SectionTitle('Tafuta upatikanaji wa dawa'),
                    const Text(
                      'Taarifa za stock hutolewa na maduka na zinaweza kubadilika; hakuna dawa inayowekwa akiba hapa.',
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _search,
                            decoration: const InputDecoration(
                              labelText: 'Jina la dawa',
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton(
                          onPressed: _searching ? null : _find,
                          icon: const Icon(Icons.search),
                        ),
                      ],
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _latitudeInput,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                              signed: true,
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Latitudo',
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: _longitudeInput,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                              signed: true,
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Longitudo',
                            ),
                          ),
                        ),
                      ],
                    ),
                    MedicationAvailabilityResults(
                      rows: _availability,
                      searched: _availabilitySearched,
                      error: _availabilityError,
                      formatDate: _date,
                    ),
                    if (_searching)
                      const Center(child: CircularProgressIndicator()),
                  ],
                ),
              ),
      );
}

class MedicationPrescriptionCards extends StatelessWidget {
  const MedicationPrescriptionCards({
    required this.prescriptions,
    required this.formatDate,
    super.key,
  });

  final List<Map<String, dynamic>> prescriptions;
  final String Function(Object?) formatDate;

  @override
  Widget build(BuildContext context) => Column(
        children: prescriptions.map((prescription) {
          final items =
              (prescription['items'] as List? ?? []).whereType<Map>().toList();
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Agizo • ${prescription['status'] ?? ''} • ${formatDate(prescription['created_at'])}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  ...items.map(
                    (item) => Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        '${item['medication_name'] ?? ''} • ${item['dosage'] ?? ''}\n${item['frequency_per_day'] ?? '?'} mara kwa siku kwa siku ${item['duration_days'] ?? '?'}${item['instructions'] == null ? '' : '\n${item['instructions']}'}',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      );
}

class MedicationAvailabilityResults extends StatelessWidget {
  const MedicationAvailabilityResults({
    required this.rows,
    required this.searched,
    required this.error,
    required this.formatDate,
    super.key,
  });

  final List<Map<String, dynamic>> rows;
  final bool searched;
  final String? error;
  final String Function(Object?) formatDate;

  @override
  Widget build(BuildContext context) {
    if (error != null) return Notice(error!);
    if (!searched) return const SizedBox.shrink();
    if (rows.isEmpty) {
      return const Empty(
        'Hakuna taarifa ya upatikanaji wa dawa hii kwa eneo hilo.',
      );
    }
    return Column(
      children: rows.map((r) {
        final pharmacy = r['pharmacy'] as Map? ?? {};
        return ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(
            '${r['medication_name'] ?? ''} • ${r['stock_status'] ?? ''}',
          ),
          subtitle: Text(
            '${pharmacy['name'] ?? 'Duka la dawa'} • ${pharmacy['distance_km'] ?? '?'} km • taarifa ${formatDate(r['last_reported_at'])}',
          ),
        );
      }).toList(),
    );
  }
}
