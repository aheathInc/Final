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
    if (value is! Map)
      throw const FormatException('Consultation response is invalid.');
    final data = Map<String, dynamic>.from(value);
    if (data['id'] is! String || data['care_thread_id'] is! String) {
      throw const FormatException(
        'Consultation response is missing its identifiers.',
      );
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
    case 'pending':
      return 'Ombi limepokelewa; linasubiri kupangiwa daktari';
    case 'offered':
      return 'Ombi linapelekwa kwa madaktari';
    case 'matched':
      return 'Daktari amekubali ombi';
    case 'in_progress':
      return 'Mazungumzo ya matibabu yanaendelea';
    case 'escalated':
      return 'Ombi limepelekwa kwa hatua ya juu';
    case 'completed':
      return 'Ushauri umekamilika';
    case 'cancelled':
      return 'Ombi limeghairiwa';
    default:
      return 'Hali ya ombi: $status';
  }
}

List<Map<String, dynamic>> patientCareRows(dynamic response) {
  final data = response is Map ? response['data'] : null;
  if (data is! List) return const [];
  return data.whereType<Map>().map(Map<String, dynamic>.from).toList();
}

Map<String, dynamic> patientCareRecord(dynamic response, String error) {
  if (response is! Map) throw FormatException(error);
  return Map<String, dynamic>.from(response);
}

bool isAppointmentBookable(Map<String, dynamic> appointment) =>
    appointment['status'] == 'booked';
bool hasDiagnosticResult(Map<String, dynamic> order) =>
    order['resulted_at'] != null ||
    order['status'] == 'resulted' ||
    order['status'] == 'acknowledged';
bool adherenceMatchesPrescription(
  Map<String, dynamic> log,
  Map<String, dynamic> prescription,
) =>
    log['prescription_id'] == prescription['id'];

Map<String, Object?> adherenceCacheRow(Map<String, dynamic> log) => {
      'id': log['id'],
      'prescription_id': log['prescription_id'],
      'medication_name': log['medication_name'] ?? '',
      'dosage': log['dosage'] ?? '',
      'scheduled_at': log['scheduled_at'] ?? '',
      'reported_status': log['reported_status'] ?? 'unreported',
      'synced': 1,
    };

({
  List<Map<String, dynamic>> active,
  List<Map<String, dynamic>> recent
}) partitionConsultations(List<Map<String, dynamic>> consultations) => (
      active: consultations
          .where(
              (c) => c['status'] != 'completed' && c['status'] != 'cancelled')
          .toList(),
      recent: consultations
          .where(
              (c) => c['status'] == 'completed' || c['status'] == 'cancelled')
          .toList(),
    );

