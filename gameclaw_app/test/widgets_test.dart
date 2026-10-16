import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/theme/tokens.dart';
import 'package:gameclaw_app/ui/components/gc_button.dart';
import 'package:gameclaw_app/ui/components/gc_fixture_row.dart';
import 'package:gameclaw_app/ui/components/gc_states.dart';
import 'package:gameclaw_app/data/api_client.dart';

/// Layout tests for the widgets that repeat.
///
/// These exist because the two things most likely to break a dense dark UI cannot be seen on the
/// one phone it was built on: a small screen, and a user who has turned their system font up.
/// Flutter reports an overflow as an exception during paint, so a test that renders a row at
/// 320dp with a 2x text scale and then asserts no exception is a real check, not a smoke test.
void main() {
  Fixture fixture({
    String home = 'Western Sydney Wanderers',
    String away = 'Central Coast Mariners',
    String status = 'LIVE',
    String label = "45+2'",
    int? homeGoals,
    int? awayGoals,
  }) => Fixture.fromJson({
    'id': 1,
    'kickoffAt': '2026-10-16T18:45:00.000Z',
    'status': status,
    'statusLabel': label,
    'league': {'id': 1, 'name': 'A-League', 'country': 'Australia', 'season': 2026},
    'home': {'id': 1, 'name': home},
    'away': {'id': 2, 'name': away},
    if (homeGoals != null) 'goals': {'home': homeGoals, 'away': awayGoals},
  });

  /// Renders [child] at a given logical width and text scale, as a real screen would.
  Future<void> pumpAt(
    WidgetTester tester,
    Widget child, {
    required double width,
    double textScale = 1.0,
    double height = 640,
  }) async {
    tester.view.physicalSize = Size(width, height);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: gcTheme(),
        home: MediaQuery(
          data: MediaQueryData(size: Size(width, height), textScaler: TextScaler.linear(textScale)),
          child: Scaffold(body: child),
        ),
      ),
    );
  }

  group('the fixture row survives the screens it will actually meet', () {
    // 320dp is about the narrowest Android phone still in use.
    for (final width in [320.0, 360.0, 412.0]) {
      testWidgets('no overflow at ${width.toInt()}dp', (tester) async {
        await pumpAt(tester, GcFixtureRow(fixture: fixture()), width: width);
        expect(tester.takeException(), isNull);
      });
    }

    for (final scale in [1.0, 1.3, 2.0]) {
      testWidgets('no overflow at ${scale}x text on a narrow screen', (tester) async {
        // Someone with poor eyesight on a small phone is the hardest case, and the one most
        // likely to be shipped broken.
        await pumpAt(tester, GcFixtureRow(fixture: fixture()), width: 320, textScale: scale);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('a long team name is truncated rather than pushing the score off', (tester) async {
      await pumpAt(
        tester,
        GcFixtureRow(
          fixture: fixture(
            home: 'Borussia Moenchengladbach II Reserves',
            homeGoals: 2,
            awayGoals: 1,
          ),
        ),
        width: 320,
      );
      expect(tester.takeException(), isNull);
      // The score must still be on screen: it is the reason the row exists.
      expect(find.text('2'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
    });
  });

  group('what the row says', () {
    testWidgets('a match with no score shows a dash, never a zero', (tester) async {
      await pumpAt(
        tester,
        GcFixtureRow(
          fixture: fixture(status: 'SCHEDULED', label: 'Not Started'),
        ),
        width: 360,
      );
      expect(find.text('–'), findsOneWidget);
      expect(find.text('0'), findsNothing);
    });

    testWidgets('a genuine nil-nil shows zeros', (tester) async {
      await pumpAt(
        tester,
        GcFixtureRow(
          fixture: fixture(status: 'FINISHED', label: 'Match Finished', homeGoals: 0, awayGoals: 0),
        ),
        width: 360,
      );
      expect(find.text('0'), findsNWidgets(2));
      expect(find.text('–'), findsNothing);
    });

    testWidgets("a live match shows the provider's own clock", (tester) async {
      await pumpAt(tester, GcFixtureRow(fixture: fixture(label: "45+2'")), width: 360);
      expect(find.text("45+2'"), findsOneWidget);
    });

    testWidgets('a finished match reads FT rather than a kickoff time', (tester) async {
      await pumpAt(
        tester,
        GcFixtureRow(
          fixture: fixture(status: 'FINISHED', label: 'Match Finished', homeGoals: 1, awayGoals: 0),
        ),
        width: 360,
      );
      expect(find.text('FT'), findsOneWidget);
    });

    testWidgets('the star is absent unless following is possible', (tester) async {
      await pumpAt(tester, GcFixtureRow(fixture: fixture()), width: 360);
      expect(find.byIcon(Icons.star_outline_rounded), findsNothing);

      await pumpAt(tester, GcFixtureRow(fixture: fixture(), onToggleFavourite: () {}), width: 360);
      expect(find.byIcon(Icons.star_outline_rounded), findsOneWidget);
    });
  });

  group('a failure offers the one action that resolves it', () {
    testWidgets('being offline offers a retry', (tester) async {
      await pumpAt(tester, GcError(error: const OfflineFailure(), onRetry: () {}), width: 360);
      expect(find.text('No connection'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('signing in is offered instead of a pointless retry', (tester) async {
      await pumpAt(tester, GcError(error: const UnauthorizedFailure(), onRetry: () {}), width: 360);
      expect(find.text('Sign in'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('the age gate is offered, not the sign-in screen again', (tester) async {
      await pumpAt(
        tester,
        GcError(
          error: const AgeNotConfirmedFailure('Please confirm you are 18 or older.'),
          onRetry: () {},
        ),
        width: 360,
      );
      expect(find.text('Confirm'), findsOneWidget);
      expect(find.text('Sign in'), findsNothing);
    });

    testWidgets('a self-exclusion has deliberately nothing to press', (tester) async {
      await pumpAt(
        tester,
        GcError(
          error: const ForbiddenFailure("You're taking a break until 2026-12-01."),
          onRetry: () {},
        ),
        width: 360,
      );
      expect(find.textContaining('2026-12-01'), findsOneWidget);
      expect(find.widgetWithText(GcButton, 'Try again'), findsNothing);
      expect(find.widgetWithText(GcButton, 'Sign in'), findsNothing);
    });
  });

  group('a button cannot be submitted twice', () {
    testWidgets('a second tap during an in-flight action is ignored', (tester) async {
      // A user on a slow connection taps a dead-looking button again. Without the guard that is
      // two slips built, or two conversions.
      var calls = 0;
      final gate = Completer<void>();

      await pumpAt(
        tester,
        GcButton(
          label: 'Build slip',
          onPressed: () async {
            calls++;
            await gate.future;
          },
        ),
        width: 360,
      );

      await tester.tap(find.byType(GcButton));
      await tester.pump();
      await tester.tap(find.byType(GcButton));
      await tester.tap(find.byType(GcButton));
      await tester.pump();

      expect(calls, 1);

      gate.complete();
      await tester.pumpAndSettle();

      // And it is live again once the action settles.
      await tester.tap(find.byType(GcButton));
      await tester.pump();
      expect(calls, 2);
    });

    testWidgets('a disabled button does not fire', (tester) async {
      var calls = 0;
      await pumpAt(tester, GcButton(label: 'Continue', onPressed: null), width: 360);
      await tester.tap(find.byType(GcButton));
      await tester.pump();
      expect(calls, 0);
    });
  });

  group('empty states say which kind of nothing', () {
    testWidgets('an empty state renders its action only when there is one', (tester) async {
      await pumpAt(
        tester,
        const GcEmpty(title: 'No teams followed yet', note: 'Tap the star beside any match.'),
        width: 320,
        textScale: 1.6,
      );
      expect(tester.takeException(), isNull);
      expect(find.byType(GcButton), findsNothing);

      await pumpAt(
        tester,
        GcEmpty(
          title: 'No teams followed yet',
          note: 'Tap the star beside any match.',
          actionLabel: 'Find matches',
          onAction: () {},
        ),
        width: 320,
      );
      expect(find.text('Find matches'), findsOneWidget);
    });
  });
}
