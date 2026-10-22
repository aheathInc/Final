import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Tokens live in the platform keystore, not in shared preferences.
///
/// On a shared or lost phone that is the difference between a session and a
/// stranger's access to someone's medical history.
class Session {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const _access = 'ah_access';
  static const _refresh = 'ah_refresh';
  static const _profile = 'ah_profile';
  static const _device = 'ah_device_id';

  static Future<void> save({
    required String accessToken,
    required String refreshToken,
    Map<String, dynamic>? user,
  }) async {
    await _storage.write(key: _access, value: accessToken);
    await _storage.write(key: _refresh, value: refreshToken);
    if (user != null) {
      await _storage.write(key: _profile, value: jsonEncode(user));
    }
  }

  static Future<String?> accessToken() => _storage.read(key: _access);
  static Future<String?> refreshToken() => _storage.read(key: _refresh);

  static Future<bool> get authenticated async => await accessToken() != null;

  static Future<Map<String, dynamic>?> user() async {
    final raw = await _storage.read(key: _profile);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  static Future<String?> userId() async => (await user())?['id'] as String?;

  /// A stable id for this installation, so the backend can manage sessions per
  /// device rather than per login.
  static Future<String> deviceId() async {
    final existing = await _storage.read(key: _device);
    if (existing != null) return existing;
    final id = 'and-${DateTime.now().millisecondsSinceEpoch}';
    await _storage.write(key: _device, value: id);
    return id;
  }

  static Future<void> clear() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
    await _storage.delete(key: _profile);
    // The device id survives sign-out on purpose: it identifies the phone,
    // not the person.
  }
}
