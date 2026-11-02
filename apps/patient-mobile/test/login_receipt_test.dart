import 'dart:async';
import 'dart:convert';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/login_screen.dart';
import 'package:a_health_patient/widgets/biometric_settings.dart';
import 'package:a_health_patient/widgets/receipt_download.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_auth_platform_interface/local_auth_platform_interface.dart';

const user = {
  'id': 'patient-one',
  'role': 'patient',
  'full_name': 'Synthetic Patient',
  'phone_number': '+255700000001'
};
Future<void> signedIn() =>
    Session.save(accessToken: 'access', refreshToken: 'refresh', user: user);

class FakeAuth extends LocalAuthPlatform {
  bool enrolled = false, succeeds = false;
  @override
  Future<bool> isDeviceSupported() async => true;
  @override
  Future<List<BiometricType>> getEnrolledBiometrics() async =>
      enrolled ? [BiometricType.face] : [];
  @override
  Future<bool> authenticate(
      {required String localizedReason,
      required Iterable<AuthMessages> authMessages,
      AuthenticationOptions options = const AuthenticationOptions()}) async {
    expect(options.biometricOnly, true);
    return succeeds;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final platform = LocalAuthPlatform.instance;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await Session.clear();
  });
  tearDown(() {
    Api.useDioForTesting(null);
    LocalAuthPlatform.instance = platform;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('ahealth/device_actions'), null);
  });
  testWidgets(
      'returning login submits the remembered account without a phone field',
      (tester) async {
    await signedIn();
    await Session.clear();
    Map? request;
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
        request = o.data as Map;
        h.resolve(Response(requestOptions: o, statusCode: 422, data: {
          'error': {'message': 'Synthetic rejection'}
        }));
      })));
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Namba ya simu'), findsNothing);
    await tester.enterText(find.byType(TextField), 'A synthetic password');
    tester.testTextInput.hide();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Ingia'));
    await tester.tap(find.widgetWithText(FilledButton, 'Ingia'));
    await tester.pumpAndSettle();
    expect(request?['phone_number'], user['phone_number']);
    expect(
        find.text('Tumia account nyingine / sahau account hii'), findsNothing);
    expect(find.byIcon(Icons.login_rounded), findsOneWidget);
    expect(find.text('Namba ya simu'), findsNothing);
  });
  testWidgets(
      'fresh login has no phone input; linking and registration are explicit separate routes',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsNothing);
    expect(find.text('Namba ya simu'), findsNothing);
    await tester.tap(find.text('Unganisha account yangu'));
    await tester.pumpAndSettle();
    expect(find.text('Unganisha account kwenye simu'), findsOneWidget);
    expect(find.text('Namba ya simu'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsNothing);
    await tester.tap(find.text('Mgonjwa mpya? Sajili account'));
    await tester.pumpAndSettle();
    expect(find.text('Usajili wa account'), findsOneWidget);
    expect(find.text('Namba ya simu'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsNothing);
  });
  testWidgets(
      'reference layout remains usable with large text and keyboard on a small phone',
      (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);
    await signedIn();
    await Session.clear();
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(
          onRequest: (o, h) =>
              h.resolve(Response(requestOptions: o, statusCode: 422, data: {
                'error': {'message': 'Synthetic validation'}
              })))));
    await tester.pumpWidget(MaterialApp(
        theme: buildDarkTheme(),
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.3)),
            child: child!),
        home: const LoginScreen()));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'Synthetic password');
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    await tester.pumpAndSettle();
    final login = find.widgetWithText(FilledButton, 'Ingia');
    await tester.ensureVisible(login);
    await tester.pumpAndSettle();
    expect(login.hitTestable(), findsOneWidget);
    await tester.tap(login);
    await tester.pumpAndSettle();
  });
  testWidgets(
      'biometric enrollment shortcut refreshes and opt-in requires successful authentication',
      (tester) async {
    await signedIn();
    final auth = FakeAuth();
    LocalAuthPlatform.instance = auth;
    int settings = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('ahealth/device_actions'),
            (call) async {
      if (call.method == 'biometricSettings') settings++;
      return true;
    });
    await tester.pumpWidget(const MaterialApp(
        home:
            Scaffold(body: SingleChildScrollView(child: BiometricSettings()))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sanidi biometrics kwenye simu'));
    await tester.pumpAndSettle();
    expect(settings, 1);
    auth.enrolled = true;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Washa Face / Fingerprint'));
    await tester.pumpAndSettle();
    expect(Session.biometricEnabled, false);
    auth.succeeds = true;
    await tester.tap(find.text('Washa Face / Fingerprint'));
    await tester.pumpAndSettle();
    expect(Session.biometricEnabled, true);
    await Session.restoreLock();
    expect(Session.locked.value, true);
    await Session.clear(preserveBiometricPreference: true);
    await signedIn();
    expect(Session.biometricEnabled, true);
    await Session.save(
        accessToken: 'other',
        refreshToken: 'other',
        user: {...user, 'id': 'patient-two'});
    expect(Session.biometricEnabled, false);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
      'receipt button saves PDF bytes and reports cancellation without claiming success',
      (tester) async {
    await signedIn();
    final pdf = utf8.encode('%PDF-1.7\nsynthetic unit fixture');
    int saves = 0;
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
        expect(o.headers['Authorization'], 'Bearer access');
        h.resolve(Response(requestOptions: o, data: pdf, statusCode: 200));
      })));
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('ahealth/device_actions'),
            (call) async {
      expect(call.method, 'saveReceipt');
      expect((call.arguments as Map)['bytes'], pdf);
      saves++;
      return false;
    });
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: ReceiptDownload(billId: 'bill-one'))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pakua risiti (PDF)'));
    await tester.pumpAndSettle();
    expect(saves, 1);
    expect(find.text('Hujahifadhi risiti. Unaweza kuipakua tena.'),
        findsOneWidget);
  });
  test(
      'an account change during download cannot export the old account receipt',
      () async {
    await signedIn();
    final started = Completer<void>(), finish = Completer<void>();
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
        started.complete();
        await finish.future;
        h.resolve(Response(
            requestOptions: o,
            data: utf8.encode('%PDF-1.7 test'),
            statusCode: 200));
      })));
    final result = Api.receiptPdf('/payments/bills/bill-one/receipt');
    final assertion = expectLater(result, throwsA(isA<ApiException>()));
    await started.future;
    await Session.clear();
    finish.complete();
    await assertion;
  });
}