Map<String, dynamic> profileClinicalUpdateBody({
  required int profileVersion,
  required List<String> allergies,
  required List<String> chronicConditions,
  required String? emergencyContact,
}) =>
    {
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
    if (response is! Map)
      throw const FormatException('Queue status response is invalid.');
    return Map<String, dynamic>.from(response);
  }

  Future<Map<String, dynamic>> signedNote(String consultationId) async {
    final response = await _get('/consultations/$consultationId/note');
    if (response is! Map)
      throw const FormatException('Consultation note response is invalid.');
    return Map<String, dynamic>.from(response);
  }

  Future<List<Map<String, dynamic>>> prescriptions(
    String patientProfileId,
  ) async {
    final response = await _get(
      '/patient-profiles/$patientProfileId/prescriptions',
      query: {'limit': 50},
    );
    return patientCareRows(response);
  }

  Future<List<Map<String, dynamic>>> appointments() async {
    final response = await _get('/appointments', query: {'limit': 50});
    return patientCareRows(response);
  }

  Future<Map<String, dynamic>> clinicians({String? facilityId}) async {
    final response = await _get(
      '/clinicians',
      query: {
        'limit': 50,
        'verification_status': 'verified',
        if (facilityId != null) 'facility_id': facilityId,
      },
    );
    return patientCareRecord(response, 'Clinician response is invalid.');
  }

  Future<List<Map<String, dynamic>>> slots(
    String clinicianId,
    DateTime from,
    DateTime to,
  ) async {
    final response = await _get(
      '/clinicians/$clinicianId/slots',
      query: {'from': _date(from), 'to': _date(to)},
    );
    return patientCareRows(response);
  }

  Future<Map<String, dynamic>> bookAppointment({
    required String opId,
    required String slotId,
    String? reason,
  }) async {
    final response = await _durablePost(
      opId: opId,
      path: '/appointments',
      syncPath: '/appointments',
      body: {
        'slot_id': slotId,
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      },
    );
    return patientCareRecord(response, 'Appointment response is invalid.');
  }

  Future<Map<String, dynamic>> cancelAppointment(
    String id, {
    required String opId,
    String? reason,
  }) async {
    final response = await _durablePost(
      opId: opId,
      path: '/appointments/$id/cancel',
      syncPath: '/appointments/{appointment_id}/cancel',
      pathParams: {'appointment_id': id},
      body: {if (reason != null) 'reason': reason},
    );
    return patientCareRecord(response, 'Appointment response is invalid.');
  }

  Future<List<Map<String, dynamic>>> investigationOrders() async {
    final response = await _get('/investigation-orders', query: {'limit': 50});
    return patientCareRows(response);
  }

  Future<Map<String, dynamic>> investigationOrder(String id) async {
    final response = await _get('/investigation-orders/$id');
    return patientCareRecord(response, 'Investigation response is invalid.');
  }

  Future<List<Map<String, dynamic>>> medicationAvailability({
    required String name,
    required double latitude,
    required double longitude,
    double radiusKm = 15,
  }) async {
    final response = await _get(
      '/pharmacies/medication-search',
      query: {
        'medication_name': name,
        'lat': latitude,
        'lng': longitude,
        'radius_km': radiusKm,
      },
    );
    return patientCareRows(response);
  }

  static String _date(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

  Future<List<Map<String, dynamic>>> adherenceLogs(
    String patientProfileId,
  ) async {
    final response = await _get(
      '/adherence-logs',
      query: {'patient_profile_id': patientProfileId, 'limit': 100},
    );
    return patientCareRows(response);
  }

  Future<Map<String, dynamic>> appointment(String id) async {
    final response = await _get('/appointments/$id');
    return patientCareRecord(response, 'Appointment response is invalid.');
  }

  Future<Map<String, dynamic>> confirmDose({
    required String opId,
    required String adherenceLogId,
    required String reportedStatus,
  }) async {
    final response = await _durablePost(
      opId: opId,
      path: '/adherence-logs/$adherenceLogId/confirm',
      syncPath: '/adherence-logs/{adherence_log_id}/confirm',
      pathParams: {'adherence_log_id': adherenceLogId},
      body: {'reported_status': reportedStatus, 'channel': 'app'},
    );
    return patientCareRecord(response, 'Adherence response is invalid.');
  }

  Future<Map<String, dynamic>> careThread(String careThreadId) async {
    final response = await _get('/care-threads/$careThreadId');
    if (response is! Map)
      throw const FormatException('Care thread response is invalid.');
    return Map<String, dynamic>.from(response);
  }

  Future<List<Map<String, dynamic>>> getFollowUpCheckIns(String cycleId) async {
    final response = await _get(
      '/follow-up-cycles/$cycleId/check-ins',
      query: {'limit': 50},
    );
    return patientCareRows(response);
  }

  Future<List<Map<String, dynamic>>> threadMessages(String careThreadId) async {
    final response = await _get(
      '/care-threads/$careThreadId/messages',
      query: {'limit': 100},
    );
    final data = response is Map ? response['data'] : null;
    if (data is! List) return const [];
    return data.whereType<Map>().map(Map<String, dynamic>.from).toList();
  }

  Future<dynamic> sendMessage({
    required String opId,
    required String careThreadId,
    required String body,
    required String clientCreatedAt,
  }) =>
      _durablePost(
        opId: opId,
        path: '/care-threads/$careThreadId/messages',
        syncPath: '/care-threads/{care_thread_id}/messages',
        pathParams: {'care_thread_id': careThreadId},
        body: {'body': body, 'client_created_at': clientCreatedAt},
      );
}
