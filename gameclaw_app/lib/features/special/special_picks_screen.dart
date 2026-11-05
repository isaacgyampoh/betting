import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_special_pick_card.dart';
import '../../ui/components/gc_states.dart';

/// Daily Special Picks: up to two researched selections a day in statistical markets.
///
/// Separate from the slip record because it is a different kind of bet settled a different way -
/// one selection graded from the match statistics, rather than an accumulator graded from the
/// score. Averaging the two records together would describe neither.
///
/// Nothing here is hidden behind a plan or a sign-in. The selections are a published claim and the
/// record under them is the evidence for it.
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
              padding: const EdgeInsets.fromLTRB(
                GcSpace.sm,
                GcSpace.sm,
                GcSpace.gutter,
                GcSpace.sm,
              ),
              child: Row(
                children: [
                  GcIconButton(
                    icon: Icons.arrow_back_rounded,
                    colour: gc(context).ink,
                    tooltip: 'Back',
                    onPressed: () => context.canPop() ? context.pop() : context.go('/claw'),
                  ),
                  const SizedBox(width: GcSpace.xs),
                  Expanded(child: Text('Special picks', style: GcType.display)),
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
            'Two selections a day in statistical markets — corners, shots, shots on target — researched '
            'from the teams’ recent matches, priced from a live bookmaker market and published together '
            'as one ${view.target} odds slip. Both have to land. Some days nothing meets the threshold.',
            style: GcType.body.copyWith(color: gc(context).inkMuted),
          ),
        ),
        const GcSectionHeader(title: 'Today'),
        if (view.today != null && view.today!.slip.combinedOdds != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.md),
            child: _SlipLine(day: view.today!),
          ),
        if (view.picks.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: GcNote(
              'Nothing today. Either the research has not run yet, or nothing met the threshold — '
              'which is a normal day, not a fault.',
              icon: Icons.inbox_outlined,
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: Column(
              children: [for (final pick in view.picks) GcSpecialPickCard(pick: pick)],
            ),
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
            'The estimate is ours, from the teams’ recent matches. It is not the bookmaker’s price '
            'and it is not a guarantee. Prices move after publishing; the one shown is what was '
            'verified when the selection went up.',
            icon: Icons.info_outline_rounded,
          ),
        ),
      ],
    );
  }
}

/// The published record. Losses counted, voids reported as voids, nothing excluded to improve it.
/// The day's selections are one bet, so the page says what that bet is worth.
class _SlipLine extends StatelessWidget {
  const _SlipLine({required this.day});

  final SpecialDay day;

  @override
  Widget build(BuildContext context) {
    final odds = day.slip.combinedOdds!;
    final colour = switch (day.slip.status) {
      PickStatus.won => gc(context).win,
      PickStatus.lost => gc(context).loss,
      _ => gc(context).inkMuted,
    };

    return Row(
      children: [
        Text(odds.toStringAsFixed(2), style: GcType.figure.copyWith(fontSize: 18, color: colour)),
        const SizedBox(width: GcSpace.sm),
        Expanded(
          child: Text(
            day.picks.length == 1
                ? 'the slip, on one selection'
                : 'the slip, across ${day.picks.length} selections — both have to land',
            style: GcType.caption,
          ),
        ),
      ],
    );
  }
}

class _Record extends StatelessWidget {
  const _Record({required this.record});

  final SpecialPerformance record;

  @override
  Widget build(BuildContext context) {
    if (record.total == 0) {
      return const GcNote(
        'No special picks have been published yet. This fills in automatically, wins and losses '
        'alike.',
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
                    '${profit >= 0 ? '+' : ''}${profit.toStringAsFixed(2)} units '
                    'across ${record.stakedUnits} priced.',
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
          // A slip hides which half was wrong, so the legs are reported too.
          Text(
            'Underneath those slips: ${record.legs.total} selections, ${record.legs.won} landed and '
            '${record.legs.lost} did not'
            '${record.legs.voided > 0 ? ', ${record.legs.voided} void' : ''}.',
            style: GcType.caption,
          ),
        ],
        if (record.byMarket.any((m) => m.settled > 0)) ...[
          const SizedBox(height: GcSpace.lg),
          for (final market in record.byMarket) _MarketRow(market: market),
        ],
      ],
    );
  }
}

class _MarketRow extends StatelessWidget {
  const _MarketRow({required this.market});

  final SpecialMarketRecord market;

  static const _labels = {
    'CORNERS': 'Corners',
    'SHOTS': 'Shots',
    'SHOTS_ON_TARGET': 'Shots on target',
  };

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: GcSpace.sm),
      child: Row(
        children: [
          Expanded(
            child: Text(_labels[market.kind] ?? market.kind, style: GcType.body.copyWith(fontSize: 14)),
          ),
          Text(
            '${market.won}/${market.settled} settled',
            style: GcType.caption.copyWith(color: gc(context).inkFaint),
          ),
          const SizedBox(width: GcSpace.md),
          SizedBox(
            width: 44,
            child: Text(
              market.winRate == null ? '–' : '${(market.winRate! * 100).round()}%',
              textAlign: TextAlign.right,
              style: GcType.figureSm,
            ),
          ),
        ],
      ),
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
