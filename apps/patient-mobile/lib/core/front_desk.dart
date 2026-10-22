import 'dart:math';
import 'api.dart';

typedef DeskGet = Future<dynamic> Function(String path, {Map<String, dynamic>? query});
typedef DeskPost = Future<dynamic> Function(String path, Map<String, dynamic> body, {String? idempotencyKey});

const frontDeskStatuses = <String>{
  'preregistered', 'awaiting_review', 'waiting', 'called', 'in_consultation', 'completed', 'cancelled',
};
String frontDeskStatusLabel(String status) => switch (status) {
  'preregistered' => 'Umesajili ziara — hujathibitisha kufika',
  'awaiting_review' => 'Inasubiri ukaguzi wa kituo',
  'waiting' => 'Unasubiri daktari',
  'called' => 'Daktari amekuita',
  'in_consultation' => 'Consultation imeanza',
  'completed' => 'Consultation imekamilika',
  'cancelled' => 'Ziara imeghairiwa',
  _ => 'Hali haijathibitishwa',
};
String frontDeskCheckLabel(String status) => switch (status) {
  'pending' => 'Inasubiri', 'manually_verified' => 'Kituo kimethibitisha kwa ukaguzi wa kawaida',
  'not_required' => 'Haihitajiki kwa ziara hii', 'cleared' => 'Clinician ameruhusu foleni ya kawaida',
  'escalated' => 'Unahitaji ukaguzi wa clinician sasa', _ => 'Inahitaji ukaguzi',
};
Map<String, dynamic> deskRecord(dynamic value) {
  if (value is! Map) throw const FormatException('Jibu la huduma halina muundo unaotarajiwa.');
  return Map<String, dynamic>.from(value);
}
List<Map<String, dynamic>> deskRows(dynamic value) {
  final record = deskRecord(value);
  if (record['data'] is! List) throw const FormatException('Orodha haikuthibitishwa.');
  return (record['data'] as List).map(deskRecord).toList();
}
class FrontDeskVisit {
  FrontDeskVisit.fromJson(dynamic value) : data = deskRecord(value) {
    if (data['id'] is! String || data['ticket'] is! String || data['version'] is! int ||
        !frontDeskStatuses.contains(data['status']) || data['facility'] is! Map ||
        data['department'] is! Map || data['clearance'] is! Map) {
      throw const FormatException('Taarifa ya ziara haikuthibitishwa.');
    }
  }
  final Map<String, dynamic> data;
  String get id => data['id'] as String;
  String get status => data['status'] as String;
  int get version => data['version'] as int;
  String get ticket => data['ticket'] as String;
  String? get consultationId => data['consultation_id'] as String?;
  bool get canCancel => {'preregistered','awaiting_review','waiting','called'}.contains(status);
}

/// Idempotency identifiers are generated once per frozen request, not per retry.
String newFrontDeskRequestKey() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0,8)}-${hex.substring(8,12)}-${hex.substring(12,16)}-${hex.substring(16,20)}-${hex.substring(20)}';
}

class FrontDeskRepository {
  FrontDeskRepository({DeskGet? get, DeskPost? post, Future<bool> Function()? online})
      : _get = get ?? Api.get, _post = post ?? Api.post, _online = online ?? (() => Api.online);
  final DeskGet _get;
  final DeskPost _post;
  final Future<bool> Function() _online;
  Future<void> _requireOnline() async {
    if (!await _online()) throw ApiException(0, 'ONLINE_REQUIRED', 'Internet inahitajika. Ombi halijawekwa kwenye foleni ya offline.');
  }
  Future<List<Map<String, dynamic>>> facilities() async => deskRows(await _get('/front-desk/facilities', query: {'limit': 100}));
  Future<List<Map<String, dynamic>>> departments(String facilityId) async => deskRows(await _get('/front-desk/facilities/$facilityId/departments'));
  Future<Map<String, dynamic>> suggest(String facilityId, String text) async {
    await _requireOnline();
    return deskRecord(await _post('/front-desk/facilities/$facilityId/navigation', {'text': text}));
  }
  Future<Map<String, dynamic>> board(String facilityId, String departmentId) async => deskRecord(
    await _get('/front-desk/facilities/$facilityId/departments/$departmentId/queue'));
  Future<List<FrontDeskVisit>> visits() async => deskRows(await _get('/front-desk/visits', query: {'limit': 50})).map(FrontDeskVisit.fromJson).toList();
  Future<FrontDeskVisit> visit(String id) async => FrontDeskVisit.fromJson(await _get('/front-desk/visits/$id'));
  Future<FrontDeskVisit> register(Map<String, dynamic> frozenRequest) async {
    await _requireOnline();
    return FrontDeskVisit.fromJson(await _post('/front-desk/visits', frozenRequest));
  }
  Future<FrontDeskVisit> action(FrontDeskVisit visit, String action) async {
    if (!{'check-in','cancel'}.contains(action)) throw ArgumentError('Patient action not allowed');
    await _requireOnline();
    return FrontDeskVisit.fromJson(await _post('/front-desk/visits/${visit.id}/$action', {'base_version': visit.version}));
  }
  Future<Map<String, dynamic>> consultation(String id) async => deskRecord(await _get('/consultations/$id'));
}
