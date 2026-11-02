import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/widgets/consultation_call_action.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final status in ['pending', 'offered', 'escalated', 'matched', 'in_progress']) {
    testWidgets('video entry is visible for $status; acceptance controls joining', (tester) async {
      var joined = false;
      await tester.pumpWidget(MaterialApp(theme: buildDarkTheme(), home: Scaffold(body: ConsultationCallAction(
        consultation: {'consultation_mode': 'remote', 'modality': 'video', 'status': status},
        onJoin: () => joined = true))));
      expect(find.text('Jiunge na video call'), findsOneWidget);
      final ready = ['matched', 'in_progress'].contains(status);
      expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed != null, ready);
      await tester.tap(find.text('Jiunge na video call'));
      expect(joined, ready);
      expect(find.textContaining('Inasubiri daktari'), ready ? findsNothing : findsOneWidget);
    });
  }
  testWidgets('hospital, chat and ended consultations do not offer a call', (tester) async {
    for (final data in [
      {'consultation_mode': 'hospital', 'modality': 'in_person', 'status': 'matched'},
      {'consultation_mode': 'remote', 'modality': 'chat', 'status': 'matched'},
      {'consultation_mode': 'remote', 'modality': 'video', 'status': 'completed'},
      {'consultation_mode': 'remote', 'modality': 'video', 'status': 'cancelled'},
    ]) {
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: ConsultationCallAction(consultation: data, onJoin: () => fail('Not eligible')))));
      expect(find.byType(FilledButton), findsNothing);
    }
  });
  testWidgets('accepted audio consultation has its own action label', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ConsultationCallAction(
      consultation: const {'consultation_mode': 'remote', 'modality': 'voice', 'status': 'matched'}, onJoin: () {}))));
    expect(find.text('Jiunge na audio call'), findsOneWidget);
  });
}
