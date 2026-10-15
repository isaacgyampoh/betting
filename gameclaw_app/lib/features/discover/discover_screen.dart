import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/tokens.dart';
import '../../ui/async_view.dart';
import '../../ui/pick_card.dart';
import '../../ui/section.dart';

/// The published record. Every slip, losses included.
///
/// This screen exists because a tips product is worth exactly what its record is, and a record you
/// cannot check is worth nothing. Nothing here is filtered, nothing is edited after the fact, and
/// a losing run shows as a losing run.
class DiscoverScreen extends ConsumerWidget {
  const DiscoverScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final record = ref.watch(trackRecordProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Record')),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(trackRecordProvider.future),
        child: GcAsyncView<TrackRecord>(
          value: record,
          onRetry: () => ref.invalidate(trackRecordProvider),
          builder: (context, cached) => _Record(cached: cached),
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
          SizedBox(height: 120),
          GcEmptyView(
            title: 'No slips published yet',
            note: 'When the first one settles it will appear here, win or lose.',
            icon: Icons.history_rounded,
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: GcSpace.xxl),
      children: [
        if (cached.fromCache) GcStaleBanner(fetchedAt: cached.fetchedAt),
        Padding(
          padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.lg, GcSpace.lg, 0),
          child: Row(
            children: [
              _Stat(
                label: 'Settled',
                // Settled, not published: a still-running slip is not evidence of anything yet.
                value: '${record.settled}',
              ),
              _Stat(label: 'Won', value: '${record.won}', colour: GcColors.win),
              _Stat(label: 'Lost', value: '${record.lost}', colour: GcColors.loss),
              _Stat(
                label: 'Win rate',
                // Null until something settles. Zero settled slips is not a 0% win rate.
                value: record.winRate == null ? '–' : '${record.winRate!.toStringAsFixed(0)}%',
              ),
            ],
          ),
        ),
        if (record.roi != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.md, GcSpace.lg, 0),
            child: Text(
              'Return on one unit staked per slip: ${record.roi! >= 0 ? '+' : ''}${record.roi!.toStringAsFixed(1)}% '
              'across ${record.settled} settled.',
              style: GcType.caption,
            ),
          ),
        GcSection(
          title: 'Every slip',
          child: Column(
            children: [
              for (final pick in record.picks) GcPickCard(pick: pick),
            ],
          ),
        ),
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
          Text(value, style: GcType.title.copyWith(color: colour, fontFeatures: const [FontFeature.tabularFigures()])),
          const SizedBox(height: 2),
          Text(label, style: GcType.caption),
        ],
      ),
    );
  }
}
