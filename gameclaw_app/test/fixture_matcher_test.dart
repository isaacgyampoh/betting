import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/features/slip_scan/fixture_matcher.dart';
import 'package:gameclaw_app/features/slip_scan/slip_parser.dart';

/// Turning two team names read off a photograph into a real fixture.
///
/// This is where the feature is most likely to be quietly wrong. Picking Manchester City when
/// the slip said Manchester United produces a conversion that works perfectly and is about a
/// different match, so the matcher is built to refuse rather than reach.
Fixture fixture(int id, String home, String away) => Fixture(
  id: id,
  kickoffUtc: DateTime.utc(2026, 10, 18, 15),
  status: MatchStatus.scheduled,
  statusLabel: '15:00',
  competition: const Competition(id: 1, name: 'Premier League', country: 'England'),
  home: Team(id: id * 10, name: home),
  away: Team(id: id * 10 + 1, name: away),
);

ParsedSelection parsed(String home, String away) =>
    ParsedSelection(rawLines: const [], home: home, away: away);

void main() {
  group('normalising a name', () {
    test('ignores case, punctuation and club-type words', () {
      expect(normaliseTeam('FC Barcelona'), normaliseTeam('Barcelona'));
      expect(normaliseTeam('Real Madrid C.F.'), normaliseTeam('real madrid'));
      expect(normaliseTeam('Manchester Utd'), normaliseTeam('MANCHESTER UNITED'));
    });

    test('handles accents, which slips and providers disagree about', () {
      expect(normaliseTeam('Atlético Madrid'), normaliseTeam('Atletico Madrid'));
      expect(normaliseTeam('Beşiktaş'), isNotEmpty);
    });

    test('does not strip a name down to nothing', () {
      // "United" alone is all there is; dropping it would leave an empty string that matches
      // everything.
      expect(normaliseTeam('United'), isNotEmpty);
      expect(normaliseTeam('FC'), isNotEmpty);
    });
  });

  group('similarity', () {
    test('word order does not matter', () {
      expect(similarity('Manchester United', 'United Manchester'), greaterThan(0.9));
    });

    test('survives the typos OCR makes inside a word', () {
      expect(similarity('Mancheater United', 'Manchester United'), greaterThan(0.7));
    });

    test('different clubs score low', () {
      expect(similarity('Arsenal', 'Chelsea'), lessThan(0.4));
    });
  });

  group('matching a selection to a fixture', () {
    final card = [
      fixture(1, 'Arsenal', 'Chelsea'),
      fixture(2, 'Real Madrid', 'Barcelona'),
      fixture(3, 'Liverpool', 'Everton'),
    ];

    test('finds the obvious one with high confidence', () {
      final result = matchFixture(parsed('Arsenal', 'Chelsea'), card);
      expect(result.fixture?.id, 1);
      expect(result.confidence, Confidence.high);
      expect(result.needsReview, isFalse);
    });

    test('matches despite OCR noise in the names', () {
      final result = matchFixture(parsed('ARSENAL FC', 'Chelsea F.C.'), card);
      expect(result.fixture?.id, 1);
    });

    test('matches when the slip lists the sides the other way round', () {
      final result = matchFixture(parsed('Chelsea', 'Arsenal'), card);
      expect(result.fixture?.id, 1);
    });

    test('both sides must agree, not just one', () {
      // Arsenal is on the card; Arsenal v Spurs is not. Matching on the strength of Arsenal
      // alone would attach the selection to the wrong game.
      final result = matchFixture(parsed('Arsenal', 'Tottenham'), card);
      expect(result.fixture, isNull);
      expect(result.needsReview, isTrue);
    });

    test('returns nothing when the card holds no such match', () {
      final result = matchFixture(parsed('Boca Juniors', 'River Plate'), card);
      expect(result.fixture, isNull);
      expect(result.confidence, Confidence.low);
    });

    test('a selection missing a team is not matched at all', () {
      final result = matchFixture(
        const ParsedSelection(rawLines: [], home: 'Arsenal'),
        card,
      );
      expect(result.fixture, isNull);
    });

    test('an empty card matches nothing rather than throwing', () {
      expect(matchFixture(parsed('Arsenal', 'Chelsea'), const []).fixture, isNull);
    });
  });

  group('when two fixtures are too alike', () {
    test('a near-tie is reported as ambiguous with the alternatives kept', () {
      // Two Manchester sides on the same card is the case that makes this feature dangerous.
      final card = [
        fixture(1, 'Manchester United', 'Newcastle'),
        fixture(2, 'Manchester City', 'Newcastle'),
      ];
      final result = matchFixture(parsed('Manchester', 'Newcastle'), card);

      expect(result.ambiguous, isTrue);
      expect(result.alternatives, isNotEmpty);
      // Never high, however well the leader scored: choosing would be a coin toss.
      expect(result.confidence, Confidence.medium);
      expect(result.needsReview, isTrue);
    });

    test('a clear winner is not called ambiguous', () {
      final card = [
        fixture(1, 'Manchester United', 'Newcastle'),
        fixture(2, 'Burnley', 'Luton'),
      ];
      final result = matchFixture(parsed('Manchester United', 'Newcastle'), card);
      expect(result.ambiguous, isFalse);
      expect(result.confidence, Confidence.high);
    });
  });

  /// Searching by hand, for the cases the matcher cannot settle.
  ///
  /// The picker ranks with the same similarity the matcher uses, so the top of the list is what
  /// the matcher thought was closest - just without the threshold that rejected it.
  group('ranking for the manual picker', () {
    final card = [
      fixture(1, 'Manchester United', 'Newcastle'),
      fixture(2, 'Manchester City', 'Brighton'),
      fixture(3, 'Real Madrid', 'Barcelona'),
    ];

    test('a mangled name still ranks the right game first', () {
      // Exactly the input the matcher refuses: close enough to find, not close enough to trust.
      final ranked =
          card
              .map((f) => (f, similarity('Mancheter Utd Newcastle', '${f.home.name} ${f.away.name}')))
              .toList()
            ..sort((a, b) => b.$2.compareTo(a.$2));
      expect(ranked.first.$1.id, 1);
    });

    test('searching one side is enough to surface the fixture', () {
      final ranked =
          card
              .map(
                (f) => (
                  f,
                  [similarity('Barcelona', f.home.name), similarity('Barcelona', f.away.name)]
                      .reduce((a, b) => a > b ? a : b),
                ),
              )
              .toList()
            ..sort((a, b) => b.$2.compareTo(a.$2));
      expect(ranked.first.$1.id, 3);
    });
  });

  test('a whole slip is matched selection by selection', () {
    final card = [fixture(1, 'Arsenal', 'Chelsea'), fixture(2, 'Real Madrid', 'Barcelona')];
    final slip = parseSlip('''
Arsenal vs Chelsea
1X2
1.85
Boca Juniors vs River Plate
1X2
2.10
''');
    final matches = matchSlip(slip, card);
    expect(matches, hasLength(2));
    expect(matches[0].fixture?.id, 1);
    // Not on the card, so it is flagged rather than forced onto the nearest thing.
    expect(matches[1].fixture, isNull);
    expect(matches[1].needsReview, isTrue);
  });
}
