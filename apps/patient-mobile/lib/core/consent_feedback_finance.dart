import 'dart:math';

import 'api.dart';

typedef PatientGet = Future<dynamic> Function(
  String path, {
  Map<String, dynamic>? query,
});

typedef PatientPost = Future<dynamic> Function(
  String path,
  Map<String, dynamic> body, {
  String? idempotencyKey,
});

Map<String, dynamic> _asMap(Object? value, String label) {
  if (value is! Map) throw FormatException('$label response is not an object');
  return Map<String, dynamic>.from(value);
}

String _requiredString(Map<String, dynamic> value, String key, String label) {
  final item = value[key];
  if (item is! String || item.isEmpty) {
    throw FormatException('$label is missing $key');
  }
  return item;
}

List<Map<String, dynamic>> _pageRows(Object? value, String label) {
  final page = _asMap(value, label);
  final data = page['data'];
  if (data is! List) throw FormatException('$label response has no data list');
  return data.map((row) => _asMap(row, label)).toList();
}

String consentStatus(Map<String, dynamic> consent, {DateTime? now}) {
  if (consent['revoked_at'] != null || consent['allowed'] == false) {
    return 'revoked';
  }
  final expiresAt = DateTime.tryParse(consent['expires_at'] as String? ?? '');
  if (expiresAt != null && !expiresAt.isAfter(now ?? DateTime.now())) {
    return 'expired';
  }
  return 'active';
}

List<Map<String, dynamic>> consentsFromJson(Object? value) =>
    _pageRows(value, 'consent').map((row) {
      _requiredString(row, 'id', 'consent');
      _requiredString(row, 'scope', 'consent');
      _requiredString(row, 'grantee_type', 'consent');
      _requiredString(row, 'granted_at', 'consent');
      return {...row, 'status': consentStatus(row)};
    }).toList();

List<Map<String, dynamic>> consentAuditHistoryFromJson(Object? value) =>
    _pageRows(value, 'consent audit history').map((row) {
      final eventType = _requiredString(row, 'event_type', 'consent audit history');
      const supported = {
        'consent.granted',
        'consent.revoked',
        'emergency.context_break_glass_access',
      };
      if (!supported.contains(eventType)) {
        throw const FormatException('Consent audit history contains an unsupported event');
      }
      final occurredAt = _requiredString(row, 'occurred_at', 'consent audit history');
      return {
        'event_type': eventType,
        'occurred_at': occurredAt,
        if (row['scope'] is String) 'scope': row['scope'] as String,
        if (row['grantee_type'] is String)
          'grantee_type': row['grantee_type'] as String,
      };
    }).toList();

Map<String, dynamic> coverageFromJson(Object? value) {
  final result = _asMap(value, 'coverage');
  _requiredString(result, 'patient_profile_id', 'coverage');
  final schemes = result['schemes'];
  if (schemes is! List) {
    throw const FormatException('coverage has no schemes list');
  }
  return {
    ...result,
    'schemes': schemes.map((value) {
      final row = _asMap(value, 'coverage scheme');
      _requiredString(row, 'scheme_id', 'coverage scheme');
      _requiredString(row, 'scheme_name', 'coverage scheme');
      _requiredString(row, 'status', 'coverage scheme');
      return row;
    }).toList(),
  };
}

List<Map<String, dynamic>> claimsFromJson(Object? value) =>
    _pageRows(value, 'insurance claim').map((row) {
      _requiredString(row, 'id', 'insurance claim');
      _requiredString(row, 'status', 'insurance claim');
      _requiredString(row, 'consultation_id', 'insurance claim');
      _requiredString(row, 'submitted_at', 'insurance claim');
      return row;
    }).toList();

Map<String, dynamic> ratingFromJson(Object? value) {
  final row = _asMap(value, 'rating');
  _requiredString(row, 'id', 'rating');
  _requiredString(row, 'consultation_id', 'rating');
  if (row['score'] is! num) {
    throw const FormatException('rating has no score');
  }
  return row;
}

