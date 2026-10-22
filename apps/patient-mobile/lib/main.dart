import 'package:flutter/material.dart';
import 'core/api.dart';
import 'core/config.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'core/strings.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

final navigatorKey = GlobalKey<NavigatorState>();

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  Config.validateForCurrentBuild();
  runApp(const AHealthApp());
}

class AHealthApp extends StatefulWidget {
  const AHealthApp({super.key});

  @override
  State<AHealthApp> createState() => _AHealthAppState();
}

class _AHealthAppState extends State<AHealthApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Anything queued while offline goes out as soon as the app opens, before
    // the patient has to think about it.
    unawaitedFlush();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaitedFlush();
  }

  void unawaitedFlush() {
    Api.flushOutbox();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: S.appName,
      theme: buildTheme(),
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      home: FutureBuilder<String?>(
        future: Session.accessToken(),
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Scaffold(body: Center(child: CircularProgressIndicator()));
          }
          return snap.data == null ? const LoginScreen() : const HomeScreen();
        },
      ),
    );
  }
}
