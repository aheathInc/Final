import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/widgets/premium.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('premium action is actionable and respects its label',
      (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
          body: PremiumAction(
            icon: Icons.calendar_month,
            title: 'Miadi',
            subtitle: 'Panga ziara',
            onTap: () => taps++,
          ),
        ),
      ),
    );

    expect(find.text('Miadi'), findsOneWidget);
    expect(find.text('Panga ziara'), findsOneWidget);
    await tester.tap(find.text('Miadi'));
    expect(taps, 1);
  });

  testWidgets('status displays the supplied label and urgency', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: PremiumStatus('Pending sync', urgent: true)),
      ),
    );

    expect(find.text('Pending sync'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics && widget.properties.label == 'Pending sync',
      ),
      findsOneWidget,
    );
  });

  testWidgets('link row navigates only when tapped', (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
          body: PremiumLinkRow(
            icon: Icons.history,
            title: 'Historia',
            onTap: () => taps++,
          ),
        ),
      ),
    );

    expect(taps, 0);
    await tester.tap(find.text('Historia'));
    expect(taps, 1);
  });

  testWidgets('aurora keeps its content readable with reduced motion',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: Scaffold(
            body: PremiumAuroraHero(
              child: Text(
                'Safari yangu ya afya',
                style: TextStyle(color: Colors.white),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Safari yangu ya afya'), findsOneWidget);
  });

  testWidgets('hero action invokes its callback', (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PremiumHeroButton(
            label: 'Anza huduma',
            onPressed: () => taps++,
          ),
        ),
      ),
    );

    await tester.tap(find.text('Anza huduma'));
    expect(taps, 1);
  });
}
