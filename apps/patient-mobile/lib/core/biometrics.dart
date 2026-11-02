import 'l10n.dart';
import 'package:local_auth/local_auth.dart';
import 'package:flutter/services.dart';
import 'session.dart';

class Biometrics {
  static final _auth = LocalAuthentication();
  static bool authenticating = false;
  static Future<bool> openSettings() async {
    try {
      return await const MethodChannel('ahealth/device_actions')
              .invokeMethod<bool>('biometricSettings') ??
          false;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> available() async {
    try {
      return await _auth.isDeviceSupported() &&
          (await _auth.getAvailableBiometrics()).isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> unlock() async {
    if (authenticating) return false;
    final identity = Session.identityChanges.value;
    authenticating = true;
    try {
      final ok = await _auth.authenticate(
          localizedReason:
              L.tr('Thibitisha ili kufungua account yako ya A-Health'),
          biometricOnly: true,
          persistAcrossBackgrounding: true);
      if (!ok ||
          identity != Session.identityChanges.value ||
          !await Session.authenticated) {
        return false;
      }
      if (identity != Session.identityChanges.value) return false;
      Session.locked.value = false;
      return true;
    } catch (_) {
      return false;
    } finally {
      authenticating = false;
    }
  }
}
