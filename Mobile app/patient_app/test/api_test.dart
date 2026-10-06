import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/config.dart';

void main() {
  group('Release API configuration', () {
    test('requires a non-local HTTPS gateway for profile and release builds', () {
      expect(
        () => Config.validateGatewayForBuild(value: '', debugBuild: false),
        throwsStateError,
      );
      for (final localUrl in [
        'http://localhost:4001',
        'https://localhost',
        'https://127.0.0.1',
        'https://10.0.2.2',
        'https://service.local',
        'https://api.example.org:4001',
      ]) {
        expect(
          () => Config.validateGatewayForBuild(
            value: localUrl,
            debugBuild: false,
          ),
          throwsStateError,
          reason: 'release must reject local or development endpoint $localUrl',
        );
      }
      expect(
        () => Config.validateGatewayForBuild(
          value: 'https://api.example.org',
          debugBuild: false,
        ),
        returnsNormally,
      );
    });

    test('keeps local endpoint configuration available to debug builds', () {
      expect(
        () => Config.validateGatewayForBuild(
          value: 'http://localhost:4001',
          debugBuild: true,
        ),
        returnsNormally,
      );
    });
  });

  group('Config Routing', () {
    test('routes /auth correctly to 4001', () {
      final url = Config.baseUrlFor('/auth/login');
      expect(url, contains(':4001'));
    });

    test('routes /patient-profiles correctly to 4002', () {
      final url = Config.baseUrlFor('/patient-profiles/me');
      expect(url, contains(':4002'));
    });

    test('routes /consultations correctly to 4005', () {
      final url = Config.baseUrlFor('/consultations');
      expect(url, contains(':4005'));
    });

    test('routes messaging correctly to 4006', () {
      final url = Config.baseUrlFor('/care-threads/123/messages');
      expect(url, contains(':4006'));
    });

    test('routes prescriptions correctly to 4005', () {
      final url = Config.baseUrlFor('/patient-profiles/me/prescriptions');
      expect(url, contains(':4005'));
    });

    test('routes investigation orders to diagnostics service (4013)', () {
      expect(Config.baseUrlFor('/investigation-orders'), contains(':4013'));
    });

    test('routes pharmacy medication search to pharmacy service (4011)', () {
      expect(
        Config.baseUrlFor('/pharmacies/medication-search'),
        contains(':4011'),
      );
    });

    test('routes risk-scores to prevention service (4024)', () {
      final url = Config.baseUrlFor('/patient-profiles/me/risk-scores');
      expect(url, contains(':4024'));
    });

    test('routes families to the families service (4015)', () {
      expect(Config.baseUrlFor('/families/me'), contains(':4015'));
    });

    test('keeps auth-owned /users/me on the auth service (4001)', () {
      expect(Config.baseUrlFor('/users/me'), contains(':4001'));
    });

    test('routes guardian dependants to patient service (4002)', () {
      expect(Config.baseUrlFor('/users/me/dependents'), contains(':4002'));
    });

    test('routes education to the education service (4016)', () {
      expect(Config.baseUrlFor('/education/articles'), contains(':4016'));
    });

    test('routes emergency requests to the emergency service (4010)', () {
      expect(Config.baseUrlFor('/emergency-requests'), contains(':4010'));
    });

    test('routes consultation ratings to the quality service (4014)', () {
      expect(
        Config.baseUrlFor('/consultations/case-id/rating'),
        contains(':4014'),
      );
    });

    test('routes incident reports to the quality service (4014)', () {
      expect(Config.baseUrlFor('/incident-reports'), contains(':4014'));
    });

    test('routes insurance and payment reads to their existing services', () {
      expect(Config.baseUrlFor('/insurance/coverage'), contains(':4018'));
      expect(Config.baseUrlFor('/payments'), contains(':4012'));
      expect(
        Config.baseUrlFor('/patient-profiles/profile/consents'),
        contains(':4002'),
      );
    });
  });
}
