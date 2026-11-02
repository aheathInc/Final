import 'package:flutter/services.dart';
import 'api.dart';
import 'session.dart';
import 'l10n.dart';

class MedicationRepository {
  Future<Map<String, dynamic>> summary(
          {int days = 7, String? profileId}) async =>
      Map<String, dynamic>.from(
          await Api.get('/care-continuity/medication-summary', query: {
        'days': days,
        if (profileId != null) 'patient_profile_id': profileId
      }));
  Future<List<Map<String, dynamic>>> doses({String? profileId}) async {
    final result = <Map<String, dynamic>>[];
    String? cursor;
    final seen = <String>{};
    do {
      final page = await Api.get('/care-continuity/me', query: {
        'limit': 100,
        if (profileId != null) 'patient_profile_id': profileId,
        if (cursor != null) 'cursor': cursor
      });
      result.addAll((page['doses'] as List)
          .map((r) => Map<String, dynamic>.from(r as Map)));
      cursor = (page['meta'] as Map)['next_cursor'] as String?;
      if (cursor != null && !seen.add(cursor)) {
        throw const FormatException('Repeated medication cursor');
      }
    } while (cursor != null);
    return result;
  }

  Future<void> report(Map<String, dynamic> dose,
      {required bool taken,
      String? reason,
      String? note,
      required String key}) async {
    if (!taken &&
        !{'forgot', 'ran_out', 'side_effects', 'other'}.contains(reason)) {
      throw ArgumentError('Skip reason required');
    }
    await Api.post(
        '/adherence-logs/${dose['id']}/confirm',
        {
          'base_version': dose['version'],
          'reported_status': taken ? 'taken' : 'missed',
          'channel': 'app',
          if (reason != null) 'skip_reason': reason,
          if (note?.trim().isNotEmpty == true) 'note': note!.trim()
        },
        idempotencyKey: key);
  }

  Future<void> snooze(
      Map<String, dynamic> dose, int minutes, String key) async {
    await Api.post('/care-continuity/doses/${dose['id']}/snooze',
        {'base_version': dose['version'], 'minutes': minutes},
        idempotencyKey: key);
  }

  Future<void> supply(Map<String, dynamic> item,
      {required double quantity,
      double? unitsPerDose,
      required String unit,
      required double threshold,
      required String key}) async {
    await Api.post(
        '/care-continuity/items/${item['id']}/supply',
        {
          'base_version': (item['supply'] as Map?)?['version'] ?? 0,
          'quantity': quantity,
          if (unitsPerDose != null) 'units_per_dose': unitsPerDose,
          'unit_label': unit,
          'low_stock_threshold': threshold
        },
        idempotencyKey: key);
  }
}

class MedicationReminders {
  static const channel = MethodChannel('ahealth/medication_reminders');
  static bool requestingPermission = false,
      _refreshing = false,
      _pending = false;
  static DateTime? _lastSync;
  static String? _ownerId;
  static bool _refreshAgain = false;
  static void Function()? _open;
  static Future<Map<String, dynamic>> status() async {
    try {
      return Map<String, dynamic>.from(
          await channel.invokeMethod('status') as Map);
    } catch (_) {
      return {
        'available': false,
        'enabled': false,
        'notifications_allowed': false,
        'exact_allowed': false,
        'scheduled_count': 0
      };
    }
  }

  static Future<void> owner(String id) async {
    if (_ownerId != id) {
      _ownerId = id;
      _lastSync = null;
    }
    try {
      await channel.invokeMethod('owner', {'id': id});
    } catch (_) {}
  }

  static Future<void> clear() async {
    _lastSync = null;
    _ownerId = null;
    try {
      await channel.invokeMethod('clear');
    } catch (_) {}
  }

  static Future<void> initialize(void Function() open) async {
    _open = open;
    channel.setMethodCallHandler((call) async {
      if (call.method == 'openMedication') {
        try {
          await channel.invokeMethod('consumeOpen');
        } catch (_) {}
        _pending = true;
        tryOpen();
      }
    });
    try {
      _pending = await channel.invokeMethod<bool>('consumeOpen') ?? false;
    } catch (_) {}
    tryOpen();
  }

  static void tryOpen() {
    if (_pending && !Session.locked.value) {
      _pending = false;
      _open?.call();
    }
  }

  static Future<void> enable(bool enabled) async {
    final id = await Session.userId();
    if (id == null) return;
    await owner(id);
    if (enabled) {
      requestingPermission = true;
      try {
        await channel.invokeMethod('permission');
      } finally {
        requestingPermission = false;
      }
      if ((await status())['notifications_allowed'] != true) return;
    }
    await channel.invokeMethod('enable', {'enabled': enabled});
    if (enabled) await refresh(force: true);
  }

  static Future<void> exactSettings() async {
    await channel.invokeMethod('exactSettings');
  }

  static Future<void> refill(Map<String, dynamic> data, int identity) async {
    try {
      final id = await Session.userId();
      if (id == null || identity != Session.identityChanges.value) return;
      for (final item in data['medicines'] as List) {
        final supply = item['supply'] as Map?;
        if (supply?['low_stock'] != true) continue;
        if (identity != Session.identityChanges.value) return;
        await channel.invokeMethod('refill', {
          'owner': id,
          'key': '${item['id']}:${supply!['baseline_at']}',
          'title': L.tr('Kumbusho la kuongeza akiba'),
          'body': L.tr(
              'Akiba uliyoripoti inaelekea kuisha. Fungua A-Health kuangalia taarifa na kuwasiliana na mtoa huduma.')
        });
      }
    } catch (_) {/* The in-app stock notice remains available. */}
  }

  static Future<void> refresh({bool force = false}) async {
    if (_refreshing) {
      if (force) _refreshAgain = true;
      return;
    }
    if (Session.locked.value) return;
    if (!force &&
        _lastSync != null &&
        DateTime.now().difference(_lastSync!) < const Duration(minutes: 5)) {
      return;
    }
    _refreshing = true;
    try {
      final identity = Session.identityChanges.value,
          id = await Session.userId();
      if (id == null) return;
      await owner(id);
      if ((await status())['enabled'] != true) return;
      final result = await Api.get('/care-continuity/medication-alarms');
      if (identity != Session.identityChanges.value ||
          id != await Session.userId()) {
        return;
      }
      final events = (result['data'] as List)
          .map((r) => {
                'id': r['id'],
                'at': DateTime.parse(r['at'] as String).millisecondsSinceEpoch,
                'title': L.tr('Kikumbusho cha dawa'),
                'body': L.tr(
                    'Fungua A-Health uangalie ratiba yako na uthibitishe dozi. Usibadili maagizo ya daktari.')
              })
          .toList();
      await channel.invokeMethod('replace', {'owner': id, 'events': events});
      _lastSync = DateTime.now();
    } catch (_) {
      /* Keep existing reminders on a temporary network failure. */
    } finally {
      _refreshing = false;
      if (_refreshAgain) {
        _refreshAgain = false;
        await refresh(force: true);
      }
    }
  }
}
