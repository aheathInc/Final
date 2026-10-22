Map<String, dynamic> _record(dynamic value, String message) {
  if (value is! Map) throw FormatException(message);
  return Map<String, dynamic>.from(value);
}

List<Map<String, dynamic>> _records(dynamic value) {
  final data = value is Map ? value['data'] : null;
  if (data is! List) return const [];
  return data.whereType<Map>().map(Map<String, dynamic>.from).toList();
}

Map<String, dynamic> familyFromJson(dynamic value) {
  final family = _record(value, 'Family response is invalid.');
  if (family['id'] is! String || family['members'] is! List) {
    throw const FormatException('Family response is incomplete.');
  }
  return {
    ...family,
    'members': (family['members'] as List)
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList(),
  };
}

Map<String, dynamic> dependantFromJson(dynamic value) {
  final dependant = _record(value, 'Family member is invalid.');
  final profileId = dependant['patient_profile_id'] ?? dependant['id'];
  if (profileId is! String || dependant['full_name'] is! String) {
    throw const FormatException('Family member details are incomplete.');
  }
  return {
    ...dependant,
    'patient_profile_id': profileId,
    'relationship': dependant['relationship'] is String
        ? dependant['relationship']
        : 'dependant',
  };
}

List<Map<String, dynamic>> dependantsFromJson(dynamic value) =>
    _records(value).map(dependantFromJson).toList();

List<Map<String, dynamic>> educationArticlesFromJson(dynamic value) =>
    _records(value)
        .where(
          (article) =>
              article['slug'] is String &&
              article['title'] is String &&
              article['summary'] is String,
        )
        .toList();

Map<String, dynamic> educationArticleFromJson(dynamic value) {
  final article = _record(value, 'Education article is invalid.');
  if (article['slug'] is! String || article['title'] is! String) {
    throw const FormatException('Education article is incomplete.');
  }
  return article;
}

List<Map<String, dynamic>> educationTopicsFromJson(dynamic value) =>
    _records(value).where((topic) => topic['slug'] is String).toList();

List<Map<String, dynamic>> screeningInvitationsFromJson(dynamic value) =>
    _records(value)
        .where(
          (invitation) =>
              invitation['id'] is String && invitation['status'] is String,
        )
        .toList();

List<Map<String, dynamic>> vaccinationRecordsFromJson(dynamic value) =>
    _records(value)
        .where((record) => record['id'] is String && record['status'] is String)
        .toList();

List<Map<String, dynamic>> riskScoresFromJson(dynamic value) => _records(value)
    .where(
      (score) =>
          score['condition_code'] is String &&
          score['score'] is num &&
          score['band'] is String,
    )
    .toList();

Map<String, dynamic> emergencyRequestFromJson(dynamic value) {
  final request = _record(value, 'Emergency response is invalid.');
  if (request['id'] is! String || request['status'] is! String) {
    throw const FormatException('Emergency response is incomplete.');
  }
  return request;
}

Map<String, dynamic> emergencyRequestBody({
  required String category,
  required double latitude,
  required double longitude,
}) =>
    {
      'scale': 'individual',
      'category': category,
      'source': 'patient_app',
      'location': {'lat': latitude, 'lng': longitude},
    };

bool isValidEmergencyCoordinates(double? latitude, double? longitude) =>
    latitude != null &&
    longitude != null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude == 0 && longitude == 0);
