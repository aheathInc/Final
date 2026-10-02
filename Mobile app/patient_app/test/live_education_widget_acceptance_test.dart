import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/config.dart';
import 'package:a_health_patient/core/patient_experience.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/education_screen.dart';

class _LiveHttpOverrides extends HttpOverrides {}

void main() {
  testWidgets('live Education widget renders published API item only',
      (tester) async {
    await HttpOverrides.runWithHttpOverrides(() async {
      final sessionFile =
          File('../../Web/.local/evidence/patient-a-session.json');
      expect(sessionFile.existsSync(), isTrue,
          reason: 'Run the legitimate local Patient A OTP flow first.');
      final session =
          jsonDecode(sessionFile.readAsStringSync()) as Map<String, dynamic>;
      final token = session['access_token'] as String;
      FlutterSecureStorage.setMockInitialValues({});
      await Session.save(
        accessToken: token,
        refreshToken: session['refresh_token'] as String,
        user: {
          'id': session['user_id'],
          'role': 'patient',
          'full_name': session['full_name'],
          'patient_profile_id': session['profile_id'],
        },
      );
      Api.diagnostic = (event, {int? status, String? errorType}) {
        debugPrint(
            '$event${status == null ? '' : ' status=$status'}${errorType == null ? '' : ' type=$errorType'}');
      };

      const publishedSlug = 'ahp-synthetic-health-education-published';
      const draftSlug = 'ahp-synthetic-health-education-draft';
      final listUrl =
          '${Config.baseUrlFor('/education/articles')}/education/articles?limit=100';
      debugPrint('REQUEST_STARTED');
      final client = HttpClient();
      final direct = await tester.runAsync(() async {
        final request = await client.getUrl(Uri.parse(listUrl));
        request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
        final response = await request.close();
        final raw = await response.transform(utf8.decoder).join();
        return (response.statusCode, jsonDecode(raw));
      });
      debugPrint('HTTP_STATUS=${direct!.$1}');
      debugPrint('BODY_DECODED=true');
      final directArticles = educationArticlesFromJson(direct.$2);
      debugPrint('MODEL_PARSED=${directArticles.isNotEmpty}');
      final published = directArticles.singleWhere(
        (article) => article['slug'] == publishedSlug,
      );
      final apiList = await tester.runAsync(
          () => Api.get('/education/articles', query: {'limit': 100}));
      final repositoryArticles = educationArticlesFromJson(apiList);
      expect(repositoryArticles.any((a) => a['slug'] == publishedSlug), isTrue);
      expect(repositoryArticles.any((a) => a['slug'] == draftSlug), isFalse);

      final events = <String>[];
      await tester.runAsync(() async {
        final state = Completer<void>();
        await tester.pumpWidget(MaterialApp(
          home: EducationScreen(
              onDiagnostic: (event, {int? status, String? errorType}) {
            events.add(event);
            if (event == 'STATE_ERROR') {
              debugPrint('STATE_ERROR_TYPE=$errorType');
              debugPrint('STATE_ERROR_HTTP_STATUS=${status ?? 'none'}');
            }
            if (event == 'STATE_SUCCESS') {
              debugPrint('STATE_SUCCESS=true');
            }
            if ((event == 'STATE_SUCCESS' || event == 'STATE_ERROR') &&
                !state.isCompleted) {
              state.complete();
            }
          }),
        ));
        await state.future.timeout(const Duration(seconds: 25));
      });
      await tester.pump();
      final rendered =
          find.text(published['title'] as String).evaluate().isNotEmpty;
      debugPrint('WIDGET_RENDERED=$rendered');
      expect(events, contains('REQUEST_STARTED'));
      expect(rendered, isTrue);
      expect(find.textContaining('Draft'), findsNothing);
      final draftStatus = await tester.runAsync(() async {
        try {
          await Api.get('/education/articles/$draftSlug',
              query: {'language': 'en'});
          return 200;
        } on ApiException catch (error) {
          return error.status;
        }
      });
      expect(draftStatus, 404);
      client.close(force: true);
      Api.diagnostic = null;
      debugPrint('DRAFT_ABSENT=true');
    }, _LiveHttpOverrides());
  },
      skip:
          Platform.environment['AHP_RUN_LIVE_EDUCATION_ACCEPTANCE'] != 'true' ||
              !File('../../Web/.local/evidence/patient-a-session.json')
                  .existsSync());
}
