// Native visual fixture. Synthetic data and in-memory session only.
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/messages_screen.dart';

import '../test/fixtures/messages_fixture.dart';

final previewTheme = ValueNotifier(ThemeMode.light);
final previewScale = ValueNotifier(1.0);
final previewNavigator = GlobalKey<NavigatorState>();
final previewBoundary = GlobalKey();
final previewScroll = ScrollController();
final previewRepository = MessagesFixture();
final previewVersion = ValueNotifier(0);
String previewCaptureState = '';
void previewBottom() =>
    previewScroll.jumpTo(previewScroll.position.maxScrollExtent);
void previewTop() => previewScroll.jumpTo(0);
void previewReturn() =>
    previewNavigator.currentState!.popUntil((route) => route.isFirst);
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
  Api.useDioForTesting(Dio()
    ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      h.resolve(Response(requestOptions: o, statusCode: 422, data: {}));
    })));
  await Session.save(
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      user: {'id': 'synthetic-messages', 'role': 'patient'});
  runApp(ValueListenableBuilder<ThemeMode>(
      valueListenable: previewTheme,
      builder: (_, mode, __) => MaterialApp(
          navigatorKey: previewNavigator,
          debugShowCheckedModeBanner: false,
          theme: buildTheme(),
          darkTheme: buildDarkTheme(),
          themeMode: mode,
          builder: (context, child) => ValueListenableBuilder<double>(
              valueListenable: previewScale,
              builder: (context, scale, _) => MediaQuery(
                  data: MediaQuery.of(context)
                      .copyWith(textScaler: TextScaler.linear(scale)),
                  child: RepaintBoundary(key: previewBoundary, child: child!))),
          home: PrimaryScrollController(
              controller: previewScroll,
              child: ValueListenableBuilder<int>(
                  valueListenable: previewVersion,
                  builder: (_, version, __) => MessagesScreen(
                      key: ValueKey(version),
                      repository: previewRepository))))));
}
