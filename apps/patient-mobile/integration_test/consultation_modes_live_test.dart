import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:integration_test/integration_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/patient_care.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/new_consultation_screen.dart';
import 'package:a_health_patient/screens/consultation_detail_screen.dart';
import 'package:a_health_patient/screens/consultation_call_screen.dart';

Future<void> exportCapture(String name, List<int> bytes) async {
  if (!const bool.fromEnvironment('EXPORT_MODE_SCREENSHOTS')) return;
  final client = HttpClient();
  try {
    final request = await client.postUrl(Uri.parse('http://127.0.0.1:4041/$name'));
    request.add(bytes);
    final response = await request.close();
    if (response.statusCode != 200) throw StateError('Capture export failed');
    await response.drain<void>();
  } finally { client.close(); }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('physical phone consultation modes and live request contract', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    late Map<String, dynamic> directory;
    await tester.runAsync(() async {
      final registration = await Api.post('/auth/register/patient', {
        'phone_number': '+2557${Random.secure().nextInt(90000000) + 10000000}',
        'full_name': 'AHP Synthetic Modes Phone', 'preferred_language': 'sw', 'channel': 'sms',
      }, idempotencyKey: 'phone-register-${DateTime.now().microsecondsSinceEpoch}') as Map;
      if (registration['dev_code'] is! String) throw StateError('This test requires local console OTP.');
      final session = await Api.post('/auth/otp/verify', {'challenge_id': registration['challenge_id'], 'code': registration['dev_code'], 'device_id': 'modes-phone-test'}) as Map;
      await Session.save(accessToken: session['access_token'] as String, refreshToken: session['refresh_token'] as String, user: Map<String, dynamic>.from(session['user'] as Map));
      directory = await PatientCareRepository().consultationOptions();
    });
    final facility = (directory['facilities'] as List).firstWhere((f) => (f['name'] as String).contains('Consultation Modes Hospital')) as Map;
    const dark = bool.fromEnvironment('DARK_MODE_REVIEW');
    final theme = dark ? buildDarkTheme() : buildTheme();
    await tester.pumpWidget(MaterialApp(theme: theme, home: NewConsultationScreen(facilityId: facility['id'] as String, facilityName: facility['name'] as String)));
    await tester.pumpAndSettle();
    await tester.runAsync(() async { await Future<void>.delayed(const Duration(seconds: 2)); }); await tester.pumpAndSettle();
    await tester.tap(find.text('Hospital consultation')); await tester.pumpAndSettle();
    await binding.convertFlutterSurfaceToImage(); await tester.pumpAndSettle();
    final hospital = await binding.takeScreenshot('consultation-hospital-phone');
    await tester.runAsync(() async {
      final dir = Directory('${Directory.systemTemp.path}/modes-review'); await dir.create(recursive: true);
      await File('${dir.path}/hospital-phone.png').writeAsBytes(hospital);
      await exportCapture(dark ? 'hospital-dark-phone.png' : 'hospital-phone.png', hospital);
    });
    await tester.tap(find.text('Remote consultation')); await tester.pumpAndSettle();
    await tester.tap(find.text('Video call')); await tester.pumpAndSettle();
    final remote = await binding.takeScreenshot('consultation-remote-phone');
    await tester.runAsync(() async {
      await File('${Directory.systemTemp.path}/modes-review/remote-phone.png').writeAsBytes(remote);
      await exportCapture(dark ? 'remote-dark-phone.png' : 'remote-phone.png', remote);
    });
    await tester.scrollUntilVisible(find.textContaining('TZS 5000'), 100, scrollable: find.byType(Scrollable).first);
    expect(find.textContaining('TZS 5000'), findsOneWidget);
    Map<String, dynamic>? pendingRemote;
    await tester.runAsync(() async {
      final repository = PatientCareRepository();
      for (final mode in ['hospital', 'remote']) {
        final response = await repository.createConsultation(opId: 'phone-mode-$mode-${DateTime.now().microsecondsSinceEpoch}', body: {
          'channel': 'app', 'consultation_mode': mode, 'modality': mode == 'hospital' ? 'in_person' : 'video',
          if (mode == 'hospital') 'facility_id': facility['id'], 'symptom_text': 'SYNTHETIC ONLY — USB phone mode acceptance',
        });
        expect(response.data['consultation_mode'], mode);
        expect(response.data['consultation_fee_required'], mode == 'remote');
        if (mode == 'hospital') expect(response.data['consultation_fee_amount'], 0);
        if (mode == 'remote') pendingRemote = response.data;
      }
    });
    if (dark) {
      await tester.pumpWidget(MaterialApp(theme: theme, home: ConsultationDetailScreen(consultation: pendingRemote!)));
      await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2))); await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Inasubiri daktari kukubali ombi. Kitufe kitawashwa ombi likikubaliwa.'), 150, scrollable: find.byType(Scrollable).first);
      final pending = await binding.takeScreenshot('pending-dark-phone');
      await tester.runAsync(() => exportCapture('pending-dark-phone.png', pending));
      await tester.pumpWidget(MaterialApp(theme: theme, home: ConsultationCallScreen(consultationId: pendingRemote!['id'] as String, video: false)));
      await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2))); await tester.pumpAndSettle();
      final call = await binding.takeScreenshot('call-dark-phone');
      await tester.runAsync(() => exportCapture('call-dark-phone.png', call));
    }
    expect(tester.takeException(), isNull);
  });
}
