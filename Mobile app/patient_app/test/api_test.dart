import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/config.dart';

void main() {
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
  });
}
