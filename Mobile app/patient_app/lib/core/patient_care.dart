import 'api.dart';

typedef PatientGet = Future<dynamic> Function(
  String path, {
  Map<String, dynamic>? query,
});

typedef PatientDurablePost = Future<dynamic> Function({
  required String opId,
  required String path,
  required String syncPath,
  Map<String, String>? pathParams,
  required Map<String, dynamic> body,
});

class ConsultationRecord {
  const ConsultationRecord(this.data);

  final Map<String, dynamic> data;

  factory ConsultationRecord.fromJson(dynamic value) {
    if (value is! Map) throw const FormatException('Consultation response is invalid.');
    final data = Map<String, dynamic>.from(value);
    if (data['id'] is! String || data['care_thread_id'] is! String) {
      throw const FormatException('Consultation response is missing its identifiers.');
    }
    return ConsultationRecord(data);
  }

  String get id => data['id'] as String;
  String get careThreadId => data['care_thread_id'] as String;
  String? get patientProfileId => data['patient_profile_id'] as String?;
  String get status => data['status'] as String? ?? 'pending';
  String? get symptomText => data['symptom_text'] as String?;
  bool get isTerminal => status == 'completed' || status == 'cancelled';

  ConsultationRecord withStatus(Map<String, dynamic> statusData) =>
      ConsultationRecord({...data, ...statusData});
}

String consultationStatusLabel(String status) {
  switch (status) {
    case 'pending': return 'Ombi limepokelewa; linasubiri kupangiwa daktari';
    case 'offered': return 'Ombi linapelekwa kwa madaktari';
    case 'matched': return 'Daktari amekubali ombi';
    case 'in_progress': return 'Mazungumzo ya matibabu yanaendelea';
    case 'escalated': return 'Ombi limepelekwa kwa hatua ya juu';
    case 'completed': return 'Ushauri umekamilika';
    case 'cancelled': return 'Ombi limeghairiwa';
    default: return 'Hali ya ombi: $status';
  }
}

({List<Map<String, dynamic>> active, List<Map<String, dynamic>> recent})
    partitionConsultations(List<Map<String, dynamic>> consultations) => (
      active: consultations.where((c) =>
          c['status'] != 'completed' && c['status'] != 'cancelled').toList(),
      recent: consultations.where((c) =>
          c['status'] == 'completed' || c['status'] == 'cancelled').toList(),
    );

Map<String, dynamic> profileClinicalUpdateBody({
  required int profileVersion,
  required List<String> allergies,
  required List<String> chronicConditions,
  required String? emergencyContact,
}) => {
  'base_version': profileVersion,
  'allergies': allergies,
  'chronic_conditions': chronicConditions,
  'emergency_contact': emergencyContact,
};

class PatientCareRepository {
  PatientCareRepository({PatientGet? get, PatientDurablePost? durablePost})
      : _get = get ?? Api.get,
        _durablePost = durablePost ?? Api.postDurable;

  final PatientGet _get;
  final PatientDurablePost _durablePost;

  Future<ConsultationRecord> createConsultation({
    required String opId,
    required Map<String, dynamic> body,
  }) async {
    final response = await _durablePost(
      opId: opId,
      path: '/consultations',
      syncPath: '/consultations',
      body: body,
    );
    return ConsultationRecord.fromJson(response);
  }

  Future<Map<String, dynamic>> queueStatus(String consultationId) async {
    final response = await _get('/consultations/$consultationId/queue-status');
    if (response is! Map) throw const FormatException('Queue status response is invalid.');
    return Map<String, dynamic>.from(response);
  }

  Future<Map<String, dynamic>> signedNote(String consultationId) async {
    final response = await _get('/consultations/$consultationId/note');
    if (response is! Map) throw const FormatException('Consultation note response is invalid.');
    return Map<String, dynamic>.from(response);
  }

  Future<List<Map<String, dynamic>>> prescriptions(String patientProfileId) async {
    final response = await _get('/patient-profiles/$patientProfileId/prescriptions',
        query: {'limit': 50});
    final data = response is Map ? response['data'] : null;
    if (data is! List) return const [];
    return data.whereType<Map>().map(Map<String, dynamic>.from).toList();
  }

  Future<List<Map<String, dynamic>>> adherenceLogs(String patientProfileId) async {
    final response = await _get('/adherence-logs', query: {
      'patient_profile_id': patientProfileId,
      'limit': 100,
    });
    final data = response is Map ? response['data'] : null;
    if (data is! List) return const [];
    return data.whereType<Map>().map(Map<String, dynamic>.from).toList();
  }

  Future<Map<String, dynamic>> careThread(String careThreadId) async {
    final response = await _get('/care-threads/$careThreadId');
    if (response is! Map) throw const FormatException('Care thread response is invalid.');
    return Map<String, dynamic>.from(response);
  }

  Future<List<Map<String, dynamic>>> getFollowUpCheckIns(String cycleId) async {
    final response = await _get('/follow-up-cycles/$cycleId/check-ins',
        query: {'limit': 50});
    final data = response is Map ? response['data'] : null;
    if (data is! List) return const [];
    return data.whereType<Map>().map(Map<String, dynamic>.from).toList();
  }

  Future<List<Map<String, dynamic>>> threadMessages(String careThreadId) async {
    final response = await _get('/care-threads/$careThreadId/messages',
        query: {'limit': 100});
    final data = response is Map ? response['data'] : null;
    if (data is! List) return const [];
    return data.whereType<Map>().map(Map<String, dynamic>.from).toList();
  }

  Future<dynamic> sendMessage({
    required String opId,
    required String careThreadId,
    required String body,
    required String clientCreatedAt,
  }) => _durablePost(
        opId: opId,
        path: '/care-threads/$careThreadId/messages',
        syncPath: '/care-threads/{care_thread_id}/messages',
        pathParams: {'care_thread_id': careThreadId},
        body: {'body': body, 'client_created_at': clientCreatedAt},
      );
}
