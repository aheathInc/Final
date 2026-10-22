import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/health_history.dart';

void main() {
  final entries = parseHealthHistoryResponse({
    'data': [
      {
        'id': 'native-1',
        'category': 'consultation',
        'occurred_at': '2026-10-01T10:00:00Z',
        'source': {'type': 'ahp', 'name': 'A-health'},
      },
      {
        'id': 'external-1',
        'category': 'diagnostic',
        'occurred_at': '2026-10-02T10:00:00Z',
        'source': {'type': 'external', 'name': 'Hospital A EHR'},
      },
      {'id': 'malformed', 'category': 'diagnostic'},
    ],
  });

  test('parses supported timeline rows and drops incomplete rows', () {
    expect(entries.map((entry) => entry['id']), ['native-1', 'external-1']);
  });

  test('filters timeline by clinical category', () {
    expect(
      filterHealthHistory(entries, category: 'diagnostic').single['id'],
      'external-1',
    );
  });

  test('filters AHP-native and external records independently', () {
    expect(filterHealthHistory(entries, source: 'ahp').single['id'], 'native-1');
    expect(filterHealthHistory(entries, source: 'external').single['id'], 'external-1');
  });

  test('rejects a malformed API envelope', () {
    expect(() => parseHealthHistoryResponse({'items': []}), throwsFormatException);
  });
}
