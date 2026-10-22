import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/consent_feedback_finance.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('consent parsing and persistence', () {
    test('shows supported grant fields and revoked state after refresh', () {
      final rows = consentsFromJson({
        'data': [
          {
            'id': 'consent-1',
            'grantee_type': 'clinician',
            'grantee_clinician_id': 'clinician-1',
            'scope': 'current_thread',
            'reason': 'Synthetic purpose',
            'allowed': false,
            'granted_at': '2026-10-01T10:00:00Z',
            'expires_at': null,
            'revoked_at': '2026-10-01T11:00:00Z',
          },
        ],
      });
      expect(rows.single['scope'], 'current_thread');
      expect(rows.single['reason'], 'Synthetic purpose');
      expect(rows.single['status'], 'revoked');
      expect(
        consentStatus({
          'allowed': true,
          'granted_at': '2026-10-01T10:00:00Z',
          'expires_at': '2026-10-02T10:00:00Z',
        }, now: DateTime.utc(2026, 10, 1)),
        'active',
      );
      expect(
        consentStatus({
          'allowed': true,
          'expires_at': '2026-10-01T10:00:00Z',
        }, now: DateTime.utc(2026, 10, 2)),
        'expired',
      );
    });

    test('parses only patient-safe consent and emergency history fields', () {
      final history = consentAuditHistoryFromJson({
        'data': [
          {
            'event_type': 'consent.granted',
            'occurred_at': '2026-10-01T10:00:00Z',
            'scope': 'current_thread',
            'grantee_type': 'clinician',
            'actor_id': 'must-not-be-exposed',
            'hash': 'must-not-be-exposed',
          },
          {
            'event_type': 'emergency.context_break_glass_access',
            'occurred_at': '2026-10-01T11:00:00Z',
          },
        ],
      });

      expect(history.first['scope'], 'current_thread');
      expect(history.first.containsKey('actor_id'), isFalse);
      expect(history.first.containsKey('hash'), isFalse);
      expect(history.last['event_type'], 'emergency.context_break_glass_access');
      expect(
        () => consentAuditHistoryFromJson({
          'data': [
            {'event_type': 'account.password.changed', 'occurred_at': '2026-10-01T10:00:00Z'},
          ],
        }),
        throwsFormatException,
      );
    });

    test('grant and revoke require same-record backend read-back', () async {
      final store = <Map<String, dynamic>>[];
      final paths = <String>[];
      final idempotencyKeys = <String?>[];
      final repository = ConsentFeedbackFinanceRepository(
        get: (path, {query}) async {
          paths.add(path);
          return {
            'data': store.map((row) => Map<String, dynamic>.from(row)).toList(),
          };
        },
        post: (path, body, {idempotencyKey}) async {
          paths.add(path);
          idempotencyKeys.add(idempotencyKey);
          if (path.endsWith('/revoke')) {
            final id = path.split('/')[path.split('/').length - 2];
            final row = store.singleWhere((item) => item['id'] == id);
            row['allowed'] = false;
            row['revoked_at'] = '2026-10-01T12:00:00Z';
            return Map<String, dynamic>.from(row);
          }
          final row = <String, dynamic>{
            'id': 'consent-1',
            ...body,
            'allowed': true,
            'granted_at': '2026-10-01T10:00:00Z',
            'expires_at': null,
            'revoked_at': null,
          };
          store.add(row);
          return Map<String, dynamic>.from(row);
        },
      );

      final granted = await repository.grantConsent('profile-1', {
        'grantee_type': 'researcher',
        'scope': 'investigations_only',
        'reason': 'Synthetic acceptance',
      });
      expect(granted['id'], 'consent-1');
      expect(granted['status'], 'active');
      expect(paths, contains('/patient-profiles/profile-1/consents'));

      final revoked = await repository.revokeConsent('profile-1', 'consent-1');
      expect(revoked['status'], 'revoked');
      expect(
        paths,
        contains('/patient-profiles/profile-1/consents/consent-1/revoke'),
      );
      expect(idempotencyKeys, everyElement(isNotNull));
      expect(idempotencyKeys.toSet(), hasLength(2));
    });

    test('propagates authorization failures without showing success', () async {
      final repository = ConsentFeedbackFinanceRepository(
        get: (path, {query}) async =>
            throw ApiException(403, 'NOT_RESOURCE_OWNER', 'Denied'),
        post: (path, body, {idempotencyKey}) async =>
            throw ApiException(403, 'NOT_RESOURCE_OWNER', 'Denied'),
      );
      await expectLater(
        repository.consents('other-profile'),
        throwsA(
          isA<ApiException>().having((error) => error.status, 'status', 403),
        ),
      );
      await expectLater(
        repository.grantConsent('other-profile', {'scope': 'unsupported'}),
        throwsA(
          isA<ApiException>().having(
            (error) => error.code,
            'code',
            'NOT_RESOURCE_OWNER',
          ),
        ),
      );
    });
  });

  group('rating and incident feedback', () {
    test('submits supported rating and optional comment', () async {
      String? submittedPath;
      Map<String, dynamic>? submittedBody;
      String? submittedIdempotencyKey;
      final repository = ConsentFeedbackFinanceRepository(
        get: (path, {query}) async => <String, dynamic>{},
        post: (path, body, {idempotencyKey}) async {
          submittedPath = path;
          submittedBody = body;
          submittedIdempotencyKey = idempotencyKey;
          return {
            'id': 'rating-1',
            'consultation_id': 'completed-1',
            'score': 4,
            'comment': 'Synthetic feedback',
            'created_at': '2026-10-01T12:00:00Z',
          };
        },
      );
      final saved = await repository.rateConsultation(
        'completed-1',
        score: 4,
        comment: '  Synthetic feedback  ',
      );
      expect(submittedPath, '/consultations/completed-1/rating');
      expect(submittedBody, {'score': 4, 'comment': 'Synthetic feedback'});
      expect(submittedIdempotencyKey, isNotEmpty);
      expect(saved['id'], 'rating-1');
      expect(saved['score'], 4);
    });

    test(
      'surfaces duplicate-rating response from the quality service',
      () async {
        final repository = ConsentFeedbackFinanceRepository(
          get: (path, {query}) async => <String, dynamic>{},
          post: (path, body, {idempotencyKey}) async =>
              throw ApiException(409, 'ALREADY_RATED', 'Already rated'),
        );
        await expectLater(
          repository.rateConsultation('completed-1', score: 5),
          throwsA(
            isA<ApiException>().having(
              (error) => error.code,
              'code',
              'ALREADY_RATED',
            ),
          ),
        );
      },
    );

    test('persists incident reference and current backend status', () async {
      String? submittedIdempotencyKey;
      final repository = ConsentFeedbackFinanceRepository(
        get: (path, {query}) async => <String, dynamic>{},
        post: (path, body, {idempotencyKey}) async {
          expect(path, '/incident-reports');
          expect(body['category'], 'data_privacy');
          submittedIdempotencyKey = idempotencyKey;
          return {
            'id': 'incident-1',
            'category': 'data_privacy',
            'status': 'reported',
            'description': 'Synthetic report',
            'reported_at': '2026-10-01T12:00:00Z',
          };
        },
      );
      final report = await repository.createIncident({
        'category': 'data_privacy',
        'description': 'Synthetic report',
      });
      expect(report['id'], 'incident-1');
      expect(report['status'], 'reported');
      expect(submittedIdempotencyKey, isNotEmpty);
    });
  });

  group('insurance and payment parsing', () {
    test('reads coverage and staff-submitted claim statuses', () {
      expect(
        coverageFromJson({
          'patient_profile_id': 'profile-1',
          'schemes': [
            {
              'scheme_id': 'scheme-1',
              'scheme_name': 'Synthetic scheme',
              'membership_number': 'MEMBER-TEST',
              'status': 'active',
              'accepted_at_facility': null,
              'covered_services': ['consultation'],
              'valid_until': null,
            },
          ],
        })['schemes'],
        hasLength(1),
      );
      final claims = claimsFromJson({
        'data': [
          {
            'id': 'claim-1',
            'consultation_id': 'consultation-1',
            'status': 'submitted',
            'submitted_at': '2026-10-01T12:00:00Z',
          },
        ],
      });
      expect(claims.single['status'], 'submitted');
    });

    test(
        'reads payment history and parses intent status without claiming settlement',
        () {
      expect(
        paymentsFromJson({
          'data': [
            {
              'id': 'payment-1',
              'amount': 1250,
              'currency': 'TZS',
              'status': 'succeeded',
            },
          ],
        }).single['amount'],
        1250,
      );
      expect(
        paymentIntentFromJson({
          'id': 'intent-1',
          'amount': 1250,
          'currency': 'TZS',
          'status': 'processing',
        })['status'],
        'processing',
      );
    });

    test('rejects malformed and unauthorized responses', () async {
      expect(
        () => paymentsFromJson({
          'data': [
            {'id': 'payment-1'},
          ],
        }),
        throwsFormatException,
      );
      final repository = ConsentFeedbackFinanceRepository(
        get: (path, {query}) async =>
            throw ApiException(403, 'NOT_RESOURCE_OWNER', 'Denied'),
        post: (path, body, {idempotencyKey}) async => <String, dynamic>{},
      );
      await expectLater(
        repository.coverage(),
        throwsA(
          isA<ApiException>().having((error) => error.status, 'status', 403),
        ),
      );
    });
  });
}
