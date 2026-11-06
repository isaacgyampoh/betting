import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/providers.dart';
import 'package:gameclaw_app/data/repository.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/features/special/special_picks_screen.dart';
import 'package:gameclaw_app/theme/tokens.dart';

/// The screen, composed.
///
/// A day with no qualifying selection is the normal case the thresholds are set to produce, so it
/// gets the same attention as a day with two: it must read as "nothing met the bar today", never
/// as a blank panel or a failure.
void main() {
  Map<String, dynamic> pick(int position, String home, String away, String kind, String label) => {
    'position': position,
    'match': {
      'home': home,
      'away': away,
      'competition': 'Premier League',
      'country': 'England',
      'kickoffAt': '2026-11-02T15:00:00.000Z',
    },
    'market': {'kind': kind, 'side': 'MATCH', 'label': label, 'line': 9.5, 'outcome': 'OVER'},
    'price': {'bookmaker': 'sportybet', 'odds': 1.9, 'checkedAt': '2026-11-02T07:00:00.000Z'},
    'probability': 0.721,
    'confidence': 'medium',
    'reason': 'Over 9.5 in 7 of 8 matches, averaging 12.1.',
    'evidence': {'mean': 12.1, 'sample': 8, 'hitRate': 0.875},
    'researchedAt': '2026-11-02T07:00:00.000Z',
    'status': 'PENDING',
    'actual': null,
  };

  Map<String, dynamic> slipOf(List<Map<String, dynamic>> legs, {num combined = 2.03, String status = 'PENDING'}) => {
    'reference': 'GC261105',
    'date': '2026-11-05',
    'combinedOdds': combined,
    'currentOdds': combined,
    'target': 2,
    'summary': '${legs.length} selections at $combined.',
    'status': status,
    'publishedAt': '2026-11-05T07:00:00.000Z',
    'lastVerifiedAt': '2026-11-05T07:30:00.000Z',
    'legs': legs,
  };

  Future<void> pump(WidgetTester tester, Map<String, dynamic> payload) async {
    final view = SpecialPicksView.fromJson(payload);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          specialPicksProvider.overrideWith(
            (ref) async => Cached(value: view, fetchedAt: DateTime.now(), fromCache: false),
          ),
        ],
        child: MaterialApp(
          theme: gcTheme(brightness: Brightness.dark),
          home: const SpecialPicksScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows the day as one slip, with its combined price and every leg', (tester) async {
    await pump(tester, {
      'target': 2,
      'today': slipOf([
        pick(1, 'Arsenal', 'Chelsea', 'CORNERS', 'Match corners'),
        pick(2, 'Spurs', 'Everton', 'SHOTS_ON_TARGET', 'Match shots on target'),
      ]),
      'performance': {'total': 1, 'won': 0, 'lost': 0, 'pending': 1, 'winRate': null},
    });

    expect(find.text('Daily Special Slip'), findsOneWidget);
    expect(find.text('2.03'), findsOneWidget);
    expect(find.text('combined odds'), findsOneWidget);
    expect(find.text('GAMECLAW'), findsOneWidget);
    expect(find.textContaining('GC261105'), findsOneWidget);

    // One bet, so one share control rather than one per match.
    expect(find.text('Share slip'), findsOneWidget);

    expect(find.text('Arsenal v Chelsea'), findsOneWidget);
    expect(find.text('Spurs v Everton'), findsOneWidget);
  });

  testWidgets('shows three legs when three were published', (tester) async {
    await pump(tester, {
      'target': 2,
      'today': slipOf([
        pick(1, 'Arsenal', 'Chelsea', 'CORNERS', 'Match corners'),
        pick(2, 'Spurs', 'Everton', 'SHOTS', 'Match shots'),
        pick(3, 'Napoli', 'Inter', 'SHOTS_ON_TARGET', 'Match shots on target'),
      ]),
      'performance': {'total': 1, 'pending': 1},
    });

    expect(find.textContaining('3 matches'), findsOneWidget);
    expect(find.text('Napoli v Inter'), findsOneWidget);
    expect(find.text('Share slip'), findsOneWidget);
  });

  testWidgets('a day with nothing qualifying says so, and is not an error', (tester) async {
    await pump(tester, {
      'today': null,
      'performance': {'total': 0},
    });

    expect(find.textContaining('no combination reached the'), findsOneWidget);
    expect(find.textContaining('a normal day, not a fault'), findsOneWidget);
    // The section is still there; only its contents changed.
    expect(find.text('TODAY'), findsOneWidget);
  });

  testWidgets('no win rate is shown before anything has settled', (tester) async {
    await pump(tester, {
      'today': null,
      'performance': {'total': 2, 'won': 0, 'lost': 0, 'pending': 2, 'winRate': null},
    });

    expect(find.text('win rate'), findsOneWidget);
    // A dash, not 0%. Zero settled selections is not a zero per cent record.
    expect(find.text('–'), findsOneWidget);
    expect(find.text('0%'), findsNothing);
  });

  testWidgets('the record counts losses and reports voids as voids', (tester) async {
    await pump(tester, {
      'today': null,
      'performance': {
        'total': 5,
        'won': 1,
        'lost': 1,
        'void': 1,
        'pending': 2,
        'winRate': 0.5,
        'profitUnits': 0.05,
        'stakedUnits': 2,
        'unpriced': 0,
        'legs': {'total': 5, 'won': 3, 'lost': 1, 'void': 1, 'pending': 0},
      },
    });

    expect(find.text('50%'), findsWidgets);
    expect(find.text('Won'), findsOneWidget);
    expect(find.text('Lost'), findsOneWidget);
    expect(find.text('Void'), findsOneWidget);
    expect(find.textContaining('+0.05 units'), findsOneWidget);
    // The legs underneath, because a slip hides which one was wrong.
    expect(find.textContaining('Underneath those slips'), findsOneWidget);
  });

  testWidgets('an unpriced selection is named rather than quietly dropped', (tester) async {
    await pump(tester, {
      'today': null,
      'performance': {
        'total': 2,
        'won': 1,
        'lost': 1,
        'winRate': 0.5,
        'profitUnits': -1,
        'stakedUnits': 1,
        'unpriced': 1,
      },
    });

    expect(find.textContaining('without a verified price'), findsOneWidget);
  });

  testWidgets('an empty record invites nothing and promises nothing', (tester) async {
    await pump(tester, {
      'today': null,
      'performance': {'total': 0},
    });

    expect(find.textContaining('No slips have been published yet'), findsOneWidget);
  });
}
