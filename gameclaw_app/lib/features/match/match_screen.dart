import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_crest.dart';
import '../../ui/components/gc_fixture_row.dart';
import '../../ui/components/gc_live.dart';
import '../../ui/components/gc_pitch.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_states.dart';
import '../../ui/components/gc_tabs.dart';

/// One match, in as much depth as the competition actually publishes.
///
/// Every section here can be absent, and each absence has a different cause and a different
/// wording: a competition that carries no timeline, a plan that did not return one, a provider
/// that was momentarily busy, and a match that has simply had nothing happen yet are four
/// different things. Collapsing them into one empty state is what makes an app feel broken on
/// exactly the competitions outside the big five.
///
/// Tabs appear only when there is something behind them. A Statistics tab that is always empty is
/// worse than no tab: it promises data the provider does not give us, every single time.
class MatchScreen extends ConsumerStatefulWidget {
  const MatchScreen({super.key, required this.fixtureId});

  final int fixtureId;

  @override
  ConsumerState<MatchScreen> createState() => _MatchScreenState();
}

class _MatchScreenState extends ConsumerState<MatchScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final request = ref.watch(matchDetailProvider(widget.fixtureId));
    final favourites = ref.watch(favouriteIdsProvider).value ?? const <int>{};

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: request.when(
          skipLoadingOnRefresh: true,
          loading: () => const _Loading(),
          error: (error, _) => Column(
            children: [
              const _BackBar(),
              Expanded(
                child: GcError(
                  error: error,
                  onRetry: () => ref.invalidate(matchDetailProvider(widget.fixtureId)),
                ),
              ),
            ],
          ),
          data: (cached) => _Detail(
            cached: cached,
            tab: _tab,
            onTab: (i) => setState(() => _tab = i),
            favourites: favourites,
            onToggleFavourite: (team) => ref.read(toggleFavouriteProvider)(team),
            onRefresh: () => ref.refresh(matchDetailProvider(widget.fixtureId).future),
          ),
        ),
      ),
    );
  }
}

class _BackBar extends StatelessWidget {
  const _BackBar({this.trailing});

  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        GcIconButton(
          icon: Icons.arrow_back_rounded,
          colour: GcColors.ink,
          tooltip: 'Back',
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        const Spacer(),
        if (trailing != null) trailing!,
      ],
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _BackBar(),
        const SizedBox(height: GcSpace.xl),
        Center(
          child: Column(
            children: const [
              GcSkeleton(width: 140, height: 11),
              SizedBox(height: GcSpace.xl),
              GcSkeleton(width: 200, height: 44, radius: GcRadius.sm),
              SizedBox(height: GcSpace.md),
              GcSkeleton(width: 90, height: 11),
            ],
          ),
        ),
        const SizedBox(height: GcSpace.xxl),
        const Expanded(child: GcFixtureSkeleton(rows: 4)),
      ],
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({
    required this.cached,
    required this.tab,
    required this.onTab,
    required this.favourites,
    required this.onToggleFavourite,
    required this.onRefresh,
  });

  final Cached<MatchDetail> cached;
  final int tab;
  final ValueChanged<int> onTab;
  final Set<int> favourites;
  final ValueChanged<Team> onToggleFavourite;
  final Future<void> Function() onRefresh;

  /// Only the tabs with something behind them.
  List<(String, Widget)> _tabs(MatchDetail detail) {
    final table = detail.standings;
    return [
      ('Overview', _Overview(detail: detail)),
      ('Timeline', _Timeline(detail: detail)),
      // Only when the provider actually returned them. A Statistics tab that is always empty
      // promises data this competition does not carry, every single time it is opened.
      if (detail.statistics.length >= 2) ('Stats', _Statistics(stats: detail.statistics)),
      if (detail.lineups.length >= 2) ('Lineups', _Lineups(lineups: detail.lineups)),
      if (table != null && table.isNotEmpty)
        ('Table', _Table(rows: table, highlight: {detail.fixture.home.id, detail.fixture.away.id})),
      if (detail.headToHead.isNotEmpty) ('H2H', _HeadToHead(matches: detail.headToHead)),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final detail = cached.value;
    final tabs = _tabs(detail);
    final index = tab.clamp(0, tabs.length - 1);

    return Column(
      children: [
        _BackBar(
          trailing: Row(
            children: [
              GcIconButton(
                icon: favourites.contains(detail.fixture.home.id)
                    ? Icons.star_rounded
                    : Icons.star_outline_rounded,
                colour: favourites.contains(detail.fixture.home.id) ? GcColors.accent : null,
                tooltip: 'Follow ${detail.fixture.home.name}',
                onPressed: () => onToggleFavourite(detail.fixture.home),
              ),
              GcIconButton(icon: Icons.refresh_rounded, tooltip: 'Refresh', onPressed: onRefresh),
            ],
          ),
        ),
        if (cached.fromCache) GcStaleBar(fetchedAt: cached.fetchedAt),
        _ScoreHero(fixture: detail.fixture),
        if (detail.busy)
          const Padding(
            padding: EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.md, GcSpace.gutter, 0),
            child: GcNote(
              'Some sections were busy at the stats provider. Pull down in a minute to fill them.',
              icon: Icons.hourglass_empty_rounded,
            ),
          ),
        const SizedBox(height: GcSpace.sm),
        if (tabs.length > 1) ...[
          GcTabBar(tabs: [for (final t in tabs) t.$1], index: index, onChanged: onTab),
          const Divider(height: 1),
        ],
        Expanded(
          child: RefreshIndicator(
            color: GcColors.accent,
            backgroundColor: GcColors.surfaceRaised,
            onRefresh: onRefresh,
            child: AnimatedSwitcher(
              duration: GcMotion.quick,
              child: KeyedSubtree(key: ValueKey(index), child: tabs[index].$2),
            ),
          ),
        ),
      ],
    );
  }
}

