import 'dart:io';
import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final out = Directory('../../.impeccable/review/login-receipts/native')
    ..createSync(recursive: true);
  await integrationDriver(onScreenshot: (name, bytes, [args]) async {
    File('${out.path}/$name.png').writeAsBytesSync(bytes);
    return true;
  });
}
