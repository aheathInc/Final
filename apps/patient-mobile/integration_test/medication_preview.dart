// Emulator-only synthetic review harness. Never the deliverable entry point.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/core/medication_followup.dart';
import 'package:a_health_patient/screens/medication_followup_screen.dart';
import '../test/fixtures/medication_fixture.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});
  await AppPreferences.instance.load();
  await L.load();
  await Session.save(
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      user: {'id': 'synthetic-med-owner', 'role': 'patient'});
  await MedicationReminders.channel.invokeMethod('enable', {'enabled': false});
  runApp(const Preview());
}

class Preview extends StatefulWidget {
  const Preview({super.key});
  @override
  State<Preview> createState() => PreviewState();
}

class PreviewState extends State<Preview> {
  MedicationFixture repo = MedicationFixture();
  int generation = 0;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: AppPreferences.instance,
        builder: (_, __) => MaterialApp(
          locale: AppPreferences.instance.locale,
          supportedLocales: const [Locale('sw'), Locale('en'), Locale('fr')],
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          theme: buildTheme(),
          darkTheme: buildDarkTheme(),
          themeMode: AppPreferences.instance.themeMode,
          home: Builder(
              builder: (context) => Scaffold(
                    body: MedicationFollowupScreen(
                        key: ValueKey(generation), repository: repo),
                    floatingActionButton: PopupMenuButton<String>(
                      tooltip: 'Synthetic review controls',
                      icon: const Icon(Icons.science_outlined),
                      itemBuilder: (_) => [
                        for (final v in [
                          'sw',
                          'en',
                          'fr',
                          'light',
                          'dark',
                          'offline',
                          'normal',
                          'alarm'
                        ])
                          PopupMenuItem(value: v, child: Text('TEST $v'))
                      ],
                      onSelected: (v) async {
                        if (['sw', 'en', 'fr'].contains(v))
                          await AppPreferences.instance.setLanguage(v);
                        else if (v == 'light' || v == 'dark')
                          await AppPreferences.instance.setTheme(
                              v == 'dark' ? ThemeMode.dark : ThemeMode.light);
                        else if (v == 'alarm') {
                          await MedicationReminders.channel
                              .invokeMethod('permission');
                          await MedicationReminders.channel
                              .invokeMethod('enable', {'enabled': true});
                          await MedicationReminders.channel
                              .invokeMethod('replace', {
                            'owner': 'synthetic-med-owner',
                            'events': [
                              {
                                'id': 'synthetic-native-alarm',
                                'at': DateTime.now()
                                    .add(const Duration(seconds: 20))
                                    .millisecondsSinceEpoch,
                                'title': L.tr('Kikumbusho cha dawa'),
                                'body': L.tr(
                                    'Fungua A-Health uangalie ratiba yako na uthibitishe dozi. Usibadili maagizo ya daktari.')
                              }
                            ]
                          });
                          setState(() => generation++);
                        } else
                          setState(() {
                            repo = MedicationFixture()..fail = v == 'offline';
                            generation++;
                          });
                      },
                    ),
                  )),
        ),
      );
}