/// The scoreline, given the room it deserves.
class _ScoreHero extends StatelessWidget {
  const _ScoreHero({required this.fixture});

  final Fixture fixture;

  @override
  Widget build(BuildContext context) {
    final live = fixture.status.isLive;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.sm, GcSpace.gutter, GcSpace.xl),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              GcCrest(url: fixture.competition.logoUrl, name: fixture.competition.name, size: 14),
              const SizedBox(width: GcSpace.sm),
              Flexible(
                child: Text(
                  fixture.competition.country.isEmpty
                      ? fixture.competition.name
                      : '${fixture.competition.country} · ${fixture.competition.name}',
                  style: GcType.caption.copyWith(fontSize: 12),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: GcSpace.xl),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _Side(team: fixture.home)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: GcSpace.sm),
                child: Column(
                  children: [
                    Text(
                      fixture.hasScore ? '${fixture.homeGoals}–${fixture.awayGoals}' : 'vs',
                      style: fixture.hasScore
                          ? GcType.scoreHero.copyWith(color: live ? GcColors.live : GcColors.ink)
                          : GcType.display.copyWith(color: GcColors.inkFaint),
                    ),
                    const SizedBox(height: GcSpace.sm),
                    if (live)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const GcLiveDot(),
                          const SizedBox(width: GcSpace.xs + 2),
                          Text(
                            fixture.statusLabel,
                            style: GcType.figure.copyWith(color: GcColors.live),
                          ),
                        ],
                      )
                    else
                      Text(
                        fixture.status.isDone
                            ? 'Full time'
                            : DateFormat('E d MMM · HH:mm').format(fixture.kickoffUtc.toLocal()),
                        style: GcType.caption,
                        textAlign: TextAlign.center,
                      ),
                    // Shown only when the provider reported it. A half-time score is on about nine
                    // finished matches in ten, and absent rather than nil-nil on the rest.
                    if (fixture.halfTimeHome != null && fixture.halfTimeAway != null) ...[
                      const SizedBox(height: GcSpace.xs),
                      Text(
                        'HT ${fixture.halfTimeHome}–${fixture.halfTimeAway}',
                        style: GcType.figureSm.copyWith(color: GcColors.inkFaint),
                      ),
                    ],
                  ],
                ),
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
    return InkWell(
      // The crest is the obvious thing to tap to find out about a side, so it is.
      onTap: () => context.push('/home/team/${team.id}'),
      borderRadius: BorderRadius.circular(GcRadius.md),
      child: Column(
        children: [
          GcCrest(url: team.logoUrl, name: team.name, size: GcSize.crestLg),
          const SizedBox(height: GcSpace.md),
          Text(
            team.name,
            style: GcType.heading,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

class _Overview extends StatelessWidget {
  const _Overview({required this.detail});

  final MatchDetail detail;

  @override
  Widget build(BuildContext context) {
    final home = detail.homeForm;
    final away = detail.awayForm;
    final coverage = detail.coverage;

    return ListView(
      padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
      children: [
        if (home != null && away != null) ...[
          const GcSectionHeader(title: 'Recent form', dense: true),
          _FormRow(form: home),
          const SizedBox(height: GcSpace.lg),
          _FormRow(form: away),
          const SizedBox(height: GcSpace.xl),
          // Built only from numbers the server actually sent. Each bar carries its own sample
          // size, because 60% over three games and 60% over ten are different claims.
          _Compare(
            title: 'Both teams scored',
            homeValue: home.summary.bttsRate,
            awayValue: away.summary.bttsRate,
            homeSample: home.summary.played,
            awaySample: away.summary.played,
            homeName: home.team.name,
            awayName: away.team.name,
          ),
          _Compare(
            title: 'Over 2.5 goals',
            homeValue: home.summary.over25Rate,
            awayValue: away.summary.over25Rate,
            homeSample: home.summary.played,
            awaySample: away.summary.played,
            homeName: home.team.name,
            awayName: away.team.name,
          ),
        ] else if (detail.unavailable.contains('form')) ...[
          const GcSectionHeader(title: 'Recent form', dense: true),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: GcNote("Recent form isn't included for this competition on our stats plan."),
          ),
        ],

        // The panel most often missing: outside the big competitions the provider carries team
        // statistics for about one fixture in six. Say so rather than show an empty grid.
        if (coverage != null && !coverage.statistics) ...[
          const GcSectionHeader(title: 'Team statistics'),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: GcNote(
              "This competition doesn't publish shots, corners or possession. "
              'Nothing is estimated to fill the gap.',
              icon: Icons.bar_chart_rounded,
            ),
          ),
        ],

        Padding(
          padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.xl, GcSpace.gutter, 0),
          child: Text(
            'Updated ${DateFormat.Hm().format(detail.fetchedAt.toLocal())}',
            style: GcType.caption.copyWith(color: GcColors.inkFaint),
          ),
        ),
      ],
    );
  }
}

/// A two-sided comparison on one metric.
///
/// Both bars grow from the centre so the longer one is obvious without reading either number, and
/// the sample is printed because a rate without one is not a fact.
class _Compare extends StatelessWidget {
  const _Compare({
    required this.title,
    required this.homeValue,
    required this.awayValue,
    required this.homeSample,
    required this.awaySample,
    required this.homeName,
    required this.awayName,
  });

  final String title;
  final double homeValue;
  final double awayValue;
  final int homeSample;
  final int awaySample;
  final String homeName;
  final String awayName;

  @override
  Widget build(BuildContext context) {
    // A rate over zero games is not 0% - it is not a number yet.
    if (homeSample == 0 || awaySample == 0) return const SizedBox.shrink();

    final homePct = (homeValue * 100).round();
    final awayPct = (awayValue * 100).round();
    final homeLeads = homePct >= awayPct;

    Widget bar(double value, bool leading, bool fromRight) => ClipRRect(
      borderRadius: BorderRadius.circular(GcRadius.xs),
      child: Align(
        alignment: fromRight ? Alignment.centerLeft : Alignment.centerRight,
        child: FractionallySizedBox(
          widthFactor: value.clamp(0.0, 1.0),
          child: Container(height: 6, color: leading ? GcColors.accent : GcColors.borderStrong),
        ),
      ),
    );

    return Semantics(
      label: '$title: $homeName $homePct% of $homeSample, $awayName $awayPct% of $awaySample',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.lg),
        child: Column(
          children: [
            Row(
              children: [
                SizedBox(
                  width: 38,
                  child: Text(
                    '$homePct%',
                    style: GcType.figure.copyWith(
                      color: homeLeads ? GcColors.ink : GcColors.inkMuted,
                    ),
                  ),
                ),
                Expanded(
                  child: Text(title, style: GcType.caption, textAlign: TextAlign.center),
                ),
                SizedBox(
                  width: 38,
                  child: Text(
                    '$awayPct%',
                    textAlign: TextAlign.right,
                    style: GcType.figure.copyWith(
                      color: homeLeads ? GcColors.inkMuted : GcColors.ink,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: GcSpace.sm),
            Row(
              children: [
                Expanded(child: bar(homeValue, homeLeads, false)),
                const SizedBox(width: GcSpace.xs),
                Expanded(child: bar(awayValue, !homeLeads, true)),
              ],
            ),
            const SizedBox(height: GcSpace.xs + 2),
            Text(
              'over the last $homeSample and $awaySample matches',
              style: GcType.caption.copyWith(fontSize: 11, color: GcColors.inkFaint),
            ),
          ],
        ),
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
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              GcCrest(url: form.team.logoUrl, name: form.team.name),
              const SizedBox(width: GcSpace.sm),
              Expanded(
                child: Text(
                  form.team.name,
                  style: GcType.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              // Most recent first, which is the order people read form in.
              for (final game in form.games.take(6).toList().reversed) _Pip(result: game.result),
            ],
          ),
          const SizedBox(height: GcSpace.sm),
          Text(
            s.played == 0
                ? 'No games on record.'
                : '${s.won}W ${s.drawn}D ${s.lost}L  ·  ${s.goalsFor}–${s.goalsAgainst} goals  ·  ${s.played} games',
            style: GcType.caption,
          ),
        ],
      ),
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
      margin: const EdgeInsets.only(left: GcSpace.xs + 1),
      width: 19,
      height: 19,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: colour.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(GcRadius.xs + 1),
      ),
      child: Text(result.letter, style: GcType.figureSm.copyWith(color: colour, fontSize: 10.5)),
    );
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.detail});

  final MatchDetail detail;

  @override
  Widget build(BuildContext context) {
    if (detail.events.isEmpty) {
      // Four different reasons for an empty timeline, in the order that distinguishes them.
      final coverage = detail.coverage;
      final (title, note) = switch (0) {
        _ when coverage != null && !coverage.events => (
          'No timeline for this competition',
          "It doesn't publish goals, cards or substitutions, so there is nothing to show here.",
        ),
        _ when detail.unavailable.contains('events') => (
          'Timeline not included',
          "A timeline isn't part of this competition on our stats plan.",
        ),
        _ when detail.fixture.status == MatchStatus.scheduled => (
          'Not kicked off yet',
          'Events will appear here as the match goes on.',
        ),
        _ => ('Nothing has happened', 'No goals, cards or substitutions have been reported.'),
      };
      return ListView(
        children: [
          const SizedBox(height: GcSpace.xxl),
          GcEmpty(title: title, note: note, icon: Icons.timeline_rounded),
        ],
      );
    }

    // A hairline down the minute column, behind the rows. Without it the three columns read as a
    // table; with it they read as a match running top to bottom, which is what they are.
    return Stack(
      children: [
        Positioned.fill(
          child: Center(child: Container(width: 1, color: GcColors.border)),
        ),
        ListView.builder(
          padding: const EdgeInsets.symmetric(vertical: GcSpace.md).copyWith(bottom: GcSpace.xxxl),
          itemCount: detail.events.length,
          itemBuilder: (context, i) => _EventRow(event: detail.events[i]),
        ),
      ],
    );
  }
}

