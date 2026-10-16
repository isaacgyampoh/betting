import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';

/// The row the day leads with. Nothing here claims a fixture is important - the data has no way
/// to know that - only which competition it is in.
void main() {
  Map<String, dynamic> fixture(int id) => {
    'id': id,
    'kickoffAt': '2026-10-16T19:00:00.000Z',
    'status': 'SCHEDULED',
    'statusLabel': 'Not Started',
    'league': {'id': 39, 'name': 'Premier League', 'country': 'England', 'season': 2026},
    'home': {'id': 1, 'name': 'Arsenal'},
    'away': {'id': 2, 'name': 'Chelsea'},
  };

  test('a featured fixture carries its reason', () {
    final f = FeaturedFixture.fromJson({'match': fixture(7), 'reason': 'Premier League'});
    expect(f.fixture.id, 7);
    expect(f.reason, 'Premier League');
  });

  test('a day with no ranked football has an empty row, not a missing field', () {
    final day = MatchDay.fromJson({
      'date': '2026-10-16',
      'groups': <dynamic>[],
      'featured': <dynamic>[],
      'total': 300,
      'shown': 150,
    });
    expect(day.featured, isEmpty);
  });

  // An older cached payload, or a server that has not been deployed yet, must not crash the list.
  test('a payload with no featured key at all still parses', () {
    final day = MatchDay.fromJson({
      'date': '2026-10-16',
      'groups': <dynamic>[],
      'total': 10,
      'shown': 10,
    });
    expect(day.featured, isEmpty);
  });

  test('reads the whole row in order', () {
    final day = MatchDay.fromJson({
      'date': '2026-10-16',
      'groups': <dynamic>[],
      'featured': [
        {'match': fixture(1), 'reason': 'UEFA Champions League'},
        {'match': fixture(2), 'reason': 'La Liga'},
      ],
      'total': 10,
      'shown': 10,
    });
    expect(day.featured.map((f) => f.reason), ['UEFA Champions League', 'La Liga']);
    expect(day.featured.map((f) => f.fixture.id), [1, 2]);
  });
}
