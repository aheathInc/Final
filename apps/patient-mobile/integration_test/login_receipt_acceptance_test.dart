import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/login_screen.dart';
import 'package:a_health_patient/screens/security_screen.dart';
import 'fixtures/receipt_sample.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  bool converted = false;
  const account = {
    'id': 'synthetic-native',
    'role': 'patient',
    'full_name': 'Synthetic Test Patient',
    'phone_number': '+255700000001'
  };
  setUpAll(() {
    FlutterSecureStorage.setMockInitialValues({});
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
        h.resolve(Response(
            requestOptions: o,
            data: base64Decode(receiptSampleBase64),
            statusCode: 200));
      })));
  });
  testWidgets('known account, biometric settings and native PDF save',
      (tester) async {
    Future<void> show(Widget child,
        {bool dark = false, double scale = 1}) async {
      await tester.pumpWidget(MaterialApp(
          theme: buildTheme(),
          darkTheme: buildDarkTheme(),
          themeMode: dark ? ThemeMode.dark : ThemeMode.light,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: TextScaler.linear(scale)),
              child: child!),
          home: child));
      await tester.pumpAndSettle();
    }

    Future<void> shot(String name) async {
      FocusManager.instance.primaryFocus?.unfocus();
      await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
      await tester.pumpAndSettle();
      if (!converted) {
        await binding.convertFlutterSurfaceToImage();
        converted = true;
        await tester.pumpAndSettle();
      }
      await binding.takeScreenshot(name);
      expect(tester.takeException(), isNull);
    }

    await Session.save(
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        user: account);
    await Session.clear();
    await show(const LoginScreen());
    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Namba ya simu'), findsNothing);
    await shot('returning-login');
    await show(const LoginScreen(), dark: true, scale: 1.3);
    await shot('returning-login-dark-large');
    await Session.saveRegistration('enr_synthetic');
    await show(const SecurityScreen(registration: true, receipt: {
      'id': 'synthetic-native-receipt',
      'reference': 'REG-SYNTHETIC-RECEIPT-TEST'
    }));
    expect(find.text('Pakua risiti (PDF)'), findsOneWidget);
    await shot('registration-receipt');
    final bytes = await Api.receiptPdf('/payments/registration/receipt',
        registration: true);
    debugPrint('NATIVE_RECEIPT_SAVE_READY');
    final saved = await const MethodChannel('ahealth/device_actions')
        .invokeMethod<bool>('saveReceipt',
            {'name': 'A-Health-synthetic-receipt-test.pdf', 'bytes': bytes});
    expect(saved, true);
    debugPrint('NATIVE_RECEIPT_SAVE_COMPLETE');
    await Session.save(
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        user: account);
    await show(const SecurityScreen());
    await shot('biometric-settings');
    await show(const SecurityScreen(), dark: true, scale: 1.3);
    await shot('biometric-settings-dark-large');
    await show(const BiometricLockScreen());
    await shot('biometric-unlock');
  });
}
