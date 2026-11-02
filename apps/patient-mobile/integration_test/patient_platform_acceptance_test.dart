import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/patient_community_screen.dart';
import 'package:a_health_patient/screens/feedback_tracking_screen.dart';
import 'package:a_health_patient/screens/patient_updates_screen.dart';
import 'package:a_health_patient/screens/education_screen.dart';
import 'package:a_health_patient/screens/pharmacy_map_screen.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  var consent = false, accepted = false, converted = false;
  final requests = <Map<String, dynamic>>[];
  final space = {
    'id': '11111111-1111-4111-8111-111111111111',
    'name': 'Elimu na ustawi wa afya',
    'description': 'Mfano wa majaribio: afya, kinga na maisha ya kila siku.',
    'joined': true
  };
  final article = {
    'slug': 'synthetic-disease',
    'title': 'Ugonjwa wa mfano',
    'summary': 'Maudhui ya majaribio ya muonekano tu. Si ushauri wa kitabibu.',
    'language': 'sw',
    'topic_slug': 'prevention',
    'reviewed_at': '2026-10-26',
    'body': null,
    'disease_guide': {
      'causes':
          'Maelezo ya sababu kwa lugha rahisi. Huu ni mfano wa majaribio.',
      'symptoms': 'Maelezo ya dalili yatakayoidhinishwa na daktari.',
      'prevention': 'Maelezo ya kinga yaliyoidhinishwa.',
      'diagnosis': 'Maelezo ya uchunguzi wa kitaalamu.',
      'treatment': 'Chaguo za matibabu yanahitaji mapitio ya daktari.',
      'warning_signs': 'Maelezo ya dalili za hatari na hatua za kuchukua.'
    },
    'sources': [
      {'title': 'Chanzo cha mfano', 'url': 'https://example.org'}
    ]
  };
  setUpAll(() {
    FlutterSecureStorage.setMockInitialValues({});
    Api.connectivityProbeForTesting = () async => true;
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
        final p = Uri.parse(o.path).path;
        final body = o.data is Map
            ? Map<String, dynamic>.from(o.data)
            : <String, dynamic>{};
        requests.add({'path': p, 'method': o.method, ...body});
        dynamic result;
        if (p.endsWith('/profile')) {
          result = {
            'profile': consent
                ? {
                    'alias': 'Mwanajamii',
                    'consentVersion': 'health-community-2026-10-v1',
                    'peerEnabled': true
                  }
                : null,
            'consent_version': 'health-community-2026-10-v1'
          };
        } else if (p.endsWith('/consent')) {
          consent = body['consent'] == true;
          result = {'ok': true};
        } else if (p.endsWith('/spaces')) {
          result = {
            'data': [space]
          };
        } else if (p.endsWith('/posts')) {
          result = {
            'data': [
              {
                'id': '22222222-2222-4222-8222-222222222222',
                'author_alias': 'Daktari wa mfano',
                'author_role': 'clinician',
                'body':
                    'Tunawezaje kujenga tabia za afya katika maisha ya kila siku? Huu ni mjadala wa majaribio.',
                'status': 'approved',
                'parentId': null,
                'mine': false
              },
              {
                'id': '33333333-3333-4333-8333-333333333333',
                'author_alias': 'Mwanajamii',
                'author_role': 'patient',
                'body': 'Ningependa kujifunza zaidi kuhusu kinga.',
                'status': 'pending',
                'parentId': null,
                'mine': true
              }
            ],
            'next_cursor': null
          };
        } else if (p.endsWith('/peers')) {
          result = {
            'data': [
              {
                'id': '44444444-4444-4444-8444-444444444444',
                'alias': 'Rafiki wa mfano',
                'status': accepted ? 'accepted' : 'pending',
                'incoming': true
              }
            ]
          };
        } else if (p.endsWith('/decision')) {
          accepted = body['accept'] == true;
          result = {'ok': true};
        } else if (p.endsWith('/messages')) {
          result = o.method == 'GET'
              ? {
                  'data': [
                    {
                      'id': '55555555-5555-4555-8555-555555555555',
                      'body':
                          'Habari! Huu ni ujumbe wa majaribio, bila taarifa za mgonjwa.',
                      'mine': false,
                      'created_at': '2026-10-26T10:00:00Z'
                    }
                  ],
                  'next_cursor': null
                }
              : {'id': 'sent'};
        } else if (p.endsWith('/realtime/token')) {
          h.reject(DioException(
              requestOptions: o, type: DioExceptionType.connectionError));
          return;
        } else if (p == '/patient-platform/feedback') {
          result = o.method == 'GET'
              ? {
                  'data': [
                    {
                      'id': '66666666-6666-4666-8666-666666666666',
                      'subject': 'Pendekezo la huduma',
                      'kind': 'suggestion',
                      'body': 'Maoni ya mfano kwa majaribio.',
                      'status': 'in_review',
                      'escalated': false,
                      'history': [
                        {
                          'status': 'received',
                          'note': 'Imepokelewa',
                          'at': '2026-10-26'
                        },
                        {
                          'status': 'in_review',
                          'note': 'Timu inafanyia kazi pendekezo lako.',
                          'at': '2026-10-26'
                        }
                      ]
                    }
                  ]
                }
              : {'id': 'ticket'};
        } else if (p == '/education/topics') {
          result = {
            'data': [
              {'slug': 'prevention', 'name': 'Kinga', 'category': 'prevention'}
            ]
          };
        } else if (p == '/education/articles') {
          result = {
            'data': [article]
          };
        } else if (p.startsWith('/education/articles/')) {
          result = article;
        } else if (p == '/pharmacies') {
          result = {
            'data': [
              {
                'id': 'pharmacy-test',
                'name': 'Pharmacy ya mfano',
                'location': {'lat': -6.8, 'lng': 39.2},
                'contact_phone': null,
                'opening_hours': 'Mfano: 08:00–18:00'
              }
            ]
          };
        } else if (p == '/pharmacies/search-medication') {
          result = {
            'data': [
              {
                'pharmacy': {
                  'id': 'pharmacy-test',
                  'name': 'Pharmacy ya mfano',
                  'location': {'lat': -6.8, 'lng': 39.2}
                },
                'medication_name': 'Dawa ya mfano',
                'fulfillment_status': 'unknown',
                'quantity_on_hand': null,
                'last_reported_at': '2026-10-20T10:00:00Z'
              }
            ]
          };
        } else if (p.endsWith('/notifications')) {
          result = {
            'data': [
              {
                'id': 'notice',
                'templateKey': 'patient.feedback_updated',
                'createdAt': '2026-10-26T10:00:00Z'
              }
            ]
          };
        } else if (p.endsWith('/reports')) {
          result = {'data': []};
        } else {
          h.reject(DioException(
              requestOptions: o,
              type: DioExceptionType.badResponse,
              response: Response(requestOptions: o, statusCode: 404, data: {
                'error': {'message': 'Unexpected synthetic endpoint'}
              })));
          return;
        }
        h.resolve(Response(requestOptions: o, statusCode: 200, data: result));
      })));
  });
  Future<void> settle(WidgetTester t) async {
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 150));
    }
    expect(t.takeException(), isNull);
  }

  Future<void> mount(WidgetTester t, Widget screen,
      {bool dark = false, double scale = 1}) async {
    await t.pumpWidget(const SizedBox());
    await t.pumpWidget(MaterialApp(
        theme: buildTheme(),
        darkTheme: buildDarkTheme(),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        debugShowCheckedModeBanner: false,
        builder: (c, ch) => MediaQuery(
            data:
                MediaQuery.of(c).copyWith(textScaler: TextScaler.linear(scale)),
            child: ch!),
        home: screen));
    await settle(t);
  }

  Future<void> capture(WidgetTester t, String name) async {
    await settle(t);
    if (!converted) {
      await binding.convertFlutterSurfaceToImage();
      converted = true;
      await t.pump();
    }
    await binding.takeScreenshot(name);
  }

  testWidgets('patient platform native flows and privacy states', (t) async {
    if (const bool.fromEnvironment('EDUCATION_REVIEW_ONLY')) {
      await mount(
          t,
          const EducationArticleScreen(
              slug: 'synthetic-disease', language: 'sw', category: 'Kinga'));
      await capture(t, 'education-guide');
      await t.pumpWidget(const SizedBox());
      return;
    }
    await mount(t, const PatientCommunityScreen());
    await capture(t, 'community-consent');
    await t.enterText(find.byType(TextField), 'Mwanajamii');
    await t.tap(find.byType(CheckboxListTile));
    await t.ensureVisible(find.text('Hifadhi chaguo'));
    await t.tap(find.text('Hifadhi chaguo'));
    await settle(t);
    expect(
        requests.any((r) =>
            r['path'] == '/patient-platform/consent' && r['consent'] == true),
        isTrue);
    await capture(t, 'community-list');
    await t.tap(find.text('Fungua community'));
    await settle(t);
    expect(find.text('Inasubiri moderation'), findsOneWidget);
    await capture(t, 'community-posts');
    await mount(t, const PeerChatsScreen());
    await capture(t, 'peer-invitation');
    await t.tap(find.text('Kubali chat'));
    await settle(t);
    expect(find.text('accepted'), findsOneWidget);
    await t.tap(find.text('Rafiki wa mfano'));
    await settle(t);
    await capture(t, 'peer-chat');
    await mount(t, const FeedbackTrackingScreen());
    await t.enterText(find.byType(TextField).first, 'Pendekezo la mfano');
    await t.enterText(find.byType(TextField).last, 'Feedback ya majaribio tu.');
    await t.ensureVisible(find.text('Tuma feedback'));
    await t.tap(find.text('Tuma feedback'));
    await settle(t);
    expect(
        requests.any((r) =>
            r['path'] == '/patient-platform/feedback' && r['method'] == 'POST'),
        isTrue);
    await t.ensureVisible(find.text('Pendekezo la huduma'));
    await t.tap(find.text('Pendekezo la huduma'));
    await settle(t);
    await capture(t, 'feedback-tracking');
    await mount(t, const EducationScreen());
    await t.enterText(find.byType(TextField), 'mfano');
    await t.tap(find.byTooltip('Tafuta'));
    await settle(t);
    await capture(t, 'education-search');
    await t.tap(find.text('Ugonjwa wa mfano'));
    await settle(t);
    await capture(t, 'education-guide');
    await mount(t, const PharmacyMapScreen());
    await t.enterText(find.byType(TextField), 'Dawa ya mfano');
    await t.tap(find.byTooltip('Tafuta dawa'));
    await settle(t);
    expect(find.textContaining('Stock haijathibitishwa'), findsWidgets);
    await capture(t, 'pharmacy-stock');
    await t.tap(find.byTooltip('Ramani fullscreen'));
    await settle(t);
    await capture(t, 'pharmacy-fullscreen');
    await mount(t, const PatientCommunityScreen(), dark: true, scale: 1.3);
    await capture(t, 'community-dark-large');
    await mount(t, const PatientUpdatesScreen());
    await capture(t, 'patient-updates');
    await t.pumpWidget(const SizedBox());
  });
}
