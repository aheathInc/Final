// Physical-device visual fixture: no real patient session or network writes.
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:dio/dio.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/app_settings_screen.dart';
import 'package:a_health_patient/screens/profile_screen.dart';
import 'package:a_health_patient/screens/messages_screen.dart';
import 'package:a_health_patient/screens/login_screen.dart';
import '../test/fixtures/profile_fixture.dart';
import '../test/fixtures/messages_fixture.dart';

final previewScale = ValueNotifier(1.0);
final previewRoute = ValueNotifier('settings');
final previewBoundary = GlobalKey();
String previewCaptureState = '';
Future<void> previewLanguage(String language) =>
    AppPreferences.instance.setLanguage(language);
Future<void> previewDark(bool dark) =>
    AppPreferences.instance.setTheme(dark ? ThemeMode.dark : ThemeMode.light);
Future<void> previewLogin() async {
  await Session.clear();
  previewRoute.value = 'login';
}

Future<void> previewCapture(String name) async {
  previewCaptureState = 'running';
  await WidgetsBinding.instance.endOfFrame;
  final boundary = previewBoundary.currentContext!.findRenderObject()
      as RenderRepaintBoundary;
  final picture = await boundary.toImage(pixelRatio: 2);
  final bytes = await picture.toByteData(format: ui.ImageByteFormat.png);
  final path = '${Directory.systemTemp.path}/$name';
  await File(path).writeAsBytes(bytes!.buffer.asUint8List());
  picture.dispose();
  previewCaptureState = path;
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});
  await AppPreferences.instance.load();
  await L.load();
  Api.useDioForTesting(Dio()
    ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      h.resolve(Response(requestOptions: o, statusCode: 422, data: {}));
    })));
  await Session.save(
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      user: syntheticProfileAccount);
  runApp(ListenableBuilder(
      listenable: AppPreferences.instance,
      builder: (_, __) => MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: buildTheme(),
            darkTheme: buildDarkTheme(),
            themeMode: AppPreferences.instance.themeMode,
            locale: AppPreferences.instance.locale,
            supportedLocales: const [Locale('sw'), Locale('en'), Locale('fr')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            builder: (context, child) => ValueListenableBuilder<double>(
                valueListenable: previewScale,
                builder: (context, scale, _) => MediaQuery(
                    data: MediaQuery.of(context)
                        .copyWith(textScaler: TextScaler.linear(scale)),
                    child:
                        RepaintBoundary(key: previewBoundary, child: child!))),
            home: ValueListenableBuilder<String>(
                valueListenable: previewRoute,
                builder: (_, route, __) => switch (route) {
                      'profile' => ProfileScreen(repository: ProfileFixture()),
                      'messages' =>
                        MessagesScreen(repository: MessagesFixture()),
                      'login' => const LoginScreen(),
                      _ => const AppSettingsScreen(),
                    }),
          )));
}
