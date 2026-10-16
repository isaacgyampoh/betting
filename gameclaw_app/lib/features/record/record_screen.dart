import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_pick_card.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_states.dart';
import '../../ui/components/gc_tabs.dart';

/// The published record. Every slip, losses included.
///
/// This screen exists because a tips product is worth exactly what its record is, and a record you
/// cannot check is worth nothing. Nothing here is filtered, nothing is edited after the fact, and
/// a losing run shows as a losing run.
class RecordScreen extends ConsumerStatefulWidget {
  const RecordScreen({super.key});

  @override
  ConsumerState<RecordScreen> createState() => _RecordScreenState();
}

class _RecordScreenState extends ConsumerState<RecordScreen> {
  RecordWindow _window = RecordWindow.all;

  @override
  Widget build(BuildContext context) {
    final record = ref.watch(trackRecordProvider(_window));

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
                    onPressed: () => context.canPop() ? context.pop() : context.go('/profile'),
                  ),
                  const SizedBox(width: GcSpace.xs),
                  Text('Record', style: GcType.display),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.md),
              child: GcSegmented(
                segments: [for (final w in RecordWindow.values) w.label],
                index: RecordWindow.values.indexOf(_window),
                onChanged: (i) => setState(() => _window = RecordWindow.values[i]),
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                color: gc(context).accentInk,
                backgroundColor: gc(context).surfaceRaised,
                onRefresh: () => ref.refresh(trackRecordProvider(_window).future),
                child: record.when(
                  skipLoadingOnRefresh: true,
                  loading: () => const GcFixtureSkeleton(rows: 5),
                  error: (error, _) => ListView(
                    children: [
                      const SizedBox(height: GcSpace.xxl),
                      GcError(
                        error: error,
                        onRetry: () => ref.invalidate(trackRecordProvider(_window)),
                      ),
                    ],
                  ),
                  data: (cached) => _Record(cached: cached),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Record extends StatelessWidget {
  const _Record({required this.cached});

  final Cached<TrackRecord> cached;

  @override
  Widget build(BuildContext context) {
    final record = cached.value;

    if (record.total == 0) {
      return ListView(
        children: const [
          SizedBox(height: GcSpace.xxl),
          GcEmpty(
            icon: Icons.history_rounded,
            title: 'No slips published yet',
            note: 'When the first one settles it will appear here, win or lose.',
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
      children: [
        if (cached.fromCache) GcStaleBar(fetchedAt: cached.fetchedAt),
        _Summary(record: record),
        const GcSectionHeader(title: 'Every slip'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
          child: Column(children: [for (final pick in record.picks) GcPickCard(pick: pick)]),
        ),
      ],
    );
  }
}

/// The headline numbers, and the one sentence that makes them checkable.
class _Summary extends StatelessWidget {
  const _Summary({required this.record});

  final TrackRecord record;

  @override
  Widget build(BuildContext context) {
    final roi = record.roi;

    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.md, GcSpace.gutter, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              // Null until something settles. Zero settled slips is not a 0% win rate.
              Text(
                record.winRate == null ? '–' : '${record.winRate!.toStringAsFixed(0)}%',
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
          if (record.total == 0) ...[
            const SizedBox(height: GcSpace.lg),
            GcNote(
              record.window == RecordWindow.last30
                  ? 'No slips published in the last 30 days.'
                  : 'No slips published yet.',
              icon: Icons.inbox_outlined,
            ),
          ],
          const SizedBox(height: GcSpace.lg),
          Row(
            children: [
              // Settled, not published: a still-running slip is not evidence of anything yet.
              _Stat(label: 'Settled', value: '${record.settled}'),
              _Stat(label: 'Won', value: '${record.won}', colour: gc(context).win),
              _Stat(label: 'Lost', value: '${record.lost}', colour: gc(context).loss),
              if (record.pending > 0) _Stat(label: 'Running', value: '${record.pending}'),
            ],
          ),
          // A win rate from a handful of slips is a number, not evidence. Saying so is the
          // difference between a record and a sales figure - and it matters most on the 30-day
          // view, which is exactly where the sample is smallest.
          if (record.smallSample) ...[
            const SizedBox(height: GcSpace.lg),
            GcNote(
              'Only ${record.settled} settled ${record.settled == 1 ? 'slip' : 'slips'} '
              '${record.window == RecordWindow.last30 ? 'in the last 30 days' : 'so far'}. '
              'That is too few to judge a win rate on.',
              icon: Icons.info_outline_rounded,
            ),
          ],
          if (roi != null) ...[
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
                    roi >= 0 ? Icons.trending_up_rounded : Icons.trending_down_rounded,
                    size: 16,
                    color: roi >= 0 ? gc(context).win : gc(context).loss,
                  ),
                  const SizedBox(width: GcSpace.sm),
                  Expanded(
                    child: Text(
                      'One unit staked per slip returns '
                      '${roi >= 0 ? '+' : ''}${roi.toStringAsFixed(1)}% across ${record.settled} settled.',
                      style: GcType.caption,
                    ),
                  ),
                ],
              ),
            ),
          ],
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