class _EventRow extends StatelessWidget {
  const _EventRow({required this.event});

  final MatchEvent event;

  (IconData, Color) get _mark => switch (event.type) {
    MatchEventType.goal || MatchEventType.penalty => (Icons.sports_soccer_rounded, GcColors.accent),
    MatchEventType.ownGoal => (Icons.sports_soccer_rounded, GcColors.loss),
    MatchEventType.penaltyMissed => (Icons.block_rounded, GcColors.inkFaint),
    MatchEventType.yellow => (Icons.square_rounded, GcColors.warn),
    MatchEventType.secondYellow || MatchEventType.red => (Icons.square_rounded, GcColors.loss),
    MatchEventType.substitution => (Icons.swap_horiz_rounded, GcColors.inkMuted),
    MatchEventType.varReview => (Icons.videocam_outlined, GcColors.inkMuted),
    MatchEventType.unknown => (Icons.circle, GcColors.inkFaint),
  };

  bool get _isGoal =>
      event.type == MatchEventType.goal ||
      event.type == MatchEventType.penalty ||
      event.type == MatchEventType.ownGoal;

  @override
  Widget build(BuildContext context) {
    final (icon, colour) = _mark;

    // The home side's events sit left of the spine and the away side's right, so the run of play
    // is readable without reading a single name.
    final detail = Column(
      crossAxisAlignment: event.isHome ? CrossAxisAlignment.start : CrossAxisAlignment.end,
      children: [
        Text(
          event.label,
          style: (_isGoal ? GcType.bodyStrong : GcType.body).copyWith(fontSize: 14),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: event.isHome ? TextAlign.left : TextAlign.right,
        ),
        if (event.other != null && event.other!.isNotEmpty)
          Text(
            event.other!,
            style: GcType.caption.copyWith(fontSize: 11.5),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
      ],
    );

    return Semantics(
      label: '${event.minuteLabel} ${event.label}, ${event.isHome ? 'home' : 'away'}',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: event.isHome
                  ? Row(
                      children: [
                        Icon(icon, size: 14, color: colour),
                        const SizedBox(width: GcSpace.sm),
                        Flexible(child: detail),
                      ],
                    )
                  : const SizedBox.shrink(),
            ),
            // The minute sits on the canvas colour so the spine runs behind the column but not
            // through the digits.
            Container(
              width: 46,
              alignment: Alignment.center,
              color: GcColors.canvas,
              padding: const EdgeInsets.symmetric(vertical: GcSpace.xs),
              child: Text(
                event.minuteLabel,
                style: GcType.figureSm.copyWith(color: GcColors.inkFaint),
              ),
            ),
            Expanded(
              child: event.isHome
                  ? const SizedBox.shrink()
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Flexible(child: detail),
                        const SizedBox(width: GcSpace.sm),
                        Icon(icon, size: 14, color: colour),
                      ],
                    ),
            ),
          ],
        ),
      ),
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

    return ListView(
      padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
      children: [
        if (blocks.length > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              GcSpace.gutter,
              GcSpace.lg,
              GcSpace.gutter,
              GcSpace.sm,
            ),
            child: GcNote(
              // Said rather than papered over: the groups are plainly there in the ranks, and the
              // provider does not name them, so neither do we.
              'This competition is played in ${blocks.length} groups. The provider does not name '
              'them, so they are shown in the order it gave.',
              icon: Icons.info_outline_rounded,
            ),
          ),
        const _TableHeader(),
        for (final (i, block) in blocks.indexed) ...[
          if (i > 0)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.sm),
              child: Divider(height: 1, color: GcColors.borderStrong),
            ),
          for (final row in block.rows)
            _TableRow(row: row, highlighted: highlight.contains(row.team.id)),
        ],
      ],
    );
  }
}

