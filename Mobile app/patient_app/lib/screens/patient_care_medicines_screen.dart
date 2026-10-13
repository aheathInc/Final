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
  final _requiredQuantityInput = TextEditingController();
  List<Map<String, dynamic>> _prescriptions = [], _availability = [];
  final Map<String, Map<String, dynamic>> _fulfillment = {};
  final Map<String, String> _fulfillmentErrors = {};
  final Map<String, String> _handoffReferences = {};
  final Set<String> _handoffBusy = {};
  List<Map<String, Object?>> _logs = [];
  String? _error, _availabilityError;
  String? _ownerId;
  int _loadGeneration = 0;
  int _ownerGeneration = 0;
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
    _requiredQuantityInput.dispose();
    super.dispose();
  }

  void _clearOwnerData(String? ownerId) {
    _prescriptions = [];
    _availability = [];
    _fulfillment.clear();
    _fulfillmentErrors.clear();
    _handoffReferences.clear();
    _handoffBusy.clear();
    _logs = [];
    _error = null;
    _availabilityError = null;
    _ownerId = ownerId;
    _lastSyncedAt = null;
    _latitude = null;
    _longitude = null;
    _searching = false;
    _availabilitySearched = false;
    _offline = false;
    _search.clear();
    _latitudeInput.clear();
    _longitudeInput.clear();
    _requiredQuantityInput.clear();
  }

  Future<bool> _isCurrentLoad(
    int loadGeneration,
    int ownerGeneration,
    String ownerId,
  ) async {
    if (!mounted ||
        loadGeneration != _loadGeneration ||
        ownerGeneration != _ownerGeneration) {
      return false;
    }
    final currentOwnerId = await Session.userId();
    return mounted &&
        loadGeneration == _loadGeneration &&
        ownerGeneration == _ownerGeneration &&
        currentOwnerId == ownerId;
  }

  Future<bool> _isCurrentOwnerRequest(
    int ownerGeneration,
    String ownerId,
  ) async {
    if (!mounted || ownerGeneration != _ownerGeneration) return false;
    final currentOwnerId = await Session.userId();
    return mounted &&
        ownerGeneration == _ownerGeneration &&
        currentOwnerId == ownerId;
  }

  Future<void> _load() async {
    final loadGeneration = ++_loadGeneration;
    final ownerId = await Session.userId();
    if (!mounted || loadGeneration != _loadGeneration) return;
    if (ownerId == null) {
      if (_ownerId != null) _ownerGeneration++;
      setState(() {
        _clearOwnerData(null);
        _loading = false;
        _offline = true;
        _error = 'Ingia tena ili kufungua taarifa zako zilizohifadhiwa.';
      });
      return;
    }
    if (_ownerId != ownerId) {
      _ownerGeneration++;
      setState(() {
        _clearOwnerData(ownerId);
        _loading = true;
      });
    }
    final ownerGeneration = _ownerGeneration;
    final online = await Api.online;
    if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId)) return;
    if (!online) {
      final cached = await Db.medicationSchedule(ownerId);
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      final lastSyncedAt = await Db.cacheSyncedAt(
        'medication_schedule',
        ownerId,
      );
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      setState(() {
        _prescriptions = [];
        _fulfillment.clear();
        _fulfillmentErrors.clear();
        _handoffReferences.clear();
        _logs = cached;
        _lastSyncedAt = lastSyncedAt;
        _offline = true;
        _loading = false;
        _error = null;
      });
      return;
    }
    try {
      final profile = await Api.get('/patient-profiles/me');
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      final id = profile['id'] as String;
      final location = profile['default_location'];
      final values = await Future.wait([
        _care.prescriptions(id),
        _care.adherenceLogs(id),
      ]);
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      final fulfillment = <String, Map<String, dynamic>>{};
      final fulfillmentErrors = <String, String>{};
      await Future.wait(values[0].map((prescription) async {
        final prescriptionId = prescription['id'] as String?;
        if (prescriptionId == null) return;
        try {
          fulfillment[prescriptionId] =
              await _care.prescriptionFulfillment(prescriptionId);
        } on ApiException catch (e) {
          fulfillmentErrors[prescriptionId] = e.message;
        } catch (_) {
          fulfillmentErrors[prescriptionId] =
              'Hali ya utoaji haikupatikana. Jaribu tena.';
        }
      }));
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      final rows = values[1].map(adherenceCacheRow).toList();
      await Db.replaceMedicationSchedule(ownerId, rows);
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      final cached = await Db.medicationSchedule(ownerId);
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      final serverIds = rows.map((r) => r['id']).toSet();
      final pending = cached.where(
        (r) => r['synced'] == 0 && !serverIds.contains(r['id']),
      );
      final byId = <Object?, Map<String, Object?>>{
        for (final row in rows) row['id']: row,
        for (final row in pending) row['id']: row,
      };
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
        _fulfillment
          ..clear()
          ..addAll(fulfillment);
        _fulfillmentErrors
          ..clear()
          ..addAll(fulfillmentErrors);
        _logs = byId.values.toList();
        _lastSyncedAt = DateTime.now().toUtc();
        _offline = false;
        _loading = false;
        _error = null;
      });
    } catch (_) {
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      final cached = await Db.medicationSchedule(ownerId);
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      final lastSyncedAt = await Db.cacheSyncedAt(
        'medication_schedule',
        ownerId,
      );
      if (!await _isCurrentLoad(loadGeneration, ownerGeneration, ownerId))
        return;
      setState(() {
        _prescriptions = [];
        _fulfillment.clear();
        _fulfillmentErrors.clear();
        _handoffReferences.clear();
        _logs = cached;
        _lastSyncedAt = lastSyncedAt;
        _offline = true;
        _loading = false;
        _error = 'Internet haipatikani. Unaona ratiba iliyohifadhiwa tu.';
      });
    }
  }

  Future<void> _createHandoff(String prescriptionId) async {
    final ownerId = _ownerId;
    final ownerGeneration = _ownerGeneration;
    if (ownerId == null) return;
    if (_offline || !await Api.online) {
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() =>
            _error = 'Reference salama inaweza kuombwa ukiwa mtandaoni tu.');
      }
      return;
    }
    if (!await _isCurrentOwnerRequest(ownerGeneration, ownerId)) return;
    setState(() {
      _handoffBusy.add(prescriptionId);
      _error = null;
    });
    try {
      final result = await _care.createPrescriptionHandoff(prescriptionId);
      if (!await _isCurrentOwnerRequest(ownerGeneration, ownerId)) return;
      final reference = result['reference'];
      if (reference is! String || reference.length != 43) {
        throw const FormatException(
            'Secure handoff reference response is invalid.');
      }
      setState(() => _handoffReferences[prescriptionId] = reference);
    } on ApiException catch (e) {
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() => _error = e.message);
      }
    } catch (_) {
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() => _error =
            'Reference haikuundwa. Hakuna taarifa iliyohifadhiwa offline.');
      }
    } finally {
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() => _handoffBusy.remove(prescriptionId));
      }
    }
  }

  Future<void> _revokeHandoff(String prescriptionId) async {
    final ownerId = _ownerId;
    final ownerGeneration = _ownerGeneration;
    if (ownerId == null ||
        !await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
      return;
    }
    setState(() {
      _handoffBusy.add(prescriptionId);
      _error = null;
    });
    try {
      await _care.revokePrescriptionHandoff(prescriptionId);
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() => _handoffReferences.remove(prescriptionId));
      }
    } on ApiException catch (e) {
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() => _error = e.message);
      }
    } catch (_) {
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() =>
            _error = 'Reference haikufutwa. Jaribu tena ukiwa mtandaoni.');
      }
    } finally {
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() => _handoffBusy.remove(prescriptionId));
      }
    }
  }

  Future<void> _report(Map<String, Object?> log, String status) async {
    final id = log['id'] as String;
    final ownerId = _ownerId;
    if (ownerId == null) return;
    final ownerGeneration = _ownerGeneration;
    if (!await _isCurrentOwnerRequest(ownerGeneration, ownerId)) return;
    final opId = newOpId();
    try {
      final updated = await _care.confirmDose(
        opId: opId,
        adherenceLogId: id,
        reportedStatus: status,
      );
      final savedStatus = updated['reported_status'] as String? ?? status;
      await Db.markReported(ownerId, id, savedStatus, syncStatus: 'confirmed');
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId))
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
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId))
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
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() => _error = e.message);
      }
    } catch (_) {
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() => _error = 'Jibu la dozi halikuhifadhiwa.');
      }
    }
  }

  Future<void> _find() async {
    final ownerId = _ownerId;
    final ownerGeneration = _ownerGeneration;
    if (ownerId == null) return;
    final name = _search.text.trim();
    if (name.isEmpty) return;
    final latitude = double.tryParse(_latitudeInput.text.trim());
    final longitude = double.tryParse(_longitudeInput.text.trim());
    final rawRequiredQuantity = _requiredQuantityInput.text.trim();
    final requiredQuantity =
        rawRequiredQuantity.isEmpty ? null : int.tryParse(rawRequiredQuantity);
    if (rawRequiredQuantity.isNotEmpty &&
        (requiredQuantity == null || requiredQuantity < 1)) {
      setState(() => _error = 'Weka kiasi kizima kilicho zaidi ya sifuri.');
      return;
    }
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
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId)) {
        setState(() {
          _searching = false;
          _availabilityError =
              'INTERNET REQUIRED. Upatikanaji wa dawa hauwezi kukaguliwa ukiwa offline.';
        });
      }
      return;
    }
    if (!await _isCurrentOwnerRequest(ownerGeneration, ownerId)) return;
    try {
      final rows = await _care.medicationAvailability(
        name: name,
        latitude: latitude,
        longitude: longitude,
        requiredQuantity: requiredQuantity,
      );
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId))
        setState(() {
          _availability = rows;
          _searching = false;
          _availabilitySearched = true;
        });
    } catch (e) {
      if (await _isCurrentOwnerRequest(ownerGeneration, ownerId))
        setState(() {
          _availabilityError =
              e is ApiException ? e.message : 'Utafutaji haujafaulu.';
          _searching = false;
        });
    }
  }

  Future<void> _searchPrescriptionItem(
      String medicationName, int quantity) async {
    _search.text = medicationName;
    _requiredQuantityInput.text = quantity.toString();
    await _find();
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
                      fulfillmentByPrescription: _fulfillment,
                      fulfillmentErrors: _fulfillmentErrors,
                      handoffReferences: _handoffReferences,
                      handoffBusy: _handoffBusy,
                      canIssueHandoff: !_offline,
                      onIssueHandoff: _createHandoff,
                      onRevokeHandoff: _revokeHandoff,
                      onSearchNearbyMedication: _searchPrescriptionItem,
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
                    TextField(
                      controller: _requiredQuantityInput,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Kiasi kinachohitajika (hiari)',
                      ),
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
    this.fulfillmentByPrescription = const {},
    this.fulfillmentErrors = const {},
    this.handoffReferences = const {},
    this.handoffBusy = const {},
    this.canIssueHandoff = false,
    this.onIssueHandoff,
    this.onRevokeHandoff,
    this.onSearchNearbyMedication,
    super.key,
  });

  final List<Map<String, dynamic>> prescriptions;
  final String Function(Object?) formatDate;
  final Map<String, Map<String, dynamic>> fulfillmentByPrescription;
  final Map<String, String> fulfillmentErrors;
  final Map<String, String> handoffReferences;
  final Set<String> handoffBusy;
  final bool canIssueHandoff;
  final Future<void> Function(String prescriptionId)? onIssueHandoff;
  final Future<void> Function(String prescriptionId)? onRevokeHandoff;
  final Future<void> Function(String medicationName, int quantity)?
      onSearchNearbyMedication;

  @override
  Widget build(BuildContext context) => Column(
        children: prescriptions.map((prescription) {
          final prescriptionId = prescription['id'] as String? ?? '';
          final fulfilment = fulfillmentByPrescription[prescriptionId];
          final items =
              (prescription['items'] as List? ?? []).whereType<Map>().toList();
          final fulfilmentItems = (fulfilment?['items'] as List? ?? [])
              .whereType<Map>()
              .map((row) => Map<String, dynamic>.from(row))
              .toList();
          final itemById = {for (final row in fulfilmentItems) row['id']: row};
          final facility = fulfilment?['facility_pharmacy'] as Map?;
          final facilityItems =
              (facility?['items'] as List? ?? []).whereType<Map>().toList();
          final history = (fulfilment?['dispensing_history'] as List? ?? [])
              .whereType<Map>()
              .toList();
          final reference = handoffReferences[prescriptionId];
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
                  if (fulfillmentErrors[prescriptionId] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(fulfillmentErrors[prescriptionId]!,
                          style: const TextStyle(color: AppColors.clay)),
                    ),
                  if (fulfilment != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                          'Utoaji: ${fulfilment['fulfilment_status'] ?? 'unknown'}'),
                    ),
                  if (facility != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Duka la kituo: ${facility['name'] ?? ''}',
                              style:
                                  const TextStyle(fontWeight: FontWeight.w600)),
                          ...facilityItems.map((row) => Text(
                              '${row['medication_name'] ?? ''}: ${row['availability'] ?? 'unknown'} • zilizopo ${row['quantity_on_hand'] ?? 'hazijathibitishwa'} • hazijahifadhiwa')),
                        ],
                      ),
                    ),
                  ...items.map(
                    (item) {
                      final detail = itemById[item['id']];
                      final remaining = detail?['quantity_remaining'];
                      final medicationName = item['medication_name'] as String?;
                      return Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${item['medication_name'] ?? ''} • ${item['dosage'] ?? ''}\n${item['frequency_per_day'] ?? '?'} mara kwa siku kwa siku ${item['duration_days'] ?? '?'}${item['instructions'] == null ? '' : '\n${item['instructions']}'}'
                              '${detail == null ? '' : '\nKiasi: ${detail['quantity_prescribed'] ?? 'hakijaainishwa'} • kimetolewa: ${detail['quantity_dispensed'] ?? 0} • kimebaki: ${detail['quantity_remaining'] ?? 'haijathibitishwa'}'}',
                            ),
                            if (remaining is int &&
                                remaining > 0 &&
                                medicationName != null &&
                                onSearchNearbyMedication != null)
                              TextButton.icon(
                                onPressed: () => onSearchNearbyMedication!(
                                    medicationName, remaining),
                                icon: const Icon(Icons.search),
                                label: const Text(
                                    'Tafuta pharmacy kwa kiasi kilichobaki'),
                              ),
                          ],
                        ),
                      );
                    },
                  ),
                  if (history.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    const Text('Historia ya utoaji',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                    ...history.map((event) {
                      final pharmacy = event['pharmacy'] as Map? ?? {};
                      final eventItems =
                          (event['items'] as List? ?? []).whereType<Map>();
                      return Text(
                          '${pharmacy['name'] ?? 'Pharmacy'} • ${formatDate(event['dispensed_at'])}: ${eventItems.map((row) => '${row['medication_name']} × ${row['quantity_dispensed']}').join(', ')}');
                    }),
                  ],
                  if (reference != null) ...[
                    const SizedBox(height: 12),
                    const Text(
                        'Reference ya mkononi — ionyeshe mfamasia aliyeidhinishwa pekee. Haitoi ruhusa bila akaunti na uanachama wa pharmacy.',
                        style: TextStyle(fontSize: 12)),
                    SelectableText(reference,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, letterSpacing: 1.1)),
                    TextButton(
                        onPressed: handoffBusy.contains(prescriptionId)
                            ? null
                            : () => onRevokeHandoff?.call(prescriptionId),
                        child: const Text('Batili reference')),
                  ] else if (canIssueHandoff &&
                      prescription['status'] == 'active' &&
                      prescription['valid_until'] != null &&
                      onIssueHandoff != null) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: handoffBusy.contains(prescriptionId)
                          ? null
                          : () => onIssueHandoff?.call(prescriptionId),
                      icon: handoffBusy.contains(prescriptionId)
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.qr_code_2),
                      label: const Text('Pata reference salama ya pharmacy'),
                    ),
                  ],
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
        final distance = pharmacy['distance_km'] is num
            ? NumberFormat('0.0').format(pharmacy['distance_km'])
            : null;
        return ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(
            '${r['medication_name'] ?? ''} • ${r['fulfillment_status'] ?? 'unknown'}',
          ),
          subtitle: Text(
            '${pharmacy['name'] ?? 'Duka la dawa'}'
            '${distance == null ? '' : ' • $distance km'}'
            ' • zilizopo ${r['quantity_on_hand'] ?? 'hazijathibitishwa'} • hazijahifadhiwa'
            ' • taarifa ${formatDate(r['last_reported_at'])}',
          ),
        );
      }).toList(),
    );
  }
}
