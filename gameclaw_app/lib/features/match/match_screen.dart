import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/tokens.dart';
import '../../ui/async_view.dart';
import '../../ui/fixture_tile.dart';
import '../../ui/section.dart';

/// One match, in as much depth as the competition actually publishes.
///
/// Every panel here can be absent, and each absence has a different cause and a different wording:
/// a competition that carries no timeline, a plan that did not return one, a provider that was
/// momentarily busy, and a match that has simply had nothing happen yet are four different things.
/// Collapsing them into one empty state is what makes an app feel broken on exactly the leagues
/// outside the big five.
class MatchScreen extends ConsumerWidget {
  const MatchScreen({super.key, required this.fixtureId});

  final int fixtureId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final request = ref.watch(matchDetailProvider(fixtureId));

    return Scaffold(
      appBar: AppBar(title: const Text('Match')),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(matchDetailProvider(fixtureId).future),
        child: GcAsyncView<MatchDetail>(
          value: request,
          onRetry: () => ref.invalidate(matchDetailProvider(fixtureId)),
          builder: (context, cached) => _Detail(cached: cached),
        ),
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.cached});

  final Cached<MatchDetail> cached;

  @override
  Widget build(BuildContext context) {
    final detail = cached.value;
    final coverage = detail.coverage;

    return ListView(
      padding: const EdgeInsets.only(bottom: GcSpace.xxl),
      children: [
        if (cached.fromCache) GcStaleBanner(fetchedAt: cached.fetchedAt),
        if (detail.busy)
          const GcNote('Some sections were busy at the stats provider. Pull down in a minute to fill them.'),
        _Scoreline(fixture: detail.fixture),

        _Timeline(
          events: detail.events,
          coverage: coverage,
          unavailable: detail.unavailable.contains('events'),
          status: detail.fixture.status,
        ),

        if (detail.homeForm != null && detail.awayForm != null)
          _Form(home: detail.homeForm!, away: detail.awayForm!)
        else if (detail.unavailable.contains('form'))
          const GcSection(
            title: 'Form',
            child: GcNote("Recent form isn't included for this competition on our stats plan."),
          ),

        if (detail.headToHead.isNotEmpty)
          GcSection(
            title: 'Previous meetings',
            child: Column(
              children: [
                for (final match in detail.headToHead) GcFixtureTile(fixture: match),
              ],
            ),
          )
        else if (detail.unavailable.contains('h2h'))
          const GcSection(
            title: 'Previous meetings',
            child: GcNote("Head-to-head isn't included for this competition on our stats plan."),
          ),

        if (detail.standings != null && detail.standings!.isNotEmpty)
          _Table(rows: detail.standings!, highlight: {detail.fixture.home.id, detail.fixture.away.id})
        else if (coverage != null && !coverage.standings)
          const GcSection(
            title: 'Table',
            child: GcNote('This competition has no league table - it is a cup or a friendly.'),
          ),

        // Statistics are the panel most often missing: on the leagues outside the big five the
        // provider carries about one fixture in six. Rather than an empty grid, say so.
        if (coverage != null && !coverage.statistics)
          const GcSection(
            title: 'Team statistics',
            child: GcNote(
              "This competition doesn't publish shots, corners or possession. "
              'Nothing is estimated to fill the gap.',
            ),
          ),

        Padding(
          padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.lg, GcSpace.lg, 0),
          child: Text(
            'Updated ${DateFormat.Hm().format(cached.fetchedAt.toLocal())}',
            style: GcType.caption.copyWith(color: GcColors.inkFaint),
          ),
        ),
      ],
    );
  }
}

class _Scoreline extends StatelessWidget {
  const _Scoreline({required this.fixture});

  final Fixture fixture;

  @override
  Widget build(BuildContext context) {
    final live = fixture.status.isLive;
    final kickoff = DateFormat('E d MMM, HH:mm').format(fixture.kickoffUtc.toLocal());

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.lg, GcSpace.lg, GcSpace.xl),
      color: GcColors.surface,
      child: Column(
        children: [
          Text(
            '${fixture.competition.country} · ${fixture.competition.name}',
            style: GcType.caption,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: GcSpace.lg),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _Side(team: fixture.home)),
              Column(
                children: [
                  Text(
                    fixture.hasScore ? '${fixture.homeGoals} – ${fixture.awayGoals}' : 'v',
                    style: GcType.display.copyWith(
                      fontFeatures: const [FontFeature.tabularFigures()],
                      color: live ? GcColors.live : GcColors.ink,
                    ),
                  ),
                  const SizedBox(height: GcSpace.xs),
                  Text(
                    live ? fixture.statusLabel : (fixture.status.isDone ? 'Full time' : kickoff),
                    style: GcType.caption.copyWith(color: live ? GcColors.live : GcColors.inkMuted),
                    textAlign: TextAlign.center,
                  ),
                  // Shown only when the provider reported it. A half-time score is available on
                  // about nine finished matches in ten, and it is absent rather than nil-nil on
                  // the rest.
                  if (fixture.halfTimeHome != null && fixture.halfTimeAway != null) ...[
                    const SizedBox(height: GcSpace.xs),
                    Text(
                      'HT ${fixture.halfTimeHome}–${fixture.halfTimeAway}',
                      style: GcType.caption.copyWith(color: GcColors.inkFaint),
                    ),
                  ],
                ],
              ),
              Expanded(child: _Side(team: fixture.away)),
            ],
          ),
        ],
      ),
    );
  }
}

