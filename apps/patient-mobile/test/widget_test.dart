// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter_test/flutter_test.dart';

import 'package:a_health_patient/main.dart';
import 'package:a_health_patient/screens/facility_browser_screen.dart';

void main() {
  testWidgets('App load smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const AHealthApp());
  });

  test('facility location label handles map payloads without crashing', () {
    expect(
      facilityLocationLabel({'location': {'lat': -6.801, 'lng': 39.208}}),
      contains('Lat -6.801'),
    );
    expect(
      facilityLocationLabel({'location': 'Mwanza'}),
      'Mwanza',
    );
    expect(
      facilityLocationLabel({}),
      'Eneo halijulikani',
    );
  });
}
