import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';

/// The estimate must never be readable as a price.
///
/// A special pick carries three numbers that all look like each other on a screen: the bookmaker's
/// odds, our estimated chance, and the value the two imply. They arrive in three different places
/// in the payload and they have to stay in three different fields. A parser that crossed two of
/// them would show a plausible, wrong number - which is the worst kind, because nothing about it
/// looks wrong.
///
/// The payload below is a real response from `GET /api/v1/special-picks`, trimmed.
Map<String, dynamic> pickJson({
  Map<String, dynamic>? price,
  String outcome = 'OVER',
  String status = 'PENDING',
  num? actual,
}) => {
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
  'price': price ?? {'bookmaker': 'sportybet', 'odds': 1.9, 'checkedAt': '2026-11-02T07:00:00.000Z'},
  'probability': 0.721,
  'confidence': 'medium',
  'reason': "Over 9.5 in 7 of 8 matches (these sides' recent matches), averaging 12.1.",
  'evidence': {'mean': 12.1, 'sample': 8, 'hitRate': 0.875, 'coverage': 1},
  'researchedAt': '2026-11-02T07:00:00.000Z',
  'status': status,
  'actual': actual,
};

void main() {
  group('the three numbers stay three numbers', () {
    test('the price, the estimate and the value come from their own fields', () {
      final pick = SpecialPick.fromJson(pickJson());

      expect(pick.odds, 1.9);
      expect(pick.probability, 0.721);
      // 0.721 × 1.9 − 1. Derived, never read from the payload, and never confused with either.
      expect(pick.value, closeTo(0.3699, 0.0001));
    });

    test('an estimated chance is not a price even when it looks like one', () {
      // A 50% estimate at even money is worth nothing, and the two must not be interchangeable.
      final pick = SpecialPick.fromJson(
        pickJson()..['probability'] = 0.5,
      );
      expect(pick.probability, 0.5);
      expect(pick.odds, 1.9);
      expect(pick.value, closeTo(-0.05, 0.0001));
    });

    test('value is null without a price rather than zero', () {
      final pick = SpecialPick.fromJson(
        pickJson(price: {'bookmaker': null, 'odds': null, 'checkedAt': null}),
      );

      expect(pick.odds, isNull);
      expect(pick.bookmaker, isNull);
      // Zero would read as "no edge". There is no edge to report, which is a different statement.
      expect(pick.value, isNull);
      // The estimate survives: it was researched whether or not a price was verified.
      expect(pick.probability, 0.721);
    });
  });

  group('the selection reads as the server worded it', () {
    test('an over keeps its line', () {
      expect(SpecialPick.fromJson(pickJson()).selection, 'Over 9.5');
    });

    test('an under is an under', () {
      final pick = SpecialPick.fromJson(pickJson(outcome: 'UNDER'));
      expect(pick.isOver, isFalse);
      expect(pick.selection, 'Under 9.5');
    });

    test('the market label is the server\'s, not rebuilt here', () {
      expect(SpecialPick.fromJson(pickJson()).marketLabel, 'Match corners');
    });

    test('the reason is kept whole', () {
      expect(SpecialPick.fromJson(pickJson()).reason, contains('7 of 8 matches'));
    });

    test('the evidence figures are read through', () {
      final pick = SpecialPick.fromJson(pickJson());
      expect(pick.sample, 8);
      expect(pick.mean, 12.1);
      expect(pick.hitRate, 0.875);
    });
  });

  group('status and result', () {
    test('a running selection has no result', () {
      final pick = SpecialPick.fromJson(pickJson());
      expect(pick.status, PickStatus.pending);
      expect(pick.actual, isNull);
    });

    test('a won selection carries what the match produced', () {
      final pick = SpecialPick.fromJson(pickJson(status: 'WON', actual: 13));
      expect(pick.status, PickStatus.won);
      expect(pick.actual, 13);
    });

    test('a void is a void, not a loss', () {
      expect(SpecialPick.fromJson(pickJson(status: 'VOID')).status, PickStatus.voided);
    });

    test('an unknown status is treated as still running, never as a win', () {
      expect(SpecialPick.fromJson(pickJson(status: 'SOMETHING_NEW')).status, PickStatus.pending);
    });
  });

  group('the record is not flattered', () {
    SpecialPerformance parse(Map<String, dynamic> json) => SpecialPerformance.fromJson(json);

    test('no win rate before anything settles', () {
      final record = parse({'total': 2, 'won': 0, 'lost': 0, 'pending': 2, 'winRate': null});
      // Zero settled is not a 0% win rate.
      expect(record.winRate, isNull);
      expect(record.settled, 0);
    });

    test('a void is counted as itself', () {
      final record = parse({
        'total': 4,
        'won': 1,
        'lost': 1,
        'void': 1,
        'pending': 1,
        'winRate': 0.5,
      });
      expect(record.voided, 1);
      expect(record.settled, 2);
      expect(record.winRate, 0.5);
    });

    test('selections published without a price are reported, not dropped', () {
      final record = parse({'total': 2, 'won': 1, 'lost': 1, 'unpriced': 1, 'stakedUnits': 1});
      expect(record.unpriced, 1);
      expect(record.stakedUnits, 1);
      expect(record.settled, 2);
    });

    test('a loss shows as a negative return', () {
      final record = parse({'won': 1, 'lost': 1, 'profitUnits': -0.1, 'stakedUnits': 2});
      expect(record.profitUnits, -0.1);
    });

    test('per-market rates are null until that market settles something', () {
      final record = parse({
        'byMarket': [
          {'kind': 'CORNERS', 'total': 3, 'won': 1, 'lost': 0, 'winRate': 1},
          {'kind': 'SHOTS', 'total': 1, 'won': 0, 'lost': 0, 'winRate': null},
        ],
      });
      expect(record.byMarket.first.winRate, 1);
      expect(record.byMarket.first.settled, 1);
      expect(record.byMarket.last.winRate, isNull);
      expect(record.byMarket.last.settled, 0);
    });
  });

  group('a day with nothing published', () {
    test('an empty list is a valid answer, not a parse failure', () {
      final view = SpecialPicksView.fromJson({
        'picks': <dynamic>[],
        'performance': {'total': 0},
      });
      expect(view.picks, isEmpty);
      expect(view.performance.total, 0);
      expect(view.performance.winRate, isNull);
    });

    test('a missing performance object does not throw', () {
      final view = SpecialPicksView.fromJson({'picks': <dynamic>[]});
      expect(view.performance.total, 0);
    });
  });

  test('the whole response parses as the endpoint returns it', () {
    final view = SpecialPicksView.fromJson({
      'picks': [pickJson(), pickJson()..['position'] = 2],
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
        'byMarket': [
          {'kind': 'CORNERS', 'total': 3, 'won': 1, 'lost': 0, 'winRate': 1},
        ],
      },
    });

    expect(view.picks, hasLength(2));
    expect(view.picks.last.position, 2);
    expect(view.performance.winRate, 0.5);
    expect(view.performance.byMarket.single.kind, 'CORNERS');
  });

  /// The day is the bet.
  ///
  /// Two selections published together are one 2 odds slip staked once. The app has to read that
  /// or it reports a record nobody has: a day where one leg won and the other lost is a loss, not
  /// a 50% day.
  group('the day as one slip', () {
    Map<String, dynamic> response({String status = 'PENDING', num? combined = 2.1}) => {
      'target': 2,
      'today': {
        'date': '2026-11-05',
        'slip': {'combinedOdds': combined, 'status': status, 'target': 2},
        'picks': [pickJson(), pickJson()..['position'] = 2],
      },
      'performance': {
        'total': 3,
        'won': 1,
        'lost': 1,
        'void': 1,
        'pending': 0,
        'winRate': 0.5,
        'profitUnits': 1.1,
        'stakedUnits': 2,
        'unpriced': 0,
        'legs': {'total': 6, 'won': 3, 'lost': 2, 'void': 1, 'pending': 0},
      },
    };

    test('reads the combined odds and the slip status', () {
      final view = SpecialPicksView.fromJson(response(status: 'WON', combined: 2.4));
      expect(view.target, 2);
      expect(view.today!.slip.combinedOdds, 2.4);
      expect(view.today!.slip.status, PickStatus.won);
      expect(view.today!.picks, hasLength(2));
    });

    test('a running slip has no combined odds yet', () {
      final view = SpecialPicksView.fromJson(response(combined: null));
      expect(view.today!.slip.combinedOdds, isNull);
      expect(view.today!.slip.status, PickStatus.pending);
    });

    test('the record counts days, and reports the legs underneath', () {
      final p = SpecialPicksView.fromJson(response()).performance;
      expect(p.total, 3); // days, not selections
      expect(p.settled, 2);
      expect(p.winRate, 0.5);
      expect(p.legs.total, 6);
      expect(p.legs.won, 3);
      expect(p.legs.lost, 2);
      expect(p.legs.voided, 1);
    });

    test('a day with nothing published has no slip at all', () {
      final view = SpecialPicksView.fromJson({'target': 2, 'today': null, 'performance': {'total': 0}});
      expect(view.today, isNull);
      expect(view.picks, isEmpty);
    });

    // A phone in somebody's hand may be talking to an API that predates the slip.
    test('still reads a response that only has a flat list of picks', () {
      final view = SpecialPicksView.fromJson({
        'picks': [pickJson()],
        'performance': {'total': 1},
      });
      expect(view.picks, hasLength(1));
      expect(view.today!.slip.combinedOdds, isNull);
    });
  });
}
