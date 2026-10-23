import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/appointments_screen.dart';
import 'package:a_health_patient/screens/family_screen.dart';
import 'package:a_health_patient/screens/front_desk_screen.dart';
import 'package:a_health_patient/screens/health_history_screen.dart';
import 'package:a_health_patient/screens/home_screen.dart';
import 'package:a_health_patient/screens/login_screen.dart';
import 'package:a_health_patient/screens/patient_care_medicines_screen.dart';
import 'package:a_health_patient/screens/profile_screen.dart';
import 'package:a_health_patient/screens/verify_screen.dart';

late final IntegrationTestWidgetsFlutterBinding binding;
var _surfaceConverted = false;

void main() {
  binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => _surfaceConverted = false);
  setUpAll(() {
    // Reject every HTTP request inside Dio. This acceptance harness never
    // connects to an AHP service and does not need an account or patient data.
    Api.useDioForTesting(
      Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) => handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.connectionError,
                message: 'Acceptance harness: network disabled',
              ),
            ),
          ),
        ),
    );
    Api.connectivityProbeForTesting = () async => false;
  });

  testWidgets('login and OTP presentation', (tester) async {
    await _mount(tester, const LoginScreen());
    await _capture(tester, 'pixel4-login-light');

    await _mount(
      tester,
      const VerifyScreen(
        challengeId: 'acceptance-placeholder',
        maskedTo: '•••• ••••',
      ),
    );
    await _capture(tester, 'pixel4-otp-light');
  });

  testWidgets('home, navigation, scrolling, and back behavior', (tester) async {
    await _mount(tester, const HomeScreen());
    await _settle(tester);
    await _capture(tester, 'pixel4-home-dashboard');

    await tester.scrollUntilVisible(
      find.text('Huduma zako'),
      280,
      scrollable: find.byType(Scrollable).first,
    );
    await _capture(tester, 'pixel4-home-services-scroll');

    for (final destination in ['Huduma', 'Rekodi', 'Ujumbe', 'Wasifu']) {
      await tester.tap(find.text(destination).last);
      await _settle(tester);
      await _capture(
        tester,
        'pixel4-navigation-${destination.toLowerCase()}',
      );
    }

    await tester.tap(find.text('Huduma').last);
    await _settle(tester);
    await tester.scrollUntilVisible(
      find.text('Miadi'),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Miadi').first);
    await _settle(tester);
    expect(find.text('Miadi'), findsWidgets);
    await _capture(tester, 'pixel4-appointments-navigation');
    await tester.tap(find.byIcon(Icons.arrow_back));
    await _settle(tester);
    expect(find.byType(AppointmentsScreen), findsNothing);
    expect(find.byType(HomeScreen), findsOneWidget);
    await _capture(tester, 'pixel4-home-after-back');
  });

  testWidgets('patient destinations in light and dark appearance',
      (tester) async {
    final destinations = <(String, Widget)>[
      ('front-desk', const FrontDeskScreen()),
      ('appointments', const AppointmentsScreen()),
      ('health-records', const HealthHistoryScreen()),
      ('medication-follow-up', const PatientCareMedicinesScreen()),
      ('family', const FamilyScreen()),
      ('profile', const ProfileScreen()),
    ];

    for (final (name, page) in destinations) {
      await _mount(tester, page);
      await _settle(tester);
      await _capture(tester, 'pixel4-$name-light');

      await _mount(tester, page, mode: ThemeMode.dark);
      await _settle(tester);
      await _capture(tester, 'pixel4-$name-dark');
    }
  });

  testWidgets('reduced motion and enlarged text remain usable', (tester) async {
    await _mount(tester, const HomeScreen(), disableAnimations: true);
    await _settle(tester);
    await _capture(tester, 'pixel4-home-reduced-motion');

    await _mount(tester, const HomeScreen(), textScale: 1.3);
    await _settle(tester);
    await _capture(tester, 'pixel4-home-text-scale-130');
  });
}

Future<void> _mount(
  WidgetTester tester,
  Widget page, {
  ThemeMode mode = ThemeMode.light,
  bool disableAnimations = false,
  double textScale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: mode,
      debugShowCheckedModeBanner: false,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          disableAnimations: disableAnimations,
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: page,
    ),
  );
  await _settle(tester);
}

Future<void> _settle(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 900));
  await tester.pump();
}

Future<void> _capture(WidgetTester tester, String name) async {
  await _settle(tester);
  if (!_surfaceConverted) {
    await binding.convertFlutterSurfaceToImage();
    _surfaceConverted = true;
    await tester.pump();
  }
  await binding.takeScreenshot(name);
}