class _TableHeader extends StatelessWidget {
  const _TableHeader();

  @override
  Widget build(BuildContext context) {
    Widget cell(String text) => SizedBox(
      width: 30,
      child: Text(
        text,
        textAlign: TextAlign.right,
        style: GcType.overline.copyWith(fontSize: 9.5, color: GcColors.inkFaint),
      ),
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.md, GcSpace.gutter, GcSpace.sm),
      child: Row(
        children: [
          const SizedBox(width: 24),
          Expanded(
            child: Text(
              'TEAM',
              style: GcType.overline.copyWith(fontSize: 9.5, color: GcColors.inkFaint),
            ),
          ),
          cell('P'),
          cell('GD'),
          cell('PTS'),
        ],
      ),
    );
  }
}

class _TableRow extends StatelessWidget {
  const _TableRow({required this.row, required this.highlighted});

  final StandingRow row;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    Widget cell(String text, {bool strong = false}) => SizedBox(
      width: 30,
      child: Text(
        text,
        textAlign: TextAlign.right,
        style: GcType.figure.copyWith(
          fontSize: 12.5,
          color: strong ? GcColors.ink : GcColors.inkMuted,
        ),
      ),
    );

    return Container(
      color: highlighted ? GcColors.accent.withValues(alpha: 0.07) : null,
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.sm + 2),
      child: Row(
        children: [
          SizedBox(
            width: 24,
            child: Text('${row.rank}', style: GcType.figureSm.copyWith(color: GcColors.inkFaint)),
          ),
          GcCrest(url: row.team.logoUrl, name: row.team.name, size: 16),
          const SizedBox(width: GcSpace.sm),
          Expanded(
            child: Text(
              row.team.name,
              style: GcType.body.copyWith(
                fontSize: 14,
                fontWeight: highlighted ? FontWeight.w600 : FontWeight.w400,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          cell('${row.played}'),
          cell(row.goalDifference > 0 ? '+${row.goalDifference}' : '${row.goalDifference}'),
          cell('${row.points}', strong: true),
        ],
      ),
    );
  }
}

class _HeadToHead extends StatelessWidget {
  const _HeadToHead({required this.matches});

