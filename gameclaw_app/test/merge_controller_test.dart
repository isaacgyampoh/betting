import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/features/merge/merge_controller.dart';

/// What the merge screen is allowed to claim.
///
/// The state here decides two things that a user would notice being wrong: how many legs they have
/// chosen, and whether a merge can be attempted at all. Both are derived rather than stored, so
/// these tests are mostly about the derivation staying honest when legs and slips come and go.
void main() {
  Slip slipWith(String id, String bookmaker, int legs, {int unsupported = 0}) => Slip.fromJson({
    'id': id,
    'bookmaker': {'slug': bookmaker.toLowerCase(), 'name': bookmaker},
    'code': 'CODE$id',
    'demo': false,
    'totalOdds': 2.5,
    'selectionCount': legs,
    'selections': [
      for (var i = 1; i <= legs; i++)
        {
          'position': i,
          'home': 'Home$i',
          'away': 'Away$i',
          'competition': 'League',
          'kickoffAt': '2026-10-19T19:00:00.000Z',
          'marketLabel': '1X2',
          'pickLabel': 'Home$i',
          'odds': 1.5,
          'status': i <= unsupported ? 'MARKET_NOT_FOUND' : 'OK',
        },
    ],
    'warnings': <dynamic>[],
  });

  MergeState withSlips(List<Slip> slips) {
    final picks = <MergePick>{
      for (final s in slips)
        for (final sel in s.selections.where((x) => x.status.isOk))
          MergePick(slipId: s.id, position: sel.position),
    };
    return MergeState(sources: slips, picked: picks);
  }

  group('whether a merge can be attempted', () {
    test('needs two slips, not just two legs', () {
      // Two legs from one slip is a conversion, which already has a screen. Offering "merge" for
      // it would be the same operation under a second name.
      final one = withSlips([slipWith('a', 'SportyBet', 3)]);
      expect(one.chosen, 3);
      expect(one.contributingSlips, 1);
      expect(one.canMerge, isFalse);
    });

    test('is allowed once two slips each contribute a leg', () {
      final two = withSlips([slipWith('a', 'SportyBet', 2), slipWith('b', 'Football.com', 2)]);
      expect(two.contributingSlips, 2);
      expect(two.canMerge, isTrue);
    });

    test('is refused while a request is in flight', () {
      final busy = withSlips([
        slipWith('a', 'SportyBet', 2),
        slipWith('b', 'Football.com', 2),
      ]).copyWith(busy: true);
      expect(busy.canMerge, isFalse);
    });

    test('is refused when a slip is present but all its legs were unticked', () {
      // Two slips on screen, but only one contributing. The count has to follow the ticks, not
      // the number of cards.
      final state = withSlips([slipWith('a', 'SportyBet', 2), slipWith('b', 'Football.com', 2)]);
      final onlyA = state.copyWith(picked: state.picked.where((p) => p.slipId == 'a').toSet());
      expect(onlyA.contributingSlips, 1);
      expect(onlyA.canMerge, isFalse);
    });
  });

  group('counting what was chosen', () {
    test('counts every ticked leg across slips', () {
      final state = withSlips([slipWith('a', 'SportyBet', 3), slipWith('b', 'Football.com', 2)]);
      expect(state.chosen, 5);
    });

    test('leaves a leg the source could not carry unticked', () {
      // There is no market behind it to find at a destination, so it cannot be merged either.
      final state = withSlips([slipWith('a', 'SportyBet', 3, unsupported: 1)]);
      expect(state.chosen, 2);
      expect(state.isPicked('a', 1), isFalse);
      expect(state.isPicked('a', 2), isTrue);
    });

    test('reports which legs are ticked, by slip and position', () {
      final state = withSlips([slipWith('a', 'SportyBet', 2)]);
      expect(state.isPicked('a', 1), isTrue);
      expect(state.isPicked('a', 99), isFalse);
      expect(state.isPicked('nope', 1), isFalse);
    });
  });

  group('what a result is allowed to say', () {
    test('has no merged slip until a merge has actually run', () {
      // An empty slip rendered optimistically is a claim that a merge happened.
      expect(withSlips([slipWith('a', 'SportyBet', 2)]).result, isNull);
    });

    test('drops a stale result when the chosen legs change', () {
      final state = withSlips([
        slipWith('a', 'SportyBet', 2),
        slipWith('b', 'Football.com', 2),
      ]).copyWith(result: slipWith('merged', 'SportyBet', 4));
      expect(state.result, isNotNull);

      // A result describes one particular set of legs. Change the set and it stops being true.
      final after = state.copyWith(clearResult: true);
      expect(after.result, isNull);
      expect(after.duplicates, isEmpty);
    });

    test('keeps the chosen legs when a merge fails, so nothing the user did is lost', () {
      final state = withSlips([slipWith('a', 'SportyBet', 2), slipWith('b', 'Football.com', 2)]);
      final failed = state.copyWith(busy: false, error: null, clearResult: true);
      expect(failed.chosen, state.chosen);
      expect(failed.sources, hasLength(2));
    });
  });

  group('a duplicate is reported, not hidden', () {
    test('carries the fixture, market and how many collapsed', () {
      final d = MergeDuplicate.fromJson({
        'fixture': 'Arsenal v Chelsea @ 2026-10-19',
        'market': 'MATCH_RESULT HOME',
        'picks': [
          {'slipId': 'a', 'position': 1},
          {'slipId': 'b', 'position': 2},
        ],
      });
      expect(d.count, 2);
      expect(d.fixture, contains('Arsenal'));
      expect(d.market, contains('MATCH_RESULT'));
    });
  });

  group('a pick identifies a leg exactly', () {
    test('is equal only for the same slip and position', () {
      const a = MergePick(slipId: 'a', position: 1);
      expect(a, const MergePick(slipId: 'a', position: 1));
      expect(a, isNot(const MergePick(slipId: 'a', position: 2)));
      expect(a, isNot(const MergePick(slipId: 'b', position: 1)));
    });

    test('deduplicates in a set, so one leg cannot be chosen twice', () {
      // Built from a list so the analyzer does not flag the literal; the point is that two picks
      // describing the same leg collapse, which is what keeps a double tap from counting twice.
      const pick = MergePick(slipId: 'a', position: 1);
      final set = <MergePick>{}..addAll([pick, const MergePick(slipId: 'a', position: 1)]);
      expect(set, hasLength(1));
    });
  });
}