class _Side extends StatelessWidget {
  const _Side({required this.team});

  final Team team;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox(
          height: 44,
          width: 44,
          child: team.logoUrl == null || team.logoUrl!.isEmpty
              ? const SizedBox.shrink()
              : Image.network(team.logoUrl!, errorBuilder: (_, __, ___) => const SizedBox.shrink()),
        ),
        const SizedBox(height: GcSpace.sm),
        Text(team.name, style: GcType.heading, textAlign: TextAlign.center, maxLines: 2),
      ],
    );
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({
    required this.events,
    required this.coverage,
    required this.unavailable,
    required this.status,
  });

  final List<MatchEvent> events;
  final Coverage? coverage;
  final bool unavailable;
  final MatchStatus status;

  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) {
      // Four different reasons for an empty timeline, in the order that makes them distinguishable.
      final String note;
      if (coverage != null && !coverage!.events) {
        note = "This competition doesn't publish a timeline, so there is nothing to show here.";
      } else if (unavailable) {
        note = "A timeline isn't included for this competition on our stats plan.";
      } else if (status == MatchStatus.scheduled) {
        note = 'Nothing has happened yet - the match has not kicked off.';
      } else {
        note = 'No goals, cards or substitutions have been reported.';
      }
      return GcSection(title: 'Timeline', child: GcNote(note));
    }

    return GcSection(
      title: 'Timeline',
      padded: false,
      child: Column(
        children: [for (final event in events) _EventRow(event: event)],
      ),
    );
  }
}

class _EventRow extends StatelessWidget {
  const _EventRow({required this.event});

  final MatchEvent event;

  (IconData, Color) get _mark => switch (event.type) {
        MatchEventType.goal || MatchEventType.penalty => (Icons.sports_soccer, GcColors.ink),
        MatchEventType.ownGoal => (Icons.sports_soccer, GcColors.loss),
        MatchEventType.penaltyMissed => (Icons.block_rounded, GcColors.inkFaint),
        MatchEventType.yellow => (Icons.square_rounded, GcColors.warn),
        MatchEventType.secondYellow || MatchEventType.red => (Icons.square_rounded, GcColors.loss),
        MatchEventType.substitution => (Icons.swap_horiz_rounded, GcColors.inkMuted),
        MatchEventType.varReview => (Icons.videocam_outlined, GcColors.inkMuted),
        MatchEventType.unknown => (Icons.circle, GcColors.inkFaint),
      };

  @override
  Widget build(BuildContext context) {
    final (icon, colour) = _mark;
    // The home side's events sit left, the away side's right, so the run of play is readable
    // without reading a single name.
    final detail = Row(
      mainAxisAlignment: event.isHome ? MainAxisAlignment.start : MainAxisAlignment.end,
      children: [
        if (!event.isHome) ...[
          Flexible(child: _Names(event: event, alignRight: true)),
          const SizedBox(width: GcSpace.sm),
        ],
        Icon(icon, size: 14, color: colour),
        if (event.isHome) ...[
          const SizedBox(width: GcSpace.sm),
          Flexible(child: _Names(event: event, alignRight: false)),
        ],
      ],
    );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.lg, vertical: GcSpace.sm),
      child: Row(
        children: [
          SizedBox(
            width: 40,
            child: Text(event.minuteLabel, style: GcType.figure.copyWith(fontSize: 12, color: GcColors.inkMuted)),
          ),
          Expanded(child: detail),
        ],
      ),
    );
  }
}

class _Names extends StatelessWidget {
  const _Names({required this.event, required this.alignRight});

  final MatchEvent event;
  final bool alignRight;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: alignRight ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        Text(event.label, style: GcType.body.copyWith(fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
        if (event.other != null)
          Text(event.other!, style: GcType.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
      ],
    );
  }
}

