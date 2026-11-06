import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_special_slip_card.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_states.dart';

/// The Daily Special Slip: one researched accumulator a day.
///
/// One publication, not a stack of cards. The legs are rows inside a single panel because they are
/// one bet - an accumulator shown as separate cards invites reading each as its own tip, which is
/// what this replaced.
class SpecialPicksScreen extends ConsumerWidget {
  const SpecialPicksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(specialPicksProvider);

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(GcSpace.sm, GcSpace.sm, GcSpace.gutter, GcSpace.sm),
              child: Row(
                children: [
                  GcIconButton(
                    icon: Icons.arrow_back_rounded,
                    colour: gc(context).ink,
                    tooltip: 'Back',
                    onPressed: () => context.canPop() ? context.pop() : context.go('/claw'),
                  ),
                  const SizedBox(width: GcSpace.xs),
                  Expanded(child: Text('Special slip', style: GcType.display)),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                color: gc(context).accentInk,
                backgroundColor: gc(context).surfaceRaised,
                onRefresh: () => ref.refresh(specialPicksProvider.future),
                child: view.when(
                  skipLoadingOnRefresh: true,
                  loading: () => const GcFixtureSkeleton(rows: 3),
                  error: (error, _) => ListView(
                    children: [
                      const SizedBox(height: GcSpace.xxl),
                      GcError(error: error, onRetry: () => ref.invalidate(specialPicksProvider)),
                    ],
                  ),
                  data: (cached) => _Body(cached: cached),
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

  final Cached<SpecialPicksView> cached;

  @override
  Widget build(BuildContext context) {
    final view = cached.value;

    return ListView(
      padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
      children: [
        if (cached.fromCache) GcStaleBar(fetchedAt: cached.fetchedAt),
        Padding(
          padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.xs, GcSpace.gutter, 0),
          child: Text(
            'One researched accumulator a day: two or three matches in statistical markets — corners, '
            'shots, shots on target — combined to about ${view.target}.00. Every leg has to land. Some '
            'days no combination reaches the target.',
            style: GcType.body.copyWith(color: gc(context).inkMuted),
          ),
        ),
        const GcSectionHeader(title: 'Today'),
        if (view.today == null)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: GcNote(
              'No slip today. Either the research has not run yet, or no combination reached the '
              'target — which is a normal day, not a fault.',
              icon: Icons.inbox_outlined,
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: GcSpecialSlipCard(slip: view.today!),
          ),
        const GcSectionHeader(title: 'The record'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
          child: _Record(record: view.performance),
        ),
        const SizedBox(height: GcSpace.xl),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter),
          child: GcNote(
            'Research, not a guarantee. The estimate beside each selection is ours, from the teams’ '
            'recent matches; the odds are the bookmaker’s and move after publishing.',
            icon: Icons.info_outline_rounded,
          ),
        ),
      ],
    );
  }
}

/// The published record. Losses counted, voids reported as voids, nothing excluded to improve it.
class _Record extends StatelessWidget {
  const _Record({required this.record});

  final SpecialPerformance record;

  @override
  Widget build(BuildContext context) {
    if (record.total == 0) {
      return const GcNote(
        'No slips have been published yet. This fills in automatically, wins and losses alike.',
        icon: Icons.history_rounded,
      );
    }

    final profit = record.profitUnits;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            // Null until something settles. Zero settled is not a 0% win rate.
            Text(
              record.winRate == null ? '–' : '${(record.winRate! * 100).round()}%',
              style: GcType.hero.copyWith(
                fontFeatures: const [FontFeature.tabularFigures()],
                color: gc(context).ink,
              ),
            ),
            const SizedBox(width: GcSpace.sm),
            Padding(
              padding: const EdgeInsets.only(bottom: GcSpace.xs + 2),
              child: Text('win rate', style: GcType.caption),
            ),
          ],
        ),
        const SizedBox(height: GcSpace.lg),
        Row(
          children: [
            // Settled, not published: a slip still running is not evidence of anything yet.
            _Stat(label: 'Settled', value: '${record.settled}'),
            _Stat(label: 'Won', value: '${record.won}', colour: gc(context).win),
            _Stat(label: 'Lost', value: '${record.lost}', colour: gc(context).loss),
            if (record.pending > 0) _Stat(label: 'Running', value: '${record.pending}'),
            if (record.voided > 0) _Stat(label: 'Void', value: '${record.voided}'),
          ],
        ),
        if (record.stakedUnits > 0) ...[
          const SizedBox(height: GcSpace.lg),
          Container(
            padding: const EdgeInsets.all(GcSpace.md),
            decoration: BoxDecoration(
              color: gc(context).surface,
              borderRadius: BorderRadius.circular(GcRadius.md),
              border: Border.all(color: gc(context).border),
            ),
            child: Row(
              children: [
                Icon(
                  profit >= 0 ? Icons.trending_up_rounded : Icons.trending_down_rounded,
                  size: 16,
                  color: profit >= 0 ? gc(context).win : gc(context).loss,
                ),
                const SizedBox(width: GcSpace.sm),
                Expanded(
                  child: Text(
                    'One unit staked on each settled slip returns '
                    '${profit >= 0 ? '+' : ''}${profit.toStringAsFixed(2)} units across '
                    '${record.stakedUnits} priced.',
                    style: GcType.caption,
                  ),
                ),
              ],
            ),
          ),
        ],
        // Dropping these from the record would be exactly the flattering arithmetic to avoid.
        if (record.unpriced > 0) ...[
          const SizedBox(height: GcSpace.md),
          GcNote(
            '${record.unpriced} settled ${record.unpriced == 1 ? 'slip had a leg' : 'slips had a leg'} '
            'published without a verified price, so ${record.unpriced == 1 ? 'it is' : 'they are'} '
            'in the win rate but not in the profit.',
            icon: Icons.info_outline_rounded,
          ),
        ],
        if (record.legs.settled > 0) ...[
          const SizedBox(height: GcSpace.md),
          // A slip hides which leg was wrong, so the legs are reported too.
          Text(
            'Underneath those slips: ${record.legs.total} selections, ${record.legs.won} landed and '
            '${record.legs.lost} did not'
            '${record.legs.voided > 0 ? ', ${record.legs.voided} void' : ''}.',
            style: GcType.caption,
          ),
        ],
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, this.colour});

  final String label;
  final String value;
  final Color? colour;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: GcType.title.copyWith(
              color: colour ?? gc(context).ink,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: GcSpace.xxs),
          Text(label, style: GcType.caption.copyWith(fontSize: 11.5)),
        ],
      ),
    );
  }
}
