import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/theme/tokens.dart';
import 'package:gameclaw_app/ui/components/gc_special_pick_card.dart';

/// What the card must say out loud.
///
/// The failure this guards against is not a crash: it is a card where the bookmaker's price and
/// our estimate sit next to each other with no labels, so a 72% estimate reads as something the
/// bookmaker said. The three labels are the feature's one hard display rule, so they are asserted.
void main() {
  SpecialPick pickFrom({
    Map<String, dynamic>? price,
    String status = 'PENDING',
    num? actual,
    String outcome = 'OVER',
  }) => SpecialPick.fromJson({
    'position': 1,
    'match': {
      'home': 'Arsenal',
      'away': 'Chelsea',
      'competition': 'Premier League',
      'country': 'England',
      'kickoffAt': '2026-11-02T15:00:00.000Z',
    },
    'market': {
      'kind': 'CORNERS',
      'side': 'MATCH',
      'label': 'Match corners',
      'line': 9.5,
      'outcome': outcome,
    },
    'price':
        price ?? {'bookmaker': 'sportybet', 'odds': 1.9, 'checkedAt': '2026-11-02T07:00:00.000Z'},
    'probability': 0.721,
    'confidence': 'medium',
    'reason': "Over 9.5 in 7 of 8 matches (these sides' recent matches), averaging 12.1.",
    'evidence': {'mean': 12.1, 'sample': 8, 'hitRate': 0.875},
    'researchedAt': '2026-11-02T07:00:00.000Z',
    'status': status,
    'actual': actual,
  });

  Future<void> pump(WidgetTester tester, SpecialPick pick) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: gcTheme(brightness: Brightness.dark),
        home: Scaffold(body: SingleChildScrollView(child: GcSpecialPickCard(pick: pick))),
      ),
    );
  }

  testWidgets('the price, the estimate and the value are each labelled', (tester) async {
    await pump(tester, pickFrom());

    expect(find.text('Bookmaker odds'), findsOneWidget);
    expect(find.text('1.90'), findsOneWidget);
    expect(find.text('SportyBet'), findsOneWidget);

    expect(find.text('Our estimate'), findsOneWidget);
    expect(find.text('72%'), findsOneWidget);
    expect(find.text('medium confidence'), findsOneWidget);

    expect(find.text('Estimated value'), findsOneWidget);
    expect(find.text('+37%'), findsOneWidget);
  });

  testWidgets('the match, market and selection are all shown', (tester) async {
    await pump(tester, pickFrom());

    expect(find.text('Arsenal v Chelsea'), findsOneWidget);
    expect(find.textContaining('Match corners'), findsOneWidget);
    expect(find.textContaining('Over 9.5'), findsWidgets);
  });

  testWidgets('the research is shown in full, not truncated to a line', (tester) async {
    await pump(tester, pickFrom());
    expect(find.textContaining('7 of 8 matches'), findsOneWidget);
    expect(find.textContaining('averaging 12.1'), findsOneWidget);
  });

  testWidgets('a selection with no verified price says so instead of showing a number', (
    tester,
  ) async {
    await pump(tester, pickFrom(price: {'bookmaker': null, 'odds': null, 'checkedAt': null}));

    expect(find.text('no verified price'), findsOneWidget);
    // Two dashes: the missing price and the value that cannot be computed without it.
    expect(find.text('–'), findsNWidgets(2));
    // The estimate is still ours to show.
    expect(find.text('72%'), findsOneWidget);
  });

  testWidgets('a running selection is marked running, with no result yet', (tester) async {
    await pump(tester, pickFrom());

    expect(find.text('RUNNING'), findsOneWidget);
    expect(find.textContaining('The match produced'), findsNothing);
  });

  testWidgets('a settled selection shows what the match actually produced', (tester) async {
    await pump(tester, pickFrom(status: 'WON', actual: 13));

    expect(find.text('WON'), findsOneWidget);
    expect(find.text('The match produced 13.'), findsOneWidget);
  });

  testWidgets('a loss is labelled a loss', (tester) async {
    await pump(tester, pickFrom(status: 'LOST', actual: 7));
    expect(find.text('LOST'), findsOneWidget);
    expect(find.text('The match produced 7.'), findsOneWidget);
  });

  testWidgets('a void is a void', (tester) async {
    await pump(tester, pickFrom(status: 'VOID'));
    expect(find.text('VOID'), findsOneWidget);
  });

  testWidgets('an under renders as an under', (tester) async {
    await pump(tester, pickFrom(outcome: 'UNDER'));
    expect(find.textContaining('Under 9.5'), findsWidgets);
  });

  testWidgets('nothing on the card claims certainty', (tester) async {
    await pump(tester, pickFrom());

    for (final word in ['guaranteed', 'certain', 'sure', 'risk-free', 'lock', 'banker']) {
      expect(
        find.textContaining(word, findRichText: true),
        findsNothing,
        reason: 'the card must never use the word "$word"',
      );
    }
  });
}
