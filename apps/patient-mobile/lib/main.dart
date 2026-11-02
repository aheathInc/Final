import 'package:flutter/material.dart';
import 'core/api.dart';
import 'core/config.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'core/strings.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'screens/registration_screen.dart';
import 'screens/security_screen.dart';
import 'core/biometrics.dart';
import 'core/app_preferences.dart';
import 'core/l10n.dart';
import 'core/medication_followup.dart';
import 'screens/medication_followup_screen.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

final navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  Config.validateForCurrentBuild();
  await AppPreferences.instance.load();
  await L.load();
  await Session.restoreLock();
  runApp(const AHealthApp());
}

class AHealthApp extends StatefulWidget {
  const AHealthApp({super.key});

  @override
  State<AHealthApp> createState() => _AHealthAppState();
}

class _AHealthAppState extends State<AHealthApp> with WidgetsBindingObserver {
  late final Future<String?> _accessFuture;
  late final Future<String?> _registrationFuture;
  bool _medicationOpen = false;
  @override
  void initState() {
    super.initState();
    _accessFuture = Session.accessToken();
    _registrationFuture = Session.registrationToken();
    WidgetsBinding.instance.addObserver(this);
    Session.locked.addListener(_unlocked);
    MedicationReminders.initialize(() =>
        WidgetsBinding.instance.addPostFrameCallback((_) => _openMedication()));
    // Anything queued while offline goes out as soon as the app opens, before
    // the patient has to think about it.
    unawaitedFlush();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if ((state == AppLifecycleState.inactive ||
            state == AppLifecycleState.paused) &&
        Session.biometricEnabled &&
        !Biometrics.authenticating) {
      if (MedicationReminders.requestingPermission) return;
      Session.locked.value = true;
    }
    if (state == AppLifecycleState.resumed) {
      unawaitedFlush();
      _unlocked();
    }
  }

  void unawaitedFlush() {
    Api.flushOutbox();
    MedicationReminders.refresh();
  }

  void _unlocked() {
    if (!Session.locked.value) {
      MedicationReminders.tryOpen();
      MedicationReminders.refresh();
    }
  }

  Future<void> _openMedication() async {
    if (_medicationOpen ||
        Session.locked.value ||
        !await Session.authenticated ||
        !mounted) return;
    if (navigatorKey.currentState == null) return;
    _medicationOpen = true;
    await navigatorKey.currentState!.push(
        MaterialPageRoute(builder: (_) => const MedicationFollowupScreen()));
    _medicationOpen = false;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    Session.locked.removeListener(_unlocked);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
        listenable: AppPreferences.instance,
        builder: (context, _) => MaterialApp(
              title: S.appName,
              theme: buildTheme(),
              darkTheme: buildDarkTheme(),
              themeMode: AppPreferences.instance.themeMode,
              locale: AppPreferences.instance.locale,
              supportedLocales: const [
                Locale('sw'),
                Locale('en'),
                Locale('fr')
              ],
              localizationsDelegates: GlobalMaterialLocalizations.delegates,
              navigatorKey: navigatorKey,
              debugShowCheckedModeBanner: false,
              builder: (context, child) => ValueListenableBuilder<bool>(
                  valueListenable: Session.locked,
                  builder: (context, locked, _) => Stack(children: [
                        Offstage(
                            offstage: locked, child: child ?? const SizedBox()),
                        if (locked) const BiometricLockScreen()
                      ])),
              home: FutureBuilder<String?>(
                future: _accessFuture,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) {
                    return const Scaffold(
                        body: Center(child: CircularProgressIndicator()));
                  }
                  if (snap.data != null) return const HomeScreen();
                  return FutureBuilder<String?>(
                      future: _registrationFuture,
                      builder: (context, registration) {
                        if (registration.connectionState !=
                            ConnectionState.done) {
                          return const Scaffold(
                              body: Center(child: CircularProgressIndicator()));
                        }
                        return registration.data == null
                            ? const LoginScreen()
                            : const RegistrationScreen();
                      });
                },
              ),
            ));
  }
}
