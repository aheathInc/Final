import 'dart:math';
import 'api.dart';

Map<String, dynamic> careObject(dynamic value) {
  if (value is! Map) throw const FormatException('Invalid care response.');
  return Map<String, dynamic>.from(value);
}
List<Map<String, dynamic>> careRows(dynamic value) {
  if (value is! List) throw const FormatException('Missing care list.');
  return value.map(careObject).toList(growable: false);
}
String newCareRequestKey() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0,8)}-${hex.substring(8,12)}-${hex.substring(12,16)}-${hex.substring(16,20)}-${hex.substring(20)}';
}
class CareOverview {
  CareOverview._(this.raw, this.patient, this.profiles, this.doses, this.cycles, this.plans, this.reminders, this.preference, this.nextCursor);
  final Map<String, dynamic> raw, patient, preference;
  final List<Map<String, dynamic>> profiles, doses, cycles, plans, reminders;
  final String? nextCursor;
  factory CareOverview.parse(dynamic value) {
    final r = careObject(value);
    final patient = careObject(r['patient']);
    if (patient['id'] is! String || patient['full_name'] is! String) throw const FormatException('Missing patient context.');
    final preference = careObject(r['preference']);
    if (preference['sms_enabled'] is! bool || preference['version'] is! int) throw const FormatException('Invalid preferences.');
    final doses = careRows(r['doses']);
    for (final d in doses) {
      if (d['id'] is! String || d['version'] is! int || d['medication_name'] is! String ||
          d['scheduled_at'] is! String || DateTime.tryParse(d['scheduled_at'] as String) == null) {
        throw const FormatException('Invalid dose data.');
      }
    }
    final profiles = careRows(r['profiles']);
    for (final p in profiles) {
      if (p['id'] is! String || p['full_name'] is! String) throw const FormatException('Invalid patient selector.');
    }
    final cycles = careRows(r['cycles']);
    for (final c in cycles) {
      if (c['id'] is! String || c['care_thread_id'] is! String || c['end_date'] is! String || DateTime.tryParse(c['end_date'] as String) == null) {
        throw const FormatException('Invalid follow-up record.');
      }
      careRows(c['checkins']);
      for (final contact in careRows(c['contacts'])) {
        if (contact['scheduled_at'] is! String || contact['channel'] is! String || contact['purpose'] is! String || contact['status'] is! String) {
          throw const FormatException('Invalid contact record.');
        }
      }
    }
    final plans = careRows(r['plans']);
    for (final i in plans) {
      if (i['medication_name'] is! String) throw const FormatException('Invalid medication plan.');
      if (i['plan'] != null) {
        final plan = careObject(i['plan']);
        if (plan['times'] is! List || !(plan['times'] as List).every((t) => t is String) || plan['timezone'] is! String || plan['start_date'] is! String || plan['status'] is! String) {
          throw const FormatException('Invalid reminder timing.');
        }
      }
    }
    final reminders = careRows(r['reminders']);
    for (final reminder in reminders) {
      if (reminder['id'] is! String || reminder['due_at'] is! String || reminder['delivery'] is! String) throw const FormatException('Invalid reminder.');
    }
    final meta = careObject(r['meta']);
    return CareOverview._(r, patient, profiles, doses, cycles, plans,
      reminders, preference, meta['next_cursor'] as String?);
  }
}

/// Read/write only through the existing authenticated API. No new token storage.
class CareContinuityRepository {
  Future<CareOverview> overview({String? profileId, String? cursor}) async => CareOverview.parse(await Api.get('/care-continuity/me', query: {
    'limit': 50, if (profileId != null) 'patient_profile_id': profileId, if (cursor != null) 'cursor': cursor,
  }));
  Future<void> reportDose(Map<String, dynamic> dose, String status, String key) async {
    if (!{'taken', 'missed', 'delayed'}.contains(status)) throw ArgumentError('Invalid dose report');
    // Online-only here: server confirmation is required; the existing legacy
    // adherence screen retains its separate outbox workflow.
    if (!await Api.online) throw ApiException(0, 'ONLINE_REQUIRED', 'Unganisha intaneti. Jibu halijahifadhiwa.');
    await Api.post('/adherence-logs/${dose['id']}/confirm', {
      'reported_status': status, 'base_version': dose['version'], 'channel': 'app',
    }, idempotencyKey: key);
  }
  Future<void> preference(String profileId, int version, bool smsEnabled, String key) async {
    if (!await Api.online) throw ApiException(0, 'ONLINE_REQUIRED', 'Unganisha intaneti kubadili vikumbusho.');
    await Api.post('/care-continuity/patients/$profileId/preferences', {
      'base_version': version, 'sms_enabled': smsEnabled,
    }, idempotencyKey: key);
  }
  Future<void> markRead(String id, String key) async {
    await Api.post('/care-continuity/reminders/$id/read', {}, idempotencyKey: key);
  }
}
