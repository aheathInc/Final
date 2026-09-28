import 'dart:io' show Platform;

/// Where the API lives.
///
/// The web consoles proxy through their own server; a mobile app has no such
/// place to hide, so it talks to the API directly. When the SA&D's Kong
/// gateway is deployed this collapses to one host and [_serviceMap] stops
/// being consulted at all — which is why the gateway is checked first.
class Config {
  /// Override at build time for a hosted gateway that fronts all endpoints:
  ///   flutter run --dart-define=API_GATEWAY_URL=https://api.a-health.tz
  static const gatewayUrl = String.fromEnvironment('API_GATEWAY_URL');

  /// Override for local development when the app is running on a real Android
  /// device instead of an emulator. The phone must reach the host computer on
  /// its LAN IP, not 10.0.2.2.
  ///
  /// Example:
  ///   flutter run --dart-define=API_HOST=192.168.1.14
  static const hostOverride = String.fromEnvironment('API_HOST');

  /// An Android emulator reaches the host machine on 10.0.2.2, not localhost.
  /// A real phone uses the host machine's LAN IP instead.
  static String get _devHost =>
      hostOverride.isNotEmpty ? hostOverride : Platform.isAndroid ? '10.0.2.2' : 'localhost';

  static const _serviceMap = <String, int>{
    '/auth': 4001,
    '/users': 4001,
    '/patient-profiles': 4002,
    '/clinicians': 4003,
    '/appointments': 4004,
    '/consultations': 4005,
    '/care-threads': 4005,
    '/queue': 4005,
    '/prescriptions': 4005,
    '/messages': 4006,
    '/realtime': 4006,
    '/follow-up-cycles': 4007,
    '/check-ins': 4007,
    '/adherence-logs': 4007,
    '/ai': 4009,
    '/emergency-requests': 4010,
    '/pharmacies': 4011,
    '/payments': 4012,
    '/education': 4016,
    '/insurance': 4018,
    '/sync': 4022,
    '/devices': 4023,
    '/screening-programmes': 4024,
    '/screening-invitations': 4024,
    '/facilities': 4025,
  };

  /// Longest prefix wins: `/care-threads/x/messages` belongs to messaging even
  /// though `/care-threads` belongs to consultation.
  static String baseUrlFor(String path) {
    if (gatewayUrl.isNotEmpty) return gatewayUrl;

    if (path.startsWith('/care-threads/') && path.endsWith('/messages')) {
      return 'http://$_devHost:4006';
    }
    if (path.startsWith('/patient-profiles/')) {
      if (path.endsWith('/prescriptions')) return 'http://$_devHost:4005';
      if (path.contains('/risk-scores') || path.contains('/vaccinations')) {
        return 'http://$_devHost:4024';
      }
      return 'http://$_devHost:4002';
    }

    final match = _serviceMap.keys
        .where((prefix) => path == prefix || path.startsWith('$prefix/'))
        .fold<String?>(null, (best, p) => best == null || p.length > best.length ? p : best);

    return 'http://$_devHost:${_serviceMap[match] ?? 4001}';
  }
}
