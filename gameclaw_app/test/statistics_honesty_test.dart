import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';

/// Absent statistics must never read as confirmed zeros.
///
/// This is the half of "incomplete match statistics" that is not a bug to fix: the provider
/// genuinely has no shot counts for a Qatari second-division game, and the only honest thing to
/// do is say so. The parsing is what keeps that true, and nothing tested it - so a change that
/// turned a missing count into 0 would have shipped looking like an improvement.
TeamStatistics parse(Map<String, dynamic> json) =>
    TeamStatistics.fromJson(json);

void main() {
  group('a count the provider did not report stays null', () {
    test('an absent field is null, not zero', () {
      final stats = parse({
        'team': {'id': 1, 'name': 'Everton', 'logo': null},
      });
      // Every one of these is "not reported". Rendering them as 0 would state as fact that
      // Everton had no shots, which the provider never said.
      expect(stats.possession, isNull);
      expect(stats.shotsTotal, isNull);
      expect(stats.shotsOnGoal, isNull);
      expect(stats.corners, isNull);
      expect(stats.fouls, isNull);
      expect(stats.passesTotal, isNull);
    });

    test('an explicit null is null', () {
      final stats = parse({
        'team': {'id': 1, 'name': 'Everton', 'logo': null},
        'shotsTotal': null,
        'corners': null,
      });
      expect(stats.shotsTotal, isNull);
      expect(stats.corners, isNull);
    });

    test('a reported zero is kept as zero', () {
      final stats = parse({
        'team': {'id': 1, 'name': 'Everton', 'logo': null},
        'shotsOnGoal': 0,
        'corners': 0,
      });
      // The other direction, and it matters just as much: nil shots on target is a real and
      // interesting fact when the provider actually says so.
      expect(stats.shotsOnGoal, 0);
      expect(stats.corners, 0);
    });
  });

  group('coverage says what a competition publishes at all', () {
    test('a competition with no statistics coverage is distinguishable', () {
      final coverage = Coverage.fromJson({
        'events': true,
        'lineups': false,
        'statistics': false,
        'playerStats': false,
        'standings': false,
      });
      // Measured on 2026-10-17: Qatar Second Division, Argentina Primera B and C, Nicaragua
      // Primera Division and the Northern Ireland League Cup all come back like this.
      expect(coverage.events, isTrue);
      expect(coverage.statistics, isFalse);
      expect(coverage.lineups, isFalse);
    });

    test('a missing coverage object is not read as full coverage', () {
      final coverage = Coverage.fromJson(const <String, dynamic>{});
      // Defaulting these to true would promise shots and corners for every competition and then
      // show an empty grid for the ones that have none.
      expect(coverage.events, isFalse);
      expect(coverage.statistics, isFalse);
      expect(coverage.standings, isFalse);
    });
  });
}
