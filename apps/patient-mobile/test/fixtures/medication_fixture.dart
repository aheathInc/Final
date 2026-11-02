import 'dart:async';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/medication_followup.dart';

class MedicationFixture extends MedicationRepository {
  bool fail = false, conflict = false;
  Completer<void>? gate;
  final reports = <Map<String, dynamic>>[],
      snoozes = <Map<String, dynamic>>[],
      supplies = <Map<String, dynamic>>[];
  final scheduled =
      DateTime.now().subtract(const Duration(minutes: 10)).toUtc();
  late List<Map<String, dynamic>> records = [
    {
      'id': 'synthetic-dose',
      'medication_name': 'Synthetic test medicine',
      'prescription_item_id': 'synthetic-item',
      'dosage': 'Synthetic clinician dose',
      'scheduled_at': scheduled.toIso8601String(),
      'reported_status': 'unreported',
      'schedule_status': 'active',
      'version': 1
    },
    {
      'id': 'synthetic-future',
      'medication_name': 'Synthetic future medicine',
      'prescription_item_id': 'synthetic-item',
      'dosage': 'Synthetic instruction',
      'scheduled_at': DateTime.now()
          .add(const Duration(hours: 1))
          .toUtc()
          .toIso8601String(),
      'reported_status': 'unreported',
      'schedule_status': 'active',
      'version': 1
    },
  ];
  @override
  Future<Map<String, dynamic>> summary(
      {int days = 7, String? profileId}) async {
    if (gate != null) await gate!.future;
    if (fail) throw StateError('Synthetic offline');
    return {
      'patient': {'id': 'synthetic-profile', 'full_name': 'Synthetic Patient'},
      'profiles': [
        {'id': 'synthetic-profile', 'full_name': 'Synthetic Patient'}
      ],
      'window': {'days': days, 'timezone': 'Africa/Dar_es_Salaam'},
      'summary': {
        'due': 4,
        'taken': 2,
        'skipped': 1,
        'delayed': 0,
        'unconfirmed': 1,
        'reported_taken_percent': 50,
        'snoozed': 1,
        'taken_after_scheduled': 1
      },
      'trend': [
        {
          'date': DateTime.now().toIso8601String().substring(0, 10),
          'due': 4,
          'taken': 2,
          'skipped': 1,
          'unconfirmed': 1,
          'delayed': 0
        }
      ],
      'medicines': [
        {
          'id': 'synthetic-item',
          'medication_name': 'Synthetic test medicine',
          'dosage': 'Synthetic clinician dose',
          'instructions': 'Synthetic doctor instruction: unchanged.',
          'education': 'Synthetic doctor education.',
          'image_url': null,
          'supply': {
            'version': 1,
            'remaining': 2,
            'units_per_dose': 1,
            'unit_label': 'tablets',
            'low_stock_threshold': 3,
            'low_stock': true,
            'baseline_at': '2026-10-29T08:00:00Z'
          }
        }
      ],
      'medicines_truncated': false
    };
  }

  @override
  Future<List<Map<String, dynamic>>> doses({String? profileId}) async {
    if (gate != null) await gate!.future;
    return records.map((r) => Map<String, dynamic>.from(r)).toList();
  }

  @override
  Future<void> report(Map<String, dynamic> dose,
      {required bool taken,
      String? reason,
      String? note,
      required String key}) async {
    if (conflict)
      throw ApiException(409, 'VERSION_CONFLICT', 'Synthetic version conflict');
    reports.add({
      'id': dose['id'],
      'taken': taken,
      'reason': reason,
      'note': note,
      'key': key
    });
    records = records
        .map((r) => r['id'] == dose['id']
            ? {
                ...r,
                'reported_status': taken ? 'taken' : 'missed',
                'version': 2
              }
            : r)
        .toList();
  }

  @override
  Future<void> snooze(
      Map<String, dynamic> dose, int minutes, String key) async {
    snoozes.add({'id': dose['id'], 'minutes': minutes, 'key': key});
    records = records
        .map((r) => r['id'] == dose['id']
            ? {
                ...r,
                'snoozed_until': DateTime.now()
                    .add(Duration(minutes: minutes))
                    .toUtc()
                    .toIso8601String(),
                'version': 2
              }
            : r)
        .toList();
  }

  @override
  Future<void> supply(Map<String, dynamic> item,
      {required double quantity,
      double? unitsPerDose,
      required String unit,
      required double threshold,
      required String key}) async {
    supplies.add({
      'quantity': quantity,
      'units_per_dose': unitsPerDose,
      'unit': unit,
      'threshold': threshold,
      'key': key
    });
  }
}
