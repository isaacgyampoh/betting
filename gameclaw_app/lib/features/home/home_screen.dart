import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/tokens.dart';
import '../../ui/fixture_tile.dart';
import '../../ui/pick_card.dart';
import '../../ui/section.dart';

/// Today, in the order it matters: what is happening now, then what we published for it.
///
/// There is deliberately no hero image and no hand-picked "featured match". Both are decoration
/// that pushes the first real row below the fold, and on a product whose value is what it knows,
/// the first row should already be football.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final today = utcDay(DateTime.now());
    final day = ref.watch(matchDayProvider(today));
    final picks = ref.watch(todaysPicksProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('GameClaw')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(matchDayProvider(today));
          ref.invalidate(todaysPicksProvider);
          await Future.wait([
            ref.read(matchDayProvider(today).future),
            ref.read(todaysPicksProvider.future),
          ]);
        },
        child: ListView(
          padding: const EdgeInsets.only(bottom: GcSpace.xxl),
          children: [
            _LiveSection(day: day, onSeeAll: () => context.go('/scores')),
            _PicksSection(picks: picks),
            const Padding(
              padding: EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.xl, GcSpace.lg, 0),
              child: Text(
                'Odds and outcomes are estimates from past results. '
                'Nothing here is a certainty, and no slip is guaranteed to win.',
                style: GcType.caption,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LiveSection extends StatelessWidget {
  const _LiveSection({required this.day, required this.onSeeAll});

  final AsyncValue<Cached<MatchDay>> day;
  final VoidCallback onSeeAll;

  @override
  Widget build(BuildContext context) {
    return day.when(
      skipLoadingOnRefresh: true,
      loading: () => const Padding(
        padding: EdgeInsets.all(GcSpace.xl),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      ),
      // Home does not take over the screen for a failure in one of its sections: Scores can still
      // be reached, and today's picks may well have loaded. The heading is "Today" rather than
      // "Live now" because with nothing loaded we do not know whether anything is live.
      error: (error, _) => GcSection(
        title: 'Today',
        child: GcNote('$error'),
      ),
      data: (cached) {
        final live = [
          for (final group in cached.value.groups)
            for (final fixture in group.fixtures)
              if (fixture.status.isLive) fixture,
        ];

        if (live.isEmpty) {
          final upcoming = [
            for (final group in cached.value.groups)
              for (final fixture in group.fixtures)
                if (fixture.status == MatchStatus.scheduled) fixture,
          ]..sort((a, b) => a.kickoffUtc.compareTo(b.kickoffUtc));

          if (upcoming.isEmpty) {
            return const GcSection(
              title: 'Today',
              child: GcNote('No matches scheduled today.'),
            );
          }

          return GcSection(
            title: 'Next up',
            padded: false,
            action: TextButton(onPressed: onSeeAll, child: const Text('All scores')),
            child: Column(
              children: [
                for (final fixture in upcoming.take(5))
                  GcFixtureTile(
                    fixture: fixture,
                    onTap: () => context.push('/home/match/${fixture.id}'),
                  ),
              ],
            ),
          );
        }

        return GcSection(
          title: 'Live now',
          padded: false,
          action: TextButton(onPressed: onSeeAll, child: const Text('All scores')),
          child: Column(
            children: [
              for (final fixture in live.take(8))
                GcFixtureTile(
                  fixture: fixture,
                  onTap: () => context.push('/home/match/${fixture.id}'),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _PicksSection extends StatelessWidget {
  const _PicksSection({required this.picks});

  final AsyncValue<Cached<List<DailyPick>>> picks;

  @override
  Widget build(BuildContext context) {
    return picks.when(
      skipLoadingOnRefresh: true,
      loading: () => const SizedBox.shrink(),
      error: (error, _) => GcSection(title: "Today's slips", child: GcNote('$error')),
      data: (cached) {
        if (cached.value.isEmpty) {
          return const GcSection(
            title: "Today's slips",
            // This is the product's own rule, stated to the user rather than hidden: a day with
            // nothing worth backing publishes nothing. An empty day is the feature working.
            child: GcNote(
              'Nothing published today. A slip only goes out when the research supports it, '
              'so some days have none.',
            ),
          );
        }

        return GcSection(
          title: "Today's slips",
          child: Column(
            children: [
              for (final pick in cached.value) GcPickCard(pick: pick),
            ],
          ),
        );
      },
    );
  }
}
