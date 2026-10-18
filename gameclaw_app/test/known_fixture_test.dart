import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/providers.dart';
import 'package:gameclaw_app/data/repository.dart';
import 'package:gameclaw_app/domain/models.dart';

/// Opening a match should not re-learn what was on screen a second ago.
///
/// The detail request is quick - about a third of a second against production, warm - but the
/// screen showed a blank header for all of it, including the teams, the competition and the status
/// that were in the row the user had just tapped. That gap is what "opening a match is slow" meant.
///
/// Nothing is cached specially for this: the day's fixtures are already loaded under
/// [matchDayProvider], and a [MatchRef] carries the date it was opened from. These tests pin that
/// the lookup finds the fixture when it is there, and admits it does not when it is not - a
/// notification or a deep link has no list behind it, and inventing a header for those would be
/// the kind of fast that is also wrong.
void main() {
  Fixture fixture(int id, String home, String away) => Fixture.fromJson({
    'id': id,
    'kickoffAt': '2026-10-18T19:00:00.000Z',
    'status': 'LIVE',
    'statusLabel': "55'",
    'league': {'id': 39, 'name': 'Premier League', 'country': 'England', 'season': 2026},
    'home': {'id': id * 10, 'name': home},
    'away': {'id': id * 10 + 1, 'name': away},
    'goals': {'home': 1, 'away': 0},
  });

  MatchDay day(List<Fixture> fixtures) => MatchDay(
    date: '2026-10-18',
    groups: [
      LeagueGroup(
        competition: const Competition(id: 39, name: 'Premier League', country: 'England'),
        fixtures: fixtures,
      ),
    ],
    featured: const [],
    total: fixtures.length,
    shown: fixtures.length,
  );

  ProviderContainer containerWith(MatchDay? loaded) {
    return ProviderContainer(
      overrides: [
        if (loaded != null)
          matchDayProvider('2026-10-18').overrideWith(
            (ref) async => Cached(value: loaded, fetchedAt: DateTime.now(), fromCache: false),
          ),
      ],
    );
  }

  test('finds the fixture the list already had', () async {
    final container = containerWith(day([fixture(1, 'Arsenal', 'Chelsea'), fixture(2, 'Spurs', 'Everton')]));
    addTearDown(container.dispose);
    await container.read(matchDayProvider('2026-10-18').future);

    final known = container.read(knownFixtureProvider(const MatchRef(2, '2026-10-18')));
    expect(known, isNotNull);
    expect(known!.home.name, 'Spurs');
    expect(known.statusLabel, "55'");
  });

  test('returns nothing for a match that day does not contain', () async {
    final container = containerWith(day([fixture(1, 'Arsenal', 'Chelsea')]));
    addTearDown(container.dispose);
    await container.read(matchDayProvider('2026-10-18').future);

    expect(container.read(knownFixtureProvider(const MatchRef(99, '2026-10-18'))), isNull);
  });

  test('returns nothing when the match was opened without a date', () async {
    // A notification or a deep link. There is no list behind it, so the skeleton is correct.
    final container = containerWith(day([fixture(1, 'Arsenal', 'Chelsea')]));
    addTearDown(container.dispose);
    await container.read(matchDayProvider('2026-10-18').future);

    expect(container.read(knownFixtureProvider(const MatchRef(1))), isNull);
  });

  test('returns nothing before the day has loaded', () async {
    final container = containerWith(null);
    addTearDown(container.dispose);
    expect(container.read(knownFixtureProvider(const MatchRef(1, '2026-10-18'))), isNull);
  });

  test('does not reach into a different day', () async {
    final container = containerWith(day([fixture(1, 'Arsenal', 'Chelsea')]));
    addTearDown(container.dispose);
    await container.read(matchDayProvider('2026-10-18').future);

    expect(container.read(knownFixtureProvider(const MatchRef(1, '2026-10-19'))), isNull);
  });
}
