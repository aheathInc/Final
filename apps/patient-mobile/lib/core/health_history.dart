const healthHistoryCategories = <String, String>{
  'all': 'Zote',
  'consultation': 'Mashauriano',
  'referral': 'Rufaa',
  'diagnostic': 'Vipimo',
  'medication': 'Dawa',
  'dispensing': 'Dawa zilizotolewa',
  'medical_record': 'Rekodi nyingine',
  'encounter': 'Ziara',
  'condition': 'Hali ya afya',
  'allergy': 'Mzio',
};

List<Map<String, dynamic>> parseHealthHistoryResponse(dynamic response) {
  if (response is! Map || response['data'] is! List) {
    throw const FormatException('Jibu la historia halijatambulika.');
  }
  final rows = <Map<String, dynamic>>[];
  for (final raw in response['data'] as List) {
    if (raw is! Map) continue;
    final row = Map<String, dynamic>.from(raw);
    final source = row['source'];
    if (row['id'] is! String ||
        row['category'] is! String ||
        row['occurred_at'] is! String ||
        source is! Map ||
        !['ahp', 'external'].contains(source['type'])) {
      continue;
    }
    rows.add(row);
  }
  return List.unmodifiable(rows);
}

List<Map<String, dynamic>> filterHealthHistory(
  List<Map<String, dynamic>> entries, {
  String category = 'all',
  String source = 'all',
}) =>
    entries.where((entry) {
      final sourceInfo = entry['source'];
      final sourceType = sourceInfo is Map ? sourceInfo['type'] : null;
      return (category == 'all' || entry['category'] == category) &&
          (source == 'all' || sourceType == source);
    }).toList(growable: false);
