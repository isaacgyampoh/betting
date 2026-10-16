import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';

/// The rule these guard is the one the product rests on: missing is not zero.
///
/// A competition that publishes no score and a match that genuinely finished 0-0 are different
/// facts. Anywhere the two collapse into "0", the app is asserting something it was not told.
void main() {
  group('Fixture', () {
    Map<String, dynamic> base() => {
      'id': 1528939,
      'kickoffAt': '2026-10-04T18:45:00.000Z',
      'status': 'FINISHED',
      'statusLabel': 'Match Finished',
      'league': {'id': 5, 'name': 'UEFA Nations League', 'country': 'World', 'season': 2026},
      'home': {'id': 1, 'name': 'Greece'},
      'away': {'id': 2, 'name': 'Germany'},
    };

    test('a match with no score reported has no score, not nil-nil', () {
      final fixture = Fixture.fromJson(base());
      expect(fixture.homeGoals, isNull);
      expect(fixture.awayGoals, isNull);
      expect(fixture.hasScore, isFalse);
    });

    test('a genuine nil-nil is a score', () {
      final fixture = Fixture.fromJson({
        ...base(),
        'goals': {'home': 0, 'away': 0},
      });
      expect(fixture.homeGoals, 0);
      expect(fixture.awayGoals, 0);
      expect(fixture.hasScore, isTrue);
    });

    test('a half-time score is kept apart from the full-time one', () {
      final fixture = Fixture.fromJson({
        ...base(),
        'goals': {'home': 3, 'away': 1},
        'halftime': {'home': 1, 'away': 1},
      });
      expect(fixture.halfTimeHome, 1);
      expect(fixture.halfTimeAway, 1);
      expect(fixture.homeGoals, 3);
    });

    test('kickoff is held in UTC, whatever the device is set to', () {
      final fixture = Fixture.fromJson(base());
      expect(fixture.kickoffUtc.isUtc, isTrue);
      expect(fixture.kickoffUtc.hour, 18);
    });

    test('an unrecognised status is unknown rather than guessed at', () {
      final fixture = Fixture.fromJson({...base(), 'status': 'SOMETHING_NEW'});
      expect(fixture.status, MatchStatus.unknown);
      // The provider's own wording still reaches the screen.
      expect(fixture.statusLabel, 'Match Finished');
    });

    test('live and half time both count as live', () {
      expect(MatchStatusX.parse('LIVE').isLive, isTrue);
      expect(MatchStatusX.parse('HT').isLive, isTrue);
      expect(MatchStatusX.parse('FINISHED').isLive, isFalse);
    });
  });

  group('MatchEvent', () {
    test('the provider tells a goal from an own goal by its detail, and so do we', () {
      final goal = MatchEvent.fromJson({
        'minute': 23,
        'side': 'HOME',
        'type': 'GOAL',
        'detail': 'Normal Goal',
      });
      final own = MatchEvent.fromJson({
        'minute': 40,
        'side': 'AWAY',
        'type': 'OWN_GOAL',
        'detail': 'Own Goal',
      });
      expect(goal.type, MatchEventType.goal);
      expect(goal.isHome, isTrue);
      expect(own.type, MatchEventType.ownGoal);
      expect(own.isHome, isFalse);
    });

    test('added time reads as 45+2, not 45', () {
      final event = MatchEvent.fromJson({
        'minute': 45,
        'extra': 2,
        'side': 'HOME',
        'type': 'YELLOW',
        'detail': 'Yellow Card',
      });
      expect(event.minuteLabel, "45+2'");
    });

    test('an event type we do not model keeps the provider wording', () {
      final event = MatchEvent.fromJson({
        'minute': 90,
        'side': 'AWAY',
        'type': 'PENALTY_SHOOTOUT',
        'detail': 'Shootout goal',
      });
      expect(event.type, MatchEventType.unknown);
      expect(event.detail, 'Shootout goal');
    });
  });

  group('MatchDetail', () {
    test('no events plus coverage saying none is different from no events yet', () {
      final neverPublishes = MatchDetail.fromJson({
        'match': {
          'id': 1,
          'kickoffAt': '2026-10-04T15:00:00.000Z',
          'status': 'FINISHED',
          'statusLabel': 'Match Finished',
          'league': {'id': 1, 'name': 'Division One', 'country': 'Ghana'},
          'home': {'id': 1, 'name': 'A'},
          'away': {'id': 2, 'name': 'B'},
        },
        'events': <dynamic>[],
        'coverage': {
          'events': false,
          'lineups': false,
          'statistics': false,
          'playerStats': false,
          'standings': true,
        },
      });

      expect(neverPublishes.events, isEmpty);
      expect(neverPublishes.coverage!.events, isFalse);
      // The screen can say "this competition doesn't publish a timeline" rather than "no events".
      expect(neverPublishes.coverage!.standings, isTrue);
    });

    test('coverage absent means unknown, not absent', () {
      final detail = MatchDetail.fromJson({
        'match': {
          'id': 1,
          'kickoffAt': '2026-10-04T15:00:00.000Z',
          'status': 'SCHEDULED',
          'statusLabel': 'Not Started',
          'league': {'id': 1, 'name': 'X', 'country': 'Y'},
          'home': {'id': 1, 'name': 'A'},
          'away': {'id': 2, 'name': 'B'},
        },
      });
      expect(detail.coverage, isNull);
      expect(detail.events, isEmpty);
    });

    test('carries when it was read, so cached data is never passed off as current', () {
      final at = DateTime.utc(2026, 10, 15, 12);
      final detail = MatchDetail.fromJson({
        'match': {
          'id': 1,
          'kickoffAt': '2026-10-04T15:00:00.000Z',
          'status': 'LIVE',
          'statusLabel': "62'",
          'league': {'id': 1, 'name': 'X', 'country': 'Y'},
          'home': {'id': 1, 'name': 'A'},
          'away': {'id': 2, 'name': 'B'},
        },
      }, fetchedAt: at);
      expect(detail.fetchedAt, at);
    });
  });

  /// Both of these came from looking at the screen on a real phone, against a competition the
  /// provider covers thinly. Neither would have failed a test written from the API's documentation.
  group('what the screen actually shows', () {
    test('a goal nobody is named for reads as a goal, not as the provider\'s internal wording', () {
      // Lower-coverage competitions report that a goal happened and by which side, and no more.
      // Falling through to the raw detail put "Normal Goal, Normal Goal" down the timeline.
      final anonymous = MatchEvent.fromJson({
        'minute': 14,
        'side': 'HOME',
        'type': 'GOAL',
        'detail': 'Normal Goal',
        'player': null,
      });
      expect(anonymous.label, 'Goal');

      final named = MatchEvent.fromJson({
        'minute': 14,
        'side': 'HOME',
        'type': 'GOAL',
        'detail': 'Normal Goal',
        'player': 'Ada Hegerberg',
      });
      expect(named.label, 'Ada Hegerberg');
    });

    test('an event we do not model still keeps the provider wording', () {
      final odd = MatchEvent.fromJson({
        'minute': 90,
        'side': 'AWAY',
        'type': 'PENALTY_SHOOTOUT',
        'detail': 'Shootout goal',
      });
      expect(odd.label, 'Shootout goal');
    });

    test('a table whose rank restarts is more than one group', () {
      // Exactly what API-Football returned for the Australian Championship: sixteen rows in one
      // array, every row carrying the same group name, the rank running 1-4 four times over.
      StandingRow row(int rank, String name) => StandingRow.fromJson({
        'rank': rank,
        'team': {'id': rank * 100, 'name': name},
        'played': 0,
        'won': 0,
        'drawn': 0,
        'lost': 0,
        'goalsFor': 0,
        'goalsAgainst': 0,
        'points': 0,
      });

      final blocks = StandingsBlock.split([
        row(1, 'Sutherland Sharks'),
        row(2, 'Sydney United'),
        row(3, 'South Melbourne'),
        row(4, 'Canberra FC'),
        row(1, 'Adelaide City'),
        row(2, 'Broadmeadow Magic'),
        row(3, 'Avondale'),
        row(4, 'Wests APIA'),
      ]);

      expect(blocks, hasLength(2));
      expect(blocks.first.rows.first.team.name, 'Sutherland Sharks');
      expect(blocks.last.rows.first.team.name, 'Adelaide City');
      expect(blocks.every((b) => b.rows.length == 4), isTrue);
    });

    test('an ordinary table is left as one block', () {
      final rows = [
        for (var i = 1; i <= 20; i++)
          StandingRow.fromJson({
            'rank': i,
            'team': {'id': i, 'name': 'Team $i'},
            'played': 10,
            'won': 5,
            'drawn': 2,
            'lost': 3,
            'goalsFor': 15,
            'goalsAgainst': 12,
            'points': 17,
          }),
      ];
      expect(StandingsBlock.split(rows), hasLength(1));
    });

    test('an empty table is no blocks, not one empty one', () {
      expect(StandingsBlock.split(const []), isEmpty);
    });
  });

  _phaseTwo();
}

