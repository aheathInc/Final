import 'dart:math';

import 'api.dart';

typedef AiPost = Future<dynamic> Function(
  String path,
  Map<String, dynamic> body, {
  String? idempotencyKey,
});

enum PatientNavigationAction {
  openDoctors,
  startConsultation,
  openAppointments,
  openDiagnostics,
  openMedications,
  openPharmacy,
  openFamily,
  openEducation,
  openPrevention,
  openEmergency,
  openPrivacy,
  openFeedback,
  openInsurancePayments,
}

PatientNavigationAction? patientNavigationActionFromCode(String? code) {
  switch (code) {
    case 'OPEN_DOCTORS':
      return PatientNavigationAction.openDoctors;
    case 'START_CONSULTATION':
      return PatientNavigationAction.startConsultation;
    case 'OPEN_APPOINTMENTS':
      return PatientNavigationAction.openAppointments;
    case 'OPEN_DIAGNOSTICS':
      return PatientNavigationAction.openDiagnostics;
    case 'OPEN_MEDICATIONS':
      return PatientNavigationAction.openMedications;
    case 'OPEN_PHARMACY':
      return PatientNavigationAction.openPharmacy;
    case 'OPEN_FAMILY':
      return PatientNavigationAction.openFamily;
    case 'OPEN_EDUCATION':
      return PatientNavigationAction.openEducation;
    case 'OPEN_PREVENTION':
      return PatientNavigationAction.openPrevention;
    case 'OPEN_EMERGENCY':
      return PatientNavigationAction.openEmergency;
    case 'OPEN_PRIVACY':
      return PatientNavigationAction.openPrivacy;
    case 'OPEN_FEEDBACK':
      return PatientNavigationAction.openFeedback;
    case 'OPEN_INSURANCE_PAYMENTS':
      return PatientNavigationAction.openInsurancePayments;
    default:
      return null;
  }
}

class PatientAiReply {
  const PatientAiReply({
    required this.body,
    required this.escalated,
    required this.action,
    required this.unsupportedAction,
  });

  final String body;
  final bool escalated;
  final PatientNavigationAction? action;
  final bool unsupportedAction;

  factory PatientAiReply.fromJson(Object? value) {
    if (value is! Map) {
      throw const FormatException('AI reply is not an object');
    }
    final row = Map<String, dynamic>.from(value);
    final body = row['body'];
    if (row['role'] != 'assistant' || body is! String || body.trim().isEmpty) {
      throw const FormatException('AI reply has no assistant message');
    }

    final rawAction = row['navigation_action'];
    final parsedAction = patientNavigationActionFromCode(
      rawAction is String ? rawAction : null,
    );
    final escalated = row['escalated'] == true;
    return PatientAiReply(
      body: body,
      escalated: escalated,
      action: escalated ? PatientNavigationAction.openEmergency : parsedAction,
      unsupportedAction:
          !escalated && rawAction != null && parsedAction == null,
    );
  }
}

abstract interface class PatientAiClient {
  Future<String> openConversation({required String idempotencyKey});

  Future<PatientAiReply> sendMessage({
    required String conversationId,
    required String body,
    required String idempotencyKey,
  });
}

class PatientAiRepository implements PatientAiClient {
  PatientAiRepository({AiPost? post}) : _post = post ?? Api.post;

  final AiPost _post;
  static final Random _random = Random.secure();

  static String newIdempotencyKey(String operation) {
    final suffix = List<int>.generate(
      16,
      (_) => _random.nextInt(256),
    ).map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
    return 'ahp-ai-$operation-$suffix';
  }

  @override
  Future<String> openConversation({required String idempotencyKey}) async {
    final response = await _post('/ai/conversations', {
      'audience': 'patient',
      'language': 'sw',
      'channel': 'app',
    }, idempotencyKey: idempotencyKey);
    if (response is! Map || response['id'] is! String) {
      throw const FormatException('AI conversation response is invalid');
    }
    final id = response['id'] as String;
    if (!_isUuid(id)) {
      throw const FormatException('AI conversation identifier is invalid');
    }
    return id;
  }

  @override
  Future<PatientAiReply> sendMessage({
    required String conversationId,
    required String body,
    required String idempotencyKey,
  }) async {
    final message = body.trim();
    if (!_isUuid(conversationId) || message.isEmpty || message.length > 4000) {
      throw const FormatException('AI message is invalid');
    }
    final response = await _post('/ai/conversations/$conversationId/messages', {
      'body': message,
    }, idempotencyKey: idempotencyKey);
    return PatientAiReply.fromJson(response);
  }

  static bool _isUuid(String value) => RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
  ).hasMatch(value);
}
