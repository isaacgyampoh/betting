import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_crest.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_states.dart';

/// One competition: what it is, and its table when it has one.
///
/// "No table" has three different causes and the screen says which: a cup has none by nature, a
/// season that has not begun has none yet, and some competitions the provider simply does not
/// publish one for. None of them is an error.
class CompetitionScreen extends ConsumerWidget {
  const CompetitionScreen({super.key, required this.competitionId});

  final int competitionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final request = ref.watch(competitionProvider(competitionId));

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Row(
              children: [
                GcIconButton(
                  icon: Icons.arrow_back_rounded,
                  colour: gc(context).ink,
                  tooltip: 'Back',
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ],
            ),
            Expanded(
              child: request.when(
                skipLoadingOnRefresh: true,
                loading: () => const GcFixtureSkeleton(rows: 6),
                error: (error, _) => GcError(
                  error: error,
                  onRetry: () => ref.invalidate(competitionProvider(competitionId)),
                ),
                data: (cached) => RefreshIndicator(
                  color: gc(context).accent,
                  backgroundColor: gc(context).surfaceRaised,
                  onRefresh: () => ref.refresh(competitionProvider(competitionId).future),
                  child: _Body(cached: cached),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.cached});

  final Cached<CompetitionPage> cached;

  @override
  Widget build(BuildContext context) {
    final page = cached.value;
    final c = page.competition;
    final table = page.standings;

    return ListView(
      padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
      children: [
        if (cached.fromCache) GcStaleBar(fetchedAt: cached.fetchedAt),
        Padding(
          padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.lg),
          child: Row(
            children: [
              GcCrest(url: c.logoUrl, name: c.name, size: 44),
              const SizedBox(width: GcSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.name, style: GcType.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: GcSpace.xxs),
                    Text(
                      [
                        if (c.country.isNotEmpty) c.country,
                        c.type,
                        if (c.season != null) '${c.season}',
                      ].join(' · '),
                      style: GcType.caption,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (table != null && table.isNotEmpty)
          _Table(rows: table)
        else
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: GcNote(
              c.isCup
                  ? 'This is a cup competition, so it has no league table.'
                  : c.coverage?.standings == false
                  ? 'The provider does not publish a table for this competition.'
                  : 'No table has been published for this season yet.',
              icon: Icons.table_rows_outlined,
            ),
          ),
        // What this competition actually carries, from its own coverage rather than assumed.
        if (c.coverage != null) ...[
          const GcSectionHeader(title: 'What this competition publishes'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: Wrap(
              spacing: GcSpace.sm,
              runSpacing: GcSpace.sm,
              children: [
                _Flag(label: 'Timeline', on: c.coverage!.events),
                _Flag(label: 'Line-ups', on: c.coverage!.lineups),
                _Flag(label: 'Statistics', on: c.coverage!.statistics),
                _Flag(label: 'Table', on: c.coverage!.standings),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// One coverage fact, stated either way. A competition that carries no statistics says so here
/// rather than leaving the user to discover it one empty match centre at a time.
class _Flag extends StatelessWidget {
  const _Flag({required this.label, required this.on});

  final String label;
  final bool on;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.sm),
      decoration: BoxDecoration(
        color: gc(context).surface,
        borderRadius: BorderRadius.circular(GcRadius.pill),
        border: Border.all(color: on ? gc(context).accentDim : gc(context).border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            on ? Icons.check_rounded : Icons.remove_rounded,
            size: 13,
            color: on ? gc(context).accent : gc(context).inkFaint,
          ),
          const SizedBox(width: GcSpace.xs + 2),
          Text(
            label,
            style: GcType.caption.copyWith(color: on ? gc(context).ink : gc(context).inkFaint),
          ),
        ],
      ),
    );
  }
}

class _Table extends StatelessWidget {
  const _Table({required this.rows});

  final List<StandingRow> rows;

  @override
  Widget build(BuildContext context) {
    final blocks = StandingsBlock.split(rows);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (blocks.length > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.sm),
            child: GcNote(
              'Played in ${blocks.length} groups. The provider does not name them, so they are '
              'shown in the order it gave.',
              icon: Icons.info_outline_rounded,
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            GcSpace.gutter,
            GcSpace.md,
            GcSpace.gutter,
            GcSpace.sm,
          ),
          child: Row(
            children: [
              const SizedBox(width: 24),
              Expanded(
                child: Text(
                  'TEAM',
                  style: GcType.overline.copyWith(fontSize: 9.5, color: gc(context).inkFaint),
                ),
              ),
              for (final h in ['P', 'GD', 'PTS'])
                SizedBox(
                  width: 30,
                  child: Text(
                    h,
                    textAlign: TextAlign.right,
                    style: GcType.overline.copyWith(fontSize: 9.5, color: gc(context).inkFaint),
                  ),
                ),
            ],
          ),
        ),
        for (final (i, block) in blocks.indexed) ...[
          if (i > 0)
            Padding(
              padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.sm),
              child: Divider(height: 1, color: gc(context).borderStrong),
            ),
          for (final row in block.rows)
            InkWell(
              // Straight through to the team, which is the thing a table is usually read to find.
              onTap: () => context.push('/home/team/${row.team.id}'),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: GcSpace.gutter,
                  vertical: GcSpace.sm + 2,
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: 24,
                      child: Text(
                        '${row.rank}',
                        style: GcType.figureSm.copyWith(color: gc(context).inkFaint),
                      ),
                    ),
                    GcCrest(url: row.team.logoUrl, name: row.team.name, size: 16),
                    const SizedBox(width: GcSpace.sm),
                    Expanded(
                      child: Text(
                        row.team.name,
                        style: GcType.body.copyWith(fontSize: 14),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    for (final v in [
                      '${row.played}',
                      row.goalDifference > 0 ? '+${row.goalDifference}' : '${row.goalDifference}',
                    ])
                      SizedBox(
                        width: 30,
                        child: Text(
                          v,
                          textAlign: TextAlign.right,
                          style: GcType.figure.copyWith(
                            fontSize: 12.5,
                            color: gc(context).inkMuted,
                          ),
                        ),
                      ),
                    SizedBox(
                      width: 30,
                      child: Text(
                        '${row.points}',
                        textAlign: TextAlign.right,
                        style: GcType.figure.copyWith(fontSize: 12.5),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ],
    );
  }
}