/// Statistics and line-ups, added once the provider audit confirmed which of them are real.
///
/// The audit is the reason these exist in this shape: a big-five fixture returned possession as
/// "33%", expected goals as a decimal string, and a full grid per starter; the same two endpoints
/// on a lower-coverage competition returned empty arrays with no error at all.
void _phaseTwo() {
  group('team statistics', () {
    test('an unreported count stays null and never becomes zero', () {
      final stats = TeamStatistics.fromJson({
        'team': {'id': 1, 'name': 'Arsenal'},
        'possession': 58,
        'shotsTotal': 14,
        'expectedGoals': null,
      });
      expect(stats.possession, 58);
      expect(stats.shotsTotal, 14);
      expect(stats.expectedGoals, isNull);
      expect(stats.corners, isNull, reason: 'absent from the payload entirely');
    });

    test('a genuine zero survives as a zero', () {
      final stats = TeamStatistics.fromJson({
        'team': {'id': 1, 'name': 'Arsenal'},
        'redCards': 0,
      });
      expect(stats.redCards, 0);
      expect(stats.redCards, isNot(isNull));
    });
  });

  group('line-ups', () {
    Map<String, dynamic> player(int n, String name, String? grid) => {
      'name': name,
      'number': n,
      'position': 'D',
      'grid': grid,
    };

    test("a grid reads as the provider's row and column", () {
      final p = LineupPlayer.fromJson(player(2, 'M. van Ewijk', '2:4'));
      expect(p.row, 2);
      expect(p.column, 4);
    });

    test('no grid means no position, not position zero', () {
      final p = LineupPlayer.fromJson(player(19, 'C. Rushworth', null));
      expect(p.row, isNull);
      expect(p.column, isNull);
    });

    test('a malformed grid is treated as absent rather than guessed at', () {
      expect(LineupPlayer.fromJson(player(1, 'X', 'nonsense')).row, isNull);
      expect(LineupPlayer.fromJson(player(1, 'X', '3')).column, isNull);
    });

    test('a pitch is only drawn when every starter has a position', () {
      Lineup build(List<String?> grids) => Lineup.fromJson({
        'team': {'id': 1, 'name': 'Coventry'},
        'formation': '4-2-3-1',
        'coach': 'F. Lampard',
        'startXI': [for (final (i, g) in grids.indexed) player(i + 1, 'Player ${i + 1}', g)],
        'substitutes': <dynamic>[],
      });

      expect(build(['1:1', '2:1', '2:2']).canDrawPitch, isTrue);
      // One ungridded player and the shape is unknown. A list is honest; a pitch would be a
      // claim about how the team set up.
      expect(build(['1:1', '2:1', null]).canDrawPitch, isFalse);
      expect(build([]).canDrawPitch, isFalse);
    });

    test('a competition with no line-ups gives an empty list, not a fabricated one', () {
      final detail = MatchDetail.fromJson({
        'match': {
          'id': 1,
          'kickoffAt': '2026-10-16T15:00:00.000Z',
          'status': 'FINISHED',
          'statusLabel': 'Match Finished',
          'league': {'id': 1202, 'name': 'Australian Championship', 'country': 'Australia'},
          'home': {'id': 1, 'name': 'A'},
          'away': {'id': 2, 'name': 'B'},
        },
        'statistics': <dynamic>[],
        'lineups': <dynamic>[],
        'coverage': {
          'events': true,
          'lineups': false,
          'statistics': false,
          'playerStats': false,
          'standings': true,
        },
      });

      expect(detail.statistics, isEmpty);
      expect(detail.lineups, isEmpty);
      // And the coverage flag is what makes that legible rather than ambiguous.
      expect(detail.coverage!.statistics, isFalse);
      expect(detail.coverage!.lineups, isFalse);
    });
  });
}
