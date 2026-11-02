import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

// Session changes synchronously clear native alarms. Unit/widget tests have no
// Android host; provide its idle response before tests enter the fake clock.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
          const MethodChannel('ahealth/medication_reminders'),
          (call) async => call.method == 'status'
              ? {'available': false, 'enabled': false}
              : null);
  await testMain();
}
