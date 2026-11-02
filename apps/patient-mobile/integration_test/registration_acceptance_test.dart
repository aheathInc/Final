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
import 'package:a_health_patient/screens/verify_screen.dart';
import 'package:a_health_patient/screens/registration_screen.dart';
import 'package:a_health_patient/screens/security_screen.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  bool converted = false, paid = false;
  final status = <String, dynamic>{
    'step': 'profile',
    'phone_number': '+255700000001',
    'fee': {'amount': 4000, 'currency': 'TZS'},
    'consent_version': 'patient-registration-2026-10-v1',
    'profile': null,
    'bill': null,
    'payment': null
  };
  final requests = <String>[];
  setUpAll(() {
    FlutterSecureStorage.setMockInitialValues({});
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
        final path = Uri.parse(o.path).path;
        requests.add(path);
        dynamic data = {};
        if (path == '/auth/registration') {
          data = Map<String, dynamic>.from(status);
        } else if (path == '/payments/registration/options') {
          data = {
            'environment': 'simulated',
            'requires_email': false,
            'providers': ['mpesa']
          };
        } else if (path == '/auth/registration/locations') {
          data = {
            'places': [
              {
                'name': 'Dodoma',
                'context': 'Dodoma City, Dodoma Region, Tanzania',
                'label': 'Dodoma, Dodoma City, Dodoma Region, Tanzania'
              },
              {
                'name': 'Dodoma Region',
                'context': 'Tanzania',
                'label': 'Dodoma Region, Tanzania'
              },
            ]
          };
        } else if (path == '/auth/registration/profile') {
          expect(o.data['full_name'], 'Synthetic Test Patient');
          expect(o.data['date_of_birth'], '1995-07-10');
          expect(o.data['residence'],
              'Dodoma, Dodoma City, Dodoma Region, Tanzania');
          expect(o.data['next_of_kin_phone'], '+255700000002');
          status['step'] = 'payment';
          status['bill'] = {
            'id': 'bill-test',
            'reference': 'REG-SYNTHETIC-TEST',
            'amount': 4000,
            'status': 'due'
          };
          data = Map<String, dynamic>.from(status);
        } else if (path == '/payments/registration/intents') {
          expect(o.data.containsKey('amount'), false);
          status['payment'] = {
            'status': 'processing',
            'environment': 'simulated'
          };
          data = {'id': 'intent-test'};
        } else if (path == '/payments/registration/simulate') {
          paid = true;
          status['step'] = 'security';
          status['bill']['status'] = 'paid';
          data = {'simulated': true};
        } else if (path == '/auth/registration/complete') {
          expect(paid, true);
          data = {
            'access_token': 'synthetic-access',
            'refresh_token': 'synthetic-refresh',
            'user': {
              'id': 'synthetic-patient',
              'role': 'patient',
              'full_name': 'Synthetic Test Patient'
            }
          };
        }
        h.resolve(Response(requestOptions: o, data: data, statusCode: 200));
      })));
  });
  testWidgets('registration sequence, fee, password and native screenshots',
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

    Future<void> tapText(String text) async {
      final f = find.text(text).last;
      await tester.ensureVisible(f);
      await tester.tap(f);
      await tester.pumpAndSettle();
    }

    await show(const LoginScreen(phoneSetup: true, registration: true));
    await shot('login-phone');
    await tapText('Nina account: ingia');
    await shot('login-password');
    await show(const VerifyScreen(
        challengeId: 'synthetic',
        maskedTo: '+2557****0001',
        simulated: true,
        phoneNumber: '+255700000001',
        developmentCode: '123456'));
    await shot('otp-simulated');
    await Session.saveRegistration('enr_synthetic');
    await show(const RegistrationScreen());
    await shot('profile-top');
    await tester.enterText(find.widgetWithText(TextFormField, 'Jina kamili'),
        'Synthetic Test Patient');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Tarehe ya kuzaliwa'), '10/07/1995');
    await tester.tap(find.byTooltip('Chagua tarehe ya kuzaliwa'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('1995').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(DropdownButtonFormField<String>));
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mwanamke').last);
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Mahali unapoishi'), 'Dodoma');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    await tester
        .ensureVisible(find.text('Dodoma City, Dodoma Region, Tanzania'));
    // Keep focus so suggestions remain visible; keyboard belongs in this capture.
    if (!converted) {
      await binding.convertFlutterSurfaceToImage();
      converted = true;
    }
    await binding.takeScreenshot('residence-suggestions');
    await tester.tap(find.text('Dodoma City, Dodoma Region, Tanzania'));
    await tester.pumpAndSettle();
    await tester
        .ensureVisible(find.widgetWithText(TextFormField, 'Jina la ndugu'));
    await tester.enterText(find.widgetWithText(TextFormField, 'Jina la ndugu'),
        'Synthetic Test Contact');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Simu ya ndugu'), '0700000002');
    FocusManager.instance.primaryFocus?.unfocus();
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await tapText('Hifadhi na endelea');
    expect(find.text('Weka tarehe ya kuzaliwa.'), findsNothing);
    expect(find.text('Kubali matumizi ya taarifa ili kuendelea na usajili.'),
        findsOneWidget);
    await shot('registration-consent-validation');
    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await shot('profile-contact');
    await tapText('Hifadhi na endelea');
    await shot('registration-fee');
    await tapText('Anza malipo ya majaribio');
    await shot('payment-pending');
    await tapText('Thibitisha malipo ya majaribio');
    await shot('password-setup');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password mpya'),
        'A calm river at sunrise!');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Rudia password'), 'different');
    await tapText('Hifadhi password');
    expect(find.text('Password hazifanani.'), findsOneWidget);
    expect(requests.contains('/auth/registration/complete'), false);
    await tester.enterText(find.widgetWithText(TextFormField, 'Rudia password'),
        'A calm river at sunrise!');
    await tapText('Hifadhi password');
    expect(find.text('Account yako iko tayari'), findsOneWidget);
    await shot('biometric-choice');
    expect(await Session.registrationToken(), isNull);
    expect(await Session.accessToken(), 'synthetic-access');
    await show(const BiometricLockScreen(), dark: true, scale: 1.3);
    await shot('lock-dark-large');
    expect(tester.takeException(), isNull);
  });
}
