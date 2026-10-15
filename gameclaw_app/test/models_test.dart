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
      final fixture = Fixture.fromJson({...base(), 'goals': {'home': 0, 'away': 0}});
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
      final goal = MatchEvent.fromJson({'minute': 23, 'side': 'HOME', 'type': 'GOAL', 'detail': 'Normal Goal'});
      final own = MatchEvent.fromJson({'minute': 40, 'side': 'AWAY', 'type': 'OWN_GOAL', 'detail': 'Own Goal'});
      expect(goal.type, MatchEventType.goal);
      expect(goal.isHome, isTrue);
      expect(own.type, MatchEventType.ownGoal);
      expect(own.isHome, isFalse);
    });

    test('added time reads as 45+2, not 45', () {
      final event = MatchEvent.fromJson({'minute': 45, 'extra': 2, 'side': 'HOME', 'type': 'YELLOW', 'detail': 'Yellow Card'});
      expect(event.minuteLabel, "45+2'");
    });

    test('an event type we do not model keeps the provider wording', () {
      final event = MatchEvent.fromJson({'minute': 90, 'side': 'AWAY', 'type': 'PENALTY_SHOOTOUT', 'detail': 'Shootout goal'});
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
        'coverage': {'events': false, 'lineups': false, 'statistics': false, 'playerStats': false, 'standings': true},
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
}