class _Form extends StatelessWidget {
  const _Form({required this.home, required this.away});

  final TeamForm home;
  final TeamForm away;

  @override
  Widget build(BuildContext context) {
    return GcSection(
      title: 'Recent form',
      child: Column(
        children: [
          _FormRow(form: home),
          const SizedBox(height: GcSpace.lg),
          _FormRow(form: away),
        ],
      ),
    );
  }
}

class _FormRow extends StatelessWidget {
  const _FormRow({required this.form});

  final TeamForm form;

  @override
  Widget build(BuildContext context) {
    final s = form.summary;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(form.team.name, style: GcType.label, maxLines: 1, overflow: TextOverflow.ellipsis)),
            // Most recent first, which is the order people read form in.
            for (final game in form.games.take(6).toList().reversed) _Pip(result: game.result),
          ],
        ),
        const SizedBox(height: GcSpace.sm),
        Text(
          s.played == 0
              // A rate over zero games is not 0% - it is not a number yet.
              ? 'No games on record.'
              : '${s.won}W ${s.drawn}D ${s.lost}L · ${s.goalsFor}-${s.goalsAgainst} · '
                  'both scored in ${(s.bttsRate * 100).round()}%, over 2.5 in ${(s.over25Rate * 100).round()}% '
                  'of ${s.played}',
          style: GcType.caption,
        ),
      ],
    );
  }
}

class _Pip extends StatelessWidget {
  const _Pip({required this.result});

  final FormResult result;

  @override
  Widget build(BuildContext context) {
    final colour = switch (result) {
      FormResult.win => GcColors.win,
      FormResult.draw => GcColors.inkFaint,
      FormResult.loss => GcColors.loss,
    };
    return Container(
      margin: const EdgeInsets.only(left: GcSpace.xs),
      width: 18,
      height: 18,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: colour.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(GcRadius.sm),
      ),
      child: Text(result.letter, style: GcType.caption.copyWith(color: colour, fontWeight: FontWeight.w700, fontSize: 10)),
    );
  }
}

class _Table extends StatelessWidget {
  const _Table({required this.rows, required this.highlight});

  final List<StandingRow> rows;
  final Set<int> highlight;

  @override
  Widget build(BuildContext context) {
    final blocks = StandingsBlock.split(rows);

    return GcSection(
      title: 'Table',
      padded: false,
      child: Column(
        children: [
          if (blocks.length > 1)
            Padding(
              padding: const EdgeInsets.fromLTRB(GcSpace.lg, 0, GcSpace.lg, GcSpace.md),
              child: Text(
                // Said rather than papered over: the groups are plainly there in the ranks, and
                // the provider does not name them, so neither do we.
                'This competition is played in ${blocks.length} groups. '
                'The provider does not name them, so they are shown in the order it gave.',
                style: GcType.caption,
              ),
            ),
          for (final (index, block) in blocks.indexed) ...[
            if (index > 0) const Divider(height: GcSpace.lg, indent: GcSpace.lg, endIndent: GcSpace.lg),
            _Block(rows: block.rows, highlight: highlight),
          ],
        ],
      ),
    );
  }
}

class _Block extends StatelessWidget {
  const _Block({required this.rows, required this.highlight});

  final List<StandingRow> rows;
  final Set<int> highlight;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
          for (final row in rows)
            Container(
              color: highlight.contains(row.team.id) ? GcColors.accent.withValues(alpha: 0.08) : null,
              padding: const EdgeInsets.symmetric(horizontal: GcSpace.lg, vertical: GcSpace.sm),
              child: Row(
                children: [
                  SizedBox(width: 22, child: Text('${row.rank}', style: GcType.figure.copyWith(fontSize: 12, color: GcColors.inkMuted))),
                  Expanded(child: Text(row.team.name, style: GcType.body.copyWith(fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis)),
                  SizedBox(width: 28, child: Text('${row.played}', textAlign: TextAlign.right, style: GcType.figure.copyWith(fontSize: 12, color: GcColors.inkMuted))),
                  SizedBox(
                    width: 34,
                    child: Text(
                      row.goalDifference > 0 ? '+${row.goalDifference}' : '${row.goalDifference}',
                      textAlign: TextAlign.right,
                      style: GcType.figure.copyWith(fontSize: 12, color: GcColors.inkMuted),
                    ),
                  ),
                  SizedBox(width: 32, child: Text('${row.points}', textAlign: TextAlign.right, style: GcType.figure.copyWith(fontSize: 13))),
                ],
              ),
            ),
      ],
    );
  }
}
