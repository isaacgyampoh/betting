import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/features/match/analyst_sheet.dart';

/// The starter questions must describe what this fixture can actually answer.
///
/// Offering "what do the match statistics show" on a competition that reports none sends the
/// analyst to say it has no numbers, every time, and a feature that fails on its own suggestion
/// is one nobody opens twice.

const _home = Team(id: 1, name: 'Hearts of Oak');
const _away = Team(id: 2, name: 'Kotoko');
const _league = Competition(id: 1, name: 'Premier League', country: 'Ghana');

Fixture _fixture(MatchStatus status) => Fixture(
  id: 99,
  kickoffUtc: DateTime.utc(2026, 10, 24, 17, 30),
  status: status,
  statusLabel: status == MatchStatus.finished ? 'Match Finished' : "62'",
  competition: _league,
  home: _home,
  away: _away,
);

TeamStatistics _stats(Team team) => TeamStatistics.fromJson({
  'team': {'id': team.id, 'name': team.name, 'logo': null},
  'shotsTotal': 11,
});

MatchDetail _detail({
  MatchStatus status = MatchStatus.scheduled,
  List<TeamStatistics> statistics = const [],
  List<MatchEvent> events = const [],
  List<Fixture> headToHead = const [],
}) => MatchDetail(
  fixture: _fixture(status),
  events: events,
  coverage: null,
  unavailable: const [],
  fetchedAt: DateTime.utc(2026, 10, 24, 18),
  statistics: statistics,
  headToHead: headToHead,
);

void main() {
  test('always offers the questions any fixture can answer', () {
    final q = matchAnalystStarters(_detail());
    expect(q, contains('How have both teams been playing?'));
    expect(q, contains('Compare the home side at home with the away side away.'));
    expect(q, contains('What is missing from this picture?'));
  });

  test('does not offer statistics when the competition reports none', () {
    final q = matchAnalystStarters(_detail());
    expect(q.any((s) => s.contains('statistics')), isFalse);
  });

  test('offers statistics once both sides have them', () {
    final q = matchAnalystStarters(
      _detail(status: MatchStatus.live, statistics: [_stats(_home), _stats(_away)]),
    );
    expect(q, contains('What do the match statistics show?'));
  });

  test('asks about half-time only for a game that has been played', () {
    const goal = MatchEvent(minute: 51, isHome: true, type: MatchEventType.goal, detail: 'Normal Goal');

    final before = matchAnalystStarters(_detail(events: const [goal]));
    expect(before.any((s) => s.contains('half-time')), isFalse);

    final after = matchAnalystStarters(
      _detail(status: MatchStatus.finished, events: const [goal]),
    );
    expect(after, contains('What changed after half-time?'));
  });

  test('offers head-to-head only when there are previous meetings', () {
    expect(matchAnalystStarters(_detail()).any((s) => s.contains('head-to-head')), isFalse);
    final q = matchAnalystStarters(_detail(headToHead: [_fixture(MatchStatus.finished)]));
    expect(q, contains('What does their head-to-head suggest?'));
  });

  test('asks about risks only before kick-off', () {
    expect(matchAnalystStarters(_detail()), contains('What are the main risks either way?'));
    expect(
      matchAnalystStarters(_detail(status: MatchStatus.finished)).any((s) => s.contains('risks')),
      isFalse,
    );
  });
}
