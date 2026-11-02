// Requires the local synthetic peer helper and adb reverse tcp:4040 tcp:4040.
// The helper holds test credentials in memory; no real patient account is used.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:integration_test/integration_test.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/consultation_call_screen.dart';
import 'consultation_modes_live_test.dart' show exportCapture;

Future<Map<String, dynamic>> peer(String path, {bool post = false}) async {
  final client = HttpClient();
  try {
    final request = await client.openUrl(post ? 'POST' : 'GET', Uri.parse('http://127.0.0.1:4040$path'));
    final response = await request.close();
    final body = await response.transform(utf8.decoder).join();
    if (response.statusCode != 200) throw StateError('Local peer HTTP ${response.statusCode}');
    return Map<String, dynamic>.from(jsonDecode(body) as Map);
  } finally { client.close(); }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('patient answers doctor calls, exchanges media and toggles fullscreen', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    late Map<String, dynamic> fixture;
    await tester.runAsync(() async {
      fixture = await peer('/fixture');
      await Session.save(accessToken: fixture['token'] as String, refreshToken: 'synthetic-unused', user: Map<String,dynamic>.from(fixture['user'] as Map));
    });
    for (final mode in ['video', 'voice']) {
      final id = (fixture['consultations'] as Map)[mode] as String;
      await tester.runAsync(() async { await peer('/prepare/$id', post: true); });
      await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: ConsultationCallScreen(key: ValueKey(id), consultationId: id, video: mode == 'video')));
      expect(find.text('Anza call'), findsNothing);
      for (var i = 0; i < 30; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 1))); await tester.pump();
        if (find.text('Pokea call').evaluate().isNotEmpty) break;
      }
      expect(find.text('Pokea call'), findsOneWidget);
      if (mode == 'video') {
        await binding.convertFlutterSurfaceToImage(); await tester.pumpAndSettle();
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 500)));
        final waiting = await binding.takeScreenshot('doctor-incoming-phone');
        await tester.runAsync(() => exportCapture('doctor-incoming-phone.png', waiting));
        if (const bool.fromEnvironment('CAPTURE_INCOMING_ONLY')) {
          await tester.tap(find.byTooltip('Kataa call')); await tester.pump();
          await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
          await tester.pumpWidget(const SizedBox()); await tester.pump();
          return;
        }
      }
      await tester.tap(find.text('Pokea call')); await tester.pump();
      Map<String, dynamic>? status;
      for (var i = 0; i < 75; i++) {
        await tester.runAsync(() async { await Future<void>.delayed(const Duration(seconds: 1)); status = await peer('/status/$id'); });
        await tester.pump();
        if (find.text('Umeunganishwa').evaluate().isNotEmpty) break;
      }
      expect(find.text('Umeunganishwa'), findsOneWidget, reason: 'Peer state: $status');
      await tester.runAsync(() async { await Future<void>.delayed(const Duration(seconds: 3)); status = await peer('/status/$id'); });
      final media = status!['media'] as Map;
      for (final kind in ['audio', if (mode == 'video') 'video']) {
        expect((media['inbound'] as List).any((s) => s['kind'] == kind && (s['bytes'] as num) > 0), isTrue, reason: 'Phone sends $kind');
        expect((media['outbound'] as List).any((s) => s['kind'] == kind && (s['bytes'] as num) > 0), isTrue, reason: 'Browser sends $kind');
      }
      await tester.tap(find.byTooltip('Zima microphone')); await tester.pump();
      expect(find.text('Washa microphone'), findsOneWidget);
      if (mode == 'video') {
        for (final frontCamera in [false, true]) {
          await tester.tap(find.byTooltip('Geuza kamera'));
          await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 1)));
          await tester.pumpAndSettle();
          expect(tester.widgetList<RTCVideoView>(find.byType(RTCVideoView)).last.mirror, frontCamera);
        }
        // Hide the real phone camera before saving any active-call UI capture.
        await tester.tap(find.byTooltip('Zima kamera')); await tester.pump();
        expect(find.text('Washa kamera'), findsOneWidget);
        await tester.pumpAndSettle();
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
        await tester.pumpAndSettle();
        final normal = await binding.takeScreenshot('doctor-call-phone');
        await tester.runAsync(() => exportCapture('doctor-call-phone.png', normal));
        await tester.tap(find.byTooltip('Fullscreen')); await tester.pump();
        expect(find.byType(AppBar), findsNothing);
        expect(find.byTooltip('Maliza call'), findsOneWidget);
        await tester.pumpAndSettle();
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
        await tester.pumpAndSettle();
        final fullscreen = await binding.takeScreenshot('doctor-call-fullscreen-phone');
        await tester.runAsync(() => exportCapture('doctor-call-fullscreen-phone.png', fullscreen));
        await tester.tap(find.byTooltip('Ondoka fullscreen')); await tester.pump();
        expect(find.byType(AppBar), findsOneWidget);
        expect(find.text('Umeunganishwa'), findsOneWidget);
      }
      await tester.tap(find.byTooltip('Maliza call')); await tester.pump();
      await tester.runAsync(() async { await Future<void>.delayed(const Duration(seconds: 3)); status = await peer('/status/$id'); });
      await tester.pump(); expect(status!['ended'], isTrue);
      await tester.pumpWidget(const SizedBox()); await tester.pump();
      expect(tester.takeException(), isNull);
    }
  });
}
