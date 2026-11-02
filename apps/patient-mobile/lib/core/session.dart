import 'dart:convert';
import 'medication_followup.dart';
import 'package:flutter/foundation.dart' show ValueListenable, ValueNotifier;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Tokens live in the platform keystore, not in shared preferences.
///
/// On a shared or lost phone that is the difference between a session and a
/// stranger's access to someone's medical history.
class Session {
  // Sensitive screens can invalidate in-flight work synchronously when logout
  // or explicit account login begins. Refresh without user data is not a switch.
  static final _identityRevision = ValueNotifier<int>(0);
  static ValueListenable<int> get identityChanges => _identityRevision;

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const _access = 'ah_access';
  static const _refresh = 'ah_refresh';
  static const _profile = 'ah_profile';
  static const _device = 'ah_device_id';
  static final locked = ValueNotifier<bool>(false);
  static bool biometricEnabled = false;
  static Future<Map<String, dynamic>?> rememberedAccount() async {
    final raw = await _storage.read(key: 'ah_remembered_account');
    if (raw == null) return null;
    final value = jsonDecode(raw) as Map<String, dynamic>;
    return value['phone_number'] is String ? value : null;
  }

  static Future<void> forgetRememberedAccount() =>
      _storage.delete(key: 'ah_remembered_account');

  static Future<void> _remember(Map<String, dynamic> user) async {
    if (user['role'] == 'patient' && user['phone_number'] is String) {
      await _storage.write(
          key: 'ah_remembered_account',
          value: jsonEncode({
            'id': user['id'],
            'full_name': user['full_name'],
            'phone_number': user['phone_number'],
          }));
    }
  }

  static Future<void> saveRegistration(String token) =>
      _storage.write(key: 'ah_registration', value: token);
  static Future<String?> registrationToken() =>
      _storage.read(key: 'ah_registration');
  static Future<void> clearRegistration() =>
      _storage.delete(key: 'ah_registration');
  static Future<void> setBiometric(bool enabled) async {
    if (enabled && !await authenticated) return;
    biometricEnabled = enabled;
    if (enabled) {
      await _storage.write(key: 'ah_biometric_user', value: await userId());
    } else {
      await _storage.delete(key: 'ah_biometric_user');
    }
    await _storage.write(
        key: 'ah_biometric', value: enabled ? 'true' : 'false');
  }

  static Future<void> restoreLock() async {
    final current = await user();
    if (current != null) await _remember(current);
    biometricEnabled = await _storage.read(key: 'ah_biometric') == 'true';
    if (biometricEnabled &&
        current != null &&
        await _storage.read(key: 'ah_biometric_user') == null) {
      await _storage.write(
          key: 'ah_biometric_user', value: current['id'] as String?);
    }
    locked.value = biometricEnabled && await authenticated;
  }

  static Future<void> save({
    required String accessToken,
    required String refreshToken,
    Map<String, dynamic>? user,
  }) async {
    if (user != null) {
      _identityRevision.value += 1;
      if (user['id'] is String)
        await MedicationReminders.owner(user['id'] as String);
      else
        await MedicationReminders.clear();
      if (user['id'] != await _storage.read(key: 'ah_biometric_user')) {
        await setBiometric(false);
      }
      locked.value = false;
      await clearRegistration();
    }
    await _storage.write(key: _access, value: accessToken);
    await _storage.write(key: _refresh, value: refreshToken);
    if (user != null) {
      await _storage.write(key: _profile, value: jsonEncode(user));
      await _remember(user);
      // Publish the completed identity too: listeners invalidated above must
      // reload only after the new account is persisted.
      _identityRevision.value += 1;
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

  static Future<void> clear({bool preserveBiometricPreference = false}) async {
    await MedicationReminders.clear();
    if (!preserveBiometricPreference) await setBiometric(false);
    locked.value = false;
    await clearRegistration();
    _identityRevision.value += 1;
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
    await _storage.delete(key: _profile);
    _identityRevision.value += 1;
    // The device id survives sign-out on purpose: it identifies the phone,
    // not the person.
  }
}
