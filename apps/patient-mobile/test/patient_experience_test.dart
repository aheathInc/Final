import 'package:a_health_patient/core/patient_experience.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('family parsing', () {
    test('keeps relationship and authorized assignment summaries', () {
      final family = familyFromJson({
        'id': 'family-1',
        'name': 'Synthetic family',
        'members': [
          {
            'id': 'member-1',
            'patient_profile_id': 'profile-1',
            'full_name': 'Synthetic Dependant',
            'relationship': 'child'
          },
        ],
        'gp_clinician': {'id': 'gp-1', 'full_name': 'Synthetic GP'},
        'obgyn_clinician': null,
      });
      final member = dependantFromJson(family['members'].single);
      expect(member['relationship'], 'child');
      final patientServiceDependant = dependantFromJson({
        'id': 'profile-2',
        'full_name': 'Synthetic Dependant Two',
        'guardian_user_id': 'guardian-1',
      });
      expect(patientServiceDependant['patient_profile_id'], 'profile-2');
      expect(patientServiceDependant['relationship'], 'dependant');
      expect(family['gp_clinician']['full_name'], 'Synthetic GP');
      expect(family['obgyn_clinician'], isNull);
    });

    test('rejects incomplete member and family responses', () {
      expect(
          () => dependantFromJson({'full_name': 'x'}), throwsFormatException);
      expect(() => familyFromJson({'id': 'x'}), throwsFormatException);
    });
  });

  group('education parsing', () {
    test('lists backend records and opens the same published article', () {
      final articles = educationArticlesFromJson({
        'data': [
          {
            'slug': 'published',
            'title': 'Published item',
            'summary': 'Summary',
            'language': 'sw'
          },
          {'slug': 'bad-draft', 'title': 'Incomplete draft'},
        ],
      });
      expect(articles, hasLength(1));
      expect(
          educationArticleFromJson({
            'slug': articles.single['slug'],
            'title': articles.single['title'],
            'body': 'Stored body',
          })['body'],
          'Stored body');
      expect(educationArticlesFromJson({'data': []}), isEmpty);
      expect(() => educationArticleFromJson({'status': 'draft'}),
          throwsFormatException);
    });

    test('parses topics and represents malformed lists as empty', () {
      expect(
        educationTopicsFromJson({
          'data': [
            {'slug': 'prevention', 'category': 'prevention'},
          ],
        }),
        hasLength(1),
      );
      expect(educationTopicsFromJson({'data': 'invalid'}), isEmpty);
    });
  });

  group('prevention parsing', () {
    test('parses invitation status, vaccination dates and service risk values',
        () {
      final invitations = screeningInvitationsFromJson({
        'data': [
          {
            'id': 'invite-1',
            'status': 'pending',
            'invited_at': '2026-10-01T00:00:00Z'
          },
        ]
      });
      expect(invitations.single['status'], 'pending');
      expect(
          vaccinationRecordsFromJson({
            'data': [
              {
                'id': 'v-1',
                'status': 'administered',
                'administered_at': '2026-09-01T00:00:00Z'
              },
            ]
          }).single['status'],
          'administered');
      final scores = riskScoresFromJson({
        'data': [
          {
            'condition_code': 'synthetic-code',
            'score': 2,
            'band': 'service-band',
            'model_version': 'v1'
          },
        ]
      });
      expect(scores.single['band'], 'service-band');
      expect(
          riskScoresFromJson({
            'data': [
              {'condition_code': 'incomplete'}
            ]
          }),
          isEmpty);
    });
  });

  group('emergency request data', () {
    test('constructs requests only from caller supplied coordinates', () {
      final body = emergencyRequestBody(
        category: 'medical',
        latitude: 12.345,
        longitude: 45.678,
      );
      expect(body['location'], {'lat': 12.345, 'lng': 45.678});
      expect(body['location'], isNot({'lat': 0, 'lng': 0}));
      expect(isValidEmergencyCoordinates(12.345, 45.678), isTrue);
      expect(isValidEmergencyCoordinates(0, 0), isFalse);
      expect(isValidEmergencyCoordinates(90.1, 45.678), isFalse);
      expect(isValidEmergencyCoordinates(null, 45.678), isFalse);
    });

    test('reads persisted status and rejects incomplete service errors', () {
      expect(
          emergencyRequestFromJson(
              {'id': 'request-1', 'status': 'reported'})['status'],
          'reported');
      expect(() => emergencyRequestFromJson({'error': 'unavailable'}),
          throwsFormatException);
    });
  });
}