Map<String, dynamic> incidentFromJson(Object? value) {
  final row = _asMap(value, 'incident report');
  _requiredString(row, 'id', 'incident report');
  _requiredString(row, 'status', 'incident report');
  _requiredString(row, 'category', 'incident report');
  _requiredString(row, 'reported_at', 'incident report');
  return row;
}

List<Map<String, dynamic>> paymentsFromJson(Object? value) =>
    _pageRows(value, 'payment').map((row) {
      _requiredString(row, 'id', 'payment');
      _requiredString(row, 'status', 'payment');
      _requiredString(row, 'currency', 'payment');
      if (row['amount'] is! num) {
        throw const FormatException('payment has no amount');
      }
      return row;
    }).toList();

Map<String, dynamic> paymentIntentFromJson(Object? value) {
  final row = _asMap(value, 'payment intent');
  _requiredString(row, 'id', 'payment intent');
  _requiredString(row, 'status', 'payment intent');
  _requiredString(row, 'currency', 'payment intent');
  if (row['amount'] is! num) {
    throw const FormatException('payment intent has no amount');
  }
  return row;
}

class ConsentFeedbackFinanceRepository {
  ConsentFeedbackFinanceRepository({PatientGet? get, PatientPost? post})
      : _get = get ?? Api.get,
        _post = post ?? Api.post;

  final PatientGet _get;
  final PatientPost _post;

  static final Random _idempotencyRandom = Random.secure();

  static String _idempotencyKey(String operation) {
    final suffix =
        List<int>.generate(16, (_) => _idempotencyRandom.nextInt(256))
            .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
            .join();
    return 'ahp-cff-$operation-$suffix';
  }

  Future<List<Map<String, dynamic>>> consents(String profileId) async =>
      consentsFromJson(await _get('/patient-profiles/$profileId/consents'));

  Future<List<Map<String, dynamic>>> consentAuditHistory(String profileId) async =>
      consentAuditHistoryFromJson(
        await _get('/patient-profiles/$profileId/audit-history'),
      );

  Future<Map<String, dynamic>> grantConsent(
    String profileId,
    Map<String, dynamic> input,
  ) async {
    final created = _asMap(
      await _post(
        '/patient-profiles/$profileId/consents',
        input,
        idempotencyKey: _idempotencyKey('consent-grant'),
      ),
      'granted consent',
    );
    final id = _requiredString(created, 'id', 'granted consent');
    final persisted = await consents(profileId);
    return persisted.firstWhere(
      (row) => row['id'] == id,
      orElse: () => throw const FormatException(
        'Granted consent was not present in the persisted list',
      ),
    );
  }

  Future<Map<String, dynamic>> revokeConsent(
    String profileId,
    String consentId,
  ) async {
    await _post(
      '/patient-profiles/$profileId/consents/$consentId/revoke',
      {},
      idempotencyKey: _idempotencyKey('consent-revoke'),
    );
    final persisted = await consents(profileId);
    Map<String, dynamic>? row;
    for (final item in persisted) {
      if (item['id'] == consentId) {
        row = item;
        break;
      }
    }
    if (row == null || row['status'] != 'revoked') {
      throw const FormatException(
        'Revoked consent was not confirmed by the service',
      );
    }
    return row;
  }

  Future<Map<String, dynamic>> rateConsultation(
    String consultationId, {
    required int score,
    String? comment,
  }) async =>
      ratingFromJson(
        await _post(
          '/consultations/$consultationId/rating',
          {
            'score': score,
            if (comment != null && comment.trim().isNotEmpty)
              'comment': comment.trim(),
          },
          idempotencyKey: _idempotencyKey('consultation-rating'),
        ),
      );

  Future<Map<String, dynamic>> createIncident(
    Map<String, dynamic> input,
  ) async =>
      incidentFromJson(await _post(
        '/incident-reports',
        input,
        idempotencyKey: _idempotencyKey('incident-report'),
      ));

  Future<Map<String, dynamic>> coverage() async =>
      coverageFromJson(await _get('/insurance/coverage'));

  Future<List<Map<String, dynamic>>> claims() async =>
      claimsFromJson(await _get('/insurance/claims'));

  Future<List<Map<String, dynamic>>> payments() async =>
      paymentsFromJson(await _get('/payments'));
}