  final List<Fixture> matches;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.only(top: GcSpace.sm, bottom: GcSpace.xxxl),
      itemCount: matches.length,
      separatorBuilder: (_, __) =>
          const Divider(height: 1, indent: GcSpace.gutter, endIndent: GcSpace.gutter),
      itemBuilder: (context, i) => GcFixtureRow(fixture: matches[i]),
    );
  }
}

/// Team statistics, home against away.
///
/// A row appears only when the provider reported that statistic for both sides. One side having a
/// number and the other not is not a comparison, and showing it as 14 against 0 would invent the
/// zero - which is the one thing this product does not do.
class _Statistics extends StatelessWidget {
  const _Statistics({required this.stats});

  final List<TeamStatistics> stats;

  @override
  Widget build(BuildContext context) {
    final home = stats.first;
    final away = stats[1];

    final rows = <(String, num?, num?, bool)>[
      ('Possession', home.possession, away.possession, true),
      ('Shots', home.shotsTotal, away.shotsTotal, false),
      ('Shots on target', home.shotsOnGoal, away.shotsOnGoal, false),
      ('Shots off target', home.shotsOffGoal, away.shotsOffGoal, false),
      ('Blocked shots', home.shotsBlocked, away.shotsBlocked, false),
      ('Corners', home.corners, away.corners, false),
      ('Offsides', home.offsides, away.offsides, false),
      ('Fouls', home.fouls, away.fouls, false),
      ('Yellow cards', home.yellowCards, away.yellowCards, false),
      ('Red cards', home.redCards, away.redCards, false),
      ('Saves', home.saves, away.saves, false),
      ('Passes', home.passesTotal, away.passesTotal, false),
      ('Accurate passes', home.passesAccurate, away.passesAccurate, false),
      ('Expected goals', home.expectedGoals, away.expectedGoals, false),
    ].where((r) => r.$2 != null && r.$3 != null).toList();

    if (rows.isEmpty) {
      return ListView(
        children: const [
          SizedBox(height: GcSpace.xxl),
          GcEmpty(
            icon: Icons.bar_chart_rounded,
            title: 'No statistics reported',
            note: 'The provider returned a statistics panel for this match but no counts in it.',
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.only(top: GcSpace.md, bottom: GcSpace.xxxl),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  home.team.name,
                  style: GcType.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Expanded(
                child: Text(
                  away.team.name,
                  style: GcType.label,
                  textAlign: TextAlign.right,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: GcSpace.lg),
        for (final (label, h, a, isPercent) in rows)
          _StatRow(label: label, home: h!, away: a!, isPercent: isPercent),
      ],
    );
  }
}

/// One statistic, as two bars growing out from the middle.
///
/// The split is each side's share of the pair, so the longer bar is the bigger number without
/// reading either. When both are zero the bars are empty rather than half each - nobody had more
/// of nothing.
class _StatRow extends StatelessWidget {
  const _StatRow({
    required this.label,
    required this.home,
    required this.away,
    required this.isPercent,
  });

  final String label;
  final num home;
  final num away;
  final bool isPercent;

  String _format(num value) {
    if (isPercent) return '${value.round()}%';
    return value is int || value == value.roundToDouble()
        ? value.round().toString()
        : value.toStringAsFixed(2);
  }

  @override
  Widget build(BuildContext context) {
    final total = home + away;
    final homeShare = total == 0 ? 0.0 : home / total;
    final awayShare = total == 0 ? 0.0 : away / total;
    final homeLeads = home >= away;

    Widget bar(double share, bool leading, {required bool fromCentreRight}) => ClipRRect(
      borderRadius: BorderRadius.circular(GcRadius.xs),
      child: Align(
        alignment: fromCentreRight ? Alignment.centerLeft : Alignment.centerRight,
        child: FractionallySizedBox(
          widthFactor: share.clamp(0.0, 1.0),
          child: Container(height: 6, color: leading ? GcColors.accent : GcColors.borderStrong),
        ),
      ),
    );

    return Semantics(
      label: '$label: ${_format(home)} against ${_format(away)}',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.lg),
        child: Column(
          children: [
            Row(
              children: [
                SizedBox(
                  width: 44,
                  child: Text(
                    _format(home),
                    style: GcType.figure.copyWith(
                      color: homeLeads ? GcColors.ink : GcColors.inkMuted,
                    ),
                  ),
                ),
                Expanded(
                  child: Text(label, style: GcType.caption, textAlign: TextAlign.center),
                ),
                SizedBox(
                  width: 44,
                  child: Text(
                    _format(away),
                    textAlign: TextAlign.right,
                    style: GcType.figure.copyWith(
                      color: homeLeads ? GcColors.inkMuted : GcColors.ink,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: GcSpace.sm),
            Row(
              children: [
                Expanded(child: bar(homeShare, homeLeads, fromCentreRight: false)),
                const SizedBox(width: GcSpace.xs),
                Expanded(child: bar(awayShare, !homeLeads, fromCentreRight: true)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Lineups extends StatefulWidget {
  const _Lineups({required this.lineups});

  final List<Lineup> lineups;

  @override
  State<_Lineups> createState() => _LineupsState();
}

class _LineupsState extends State<_Lineups> {
  int _side = 0;

  @override
  Widget build(BuildContext context) {
    final lineup = widget.lineups[_side];

    return ListView(
      padding: const EdgeInsets.only(top: GcSpace.md, bottom: GcSpace.xxxl),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
          child: GcSegmented(
            segments: [for (final l in widget.lineups) l.team.name],
            index: _side,
            onChanged: (i) => setState(() => _side = i),
          ),
        ),
        const SizedBox(height: GcSpace.lg),
        if (lineup.formation != null || lineup.coach != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.md),
            child: Row(
              children: [
                if (lineup.formation != null)
                  Text(lineup.formation!, style: GcType.figure.copyWith(color: GcColors.accent)),
                const Spacer(),
                if (lineup.coach != null) Text(lineup.coach!, style: GcType.caption),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
          // A lineup without grid positions is still a real lineup. It is shown as a list rather
          // than placed on a pitch by guesswork, because a guessed shape is a claim about how a
          // team set up.
          child: lineup.canDrawPitch
              ? GcPitch(lineup: lineup)
              : _PlayerList(players: lineup.startXI),
        ),
        if (lineup.substitutes.isNotEmpty) ...[
          const GcSectionHeader(title: 'Substitutes'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: _PlayerList(players: lineup.substitutes),
          ),
        ],
      ],
    );
  }
}

class _PlayerList extends StatelessWidget {
  const _PlayerList({required this.players});

  final List<LineupPlayer> players;

  /// Goalkeeper, defence, midfield, attack.
  ///
  /// Without a grid the provider's own order is arbitrary - a real Costa Rican lineup arrived with
  /// the goalkeeper fourth. Sorting by the position letter it did give is a presentation choice
  /// made from data we have, not a formation invented from data we do not.
  static const _order = {'G': 0, 'D': 1, 'M': 2, 'F': 3};

  List<LineupPlayer> get _sorted {
    final sorted = [...players];
    sorted.sort((a, b) {
      final ra = _order[a.position] ?? 9;
      final rb = _order[b.position] ?? 9;
      return ra != rb ? ra.compareTo(rb) : (a.number ?? 99).compareTo(b.number ?? 99);
    });
    return sorted;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final player in _sorted)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: GcSpace.sm),
            child: Row(
              children: [
                SizedBox(
                  width: 26,
                  child: Text(
                    player.number?.toString() ?? '–',
                    style: GcType.figureSm.copyWith(color: GcColors.inkFaint),
                  ),
                ),
                Expanded(
                  child: Text(
                    player.name,
                    style: GcType.body.copyWith(fontSize: 14),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (player.position != null)
                  Text(
                    player.position!,
                    style: GcType.caption.copyWith(fontSize: 11, color: GcColors.inkFaint),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
