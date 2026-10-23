import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final output = Directory('artifacts/android-ui-acceptance');
  output.createSync(recursive: true);
  await integrationDriver(
    onScreenshot: (name, bytes, [args]) async {
      File('${output.path}/$name.png').writeAsBytesSync(bytes);
      return true;
    },
  );
}
