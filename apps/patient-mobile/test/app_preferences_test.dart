import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/app_settings_screen.dart';
import 'package:a_health_patient/screens/login_screen.dart';
import 'package:a_health_patient/screens/saved_advice_screen.dart';

Widget app(Widget home) => ListenableBuilder(
    listenable: AppPreferences.instance,
    builder: (_, __) => MaterialApp(
        theme: buildTheme(),
        darkTheme: buildDarkTheme(),
        themeMode: AppPreferences.instance.themeMode,
        locale: AppPreferences.instance.locale,
        supportedLocales: const [Locale('sw'), Locale('en'), Locale('fr')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: home));
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await Session.clear();
    await AppPreferences.instance.load();
    await L.load();
  });
  test('all three languages and theme preferences survive restoration',
      () async {
    for (final language in AppPreferences.languages) {
      await AppPreferences.instance.setLanguage(language);
      await AppPreferences.instance.setTheme(ThemeMode.dark);
      final restored = AppPreferences();
      await restored.load();
      expect(restored.language, language);
      expect(restored.themeMode, ThemeMode.dark);
    }
    await expectLater(
        AppPreferences.instance.setLanguage('xx'), throwsArgumentError);
  });
  test(
      'catalog has complete parallel translations and preserves every parameter',
      () async {
    final catalog =
        jsonDecode(await rootBundle.loadString('assets/l10n/ui.json')) as Map;
    expect(catalog.length, greaterThan(1000));
    final placeholders = RegExp(r'\{\d+\}');
    Set<String> parameters(String s) =>
        placeholders.allMatches(s).map((m) => m[0]!).toSet();
    for (final entry in catalog.entries) {
      expect((entry.value as List).length, greaterThanOrEqualTo(2),
          reason: entry.key);
      for (final translation in entry.value as List) {
        expect((translation as String).trim(), isNotEmpty, reason: entry.key);
        expect(parameters(translation), parameters(entry.key as String),
            reason: entry.key);
      }
    }
    await AppPreferences.instance.setLanguage('fr');
    expect(L.tr('Daktari: {0}', ['Tuma']), 'Médecin : Tuma');
    expect(L.tr('Matokeo ya Daktari ambayo hayapo kwenye catalog'),
        'Matokeo ya Daktari ambayo hayapo kwenye catalog');
  });
  testWidgets(
      'language and theme change immediately on the current settings route',
      (t) async {
    await t.pumpWidget(app(const AppSettingsScreen()));
    await t.pumpAndSettle();
    await t.tap(find.text('English'));
    await t.pumpAndSettle();
    expect(find.text('Language and appearance'), findsOneWidget);
    await t.tap(find.text('Français'));
    await t.pumpAndSettle();
    expect(find.text('Langue et apparence'), findsOneWidget);
    await t.ensureVisible(find.text('Mode sombre'));
    await t.pumpAndSettle();
    await t.tap(find.text('Mode sombre'));
    await t.pumpAndSettle();
    expect(Theme.of(t.element(find.byType(AppSettingsScreen))).brightness,
        Brightness.dark);
    await t.tap(find.text('Mode clair'));
    await t.pumpAndSettle();
    expect(Theme.of(t.element(find.byType(AppSettingsScreen))).brightness,
        Brightness.light);
    expect(find.text('Langue et apparence'), findsOneWidget);
  });
  testWidgets('changing language preserves a login draft and navigation',
      (t) async {
    await Session.save(
        accessToken: 'synthetic',
        refreshToken: 'synthetic',
        user: {
          'id': 'synthetic-locale',
          'role': 'patient',
          'full_name': 'Synthetic',
          'phone_number': '+255700000099'
        });
    await Session.clear();
    await t.pumpWidget(app(const LoginScreen()));
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField), 'Synthetic password draft');
    t.testTextInput.hide();
    await t.pumpAndSettle();
    await t.ensureVisible(find.byTooltip('Lugha na mwonekano'));
    await t.pumpAndSettle();
    await t.tap(find.byTooltip('Lugha na mwonekano'));
    await t.pumpAndSettle();
    await t.tap(find.text('Français'));
    await t.pumpAndSettle();
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    expect(find.text('Se connecter'), findsWidgets);
    expect(t.widget<TextField>(find.byType(TextField)).controller!.text,
        'Synthetic password draft');
    expect(find.text('Numéro de téléphone'), findsNothing);
  });
  testWidgets(
      'doctor authored clinical text is never translated by the interface',
      (t) async {
    await AppPreferences.instance.setLanguage('fr');
    await t.pumpWidget(app(SavedAdviceScreen(
        identity: Session.identityChanges.value,
        notes: const [
          {
            'diagnosis_text': 'Tuma',
            'advice_text': 'Andika ujumbe',
            'red_flags': 'Dharura'
          }
        ])));
    await t.pumpAndSettle();
    expect(find.text('Conseils enregistrés'), findsOneWidget);
    expect(find.text('Tuma'), findsOneWidget);
    expect(find.text('Andika ujumbe'), findsOneWidget);
    expect(find.text('• Dharura'), findsOneWidget);
  });
  testWidgets('French settings support narrow large text without overflow',
      (t) async {
    await AppPreferences.instance.setLanguage('fr');
    t.view.physicalSize = const Size(320, 800);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    await t.pumpWidget(app(MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
        child: const AppSettingsScreen())));
    await t.pumpAndSettle();
    await t.ensureVisible(find.text('Mode sombre'));
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);
  });
}
