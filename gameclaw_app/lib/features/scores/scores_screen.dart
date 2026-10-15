import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/tokens.dart';
import '../../ui/async_view.dart';
import '../../ui/fixture_tile.dart';

/// A day's football, by competition.
///
/// The day is held in widget state rather than in a provider: it is this screen's own position,
/// not app state, and the tab's element is kept alive by the shell so it survives switching tabs.
class ScoresScreen extends ConsumerStatefulWidget {
  const ScoresScreen({super.key});

  @override
  ConsumerState<ScoresScreen> createState() => _ScoresScreenState();
}

class _ScoresScreenState extends ConsumerState<ScoresScreen> {
  /// Three days either side. Further than that is a different kind of question - a competition's
  /// calendar - and a strip long enough to reach it is a strip nobody can aim at.
  static const _back = 3;
  static const _forward = 3;

  late final DateTime _today = DateTime.now().toUtc();
  late String _day = utcDay(_today);

  List<DateTime> get _days => [
        for (var i = -_back; i <= _forward; i++) _today.add(Duration(days: i)),
      ];

  @override
  Widget build(BuildContext context) {
    final request = ref.watch(matchDayProvider(_day));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Scores'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: _DayStrip(
            days: _days,
            selected: _day,
            today: utcDay(_today),
            onSelect: (day) => setState(() => _day = day),
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(matchDayProvider(_day).future),
        child: GcAsyncView<MatchDay>(
          value: request,
          onRetry: () => ref.invalidate(matchDayProvider(_day)),
          builder: (context, cached) => _DayList(cached: cached),
        ),
      ),
    );
  }
}

class _DayStrip extends StatelessWidget {
  const _DayStrip({
    required this.days,
    required this.selected,
    required this.today,
    required this.onSelect,
  });

  final List<DateTime> days;
  final String selected;
  final String today;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.lg, vertical: GcSpace.sm),
        itemCount: days.length,
        separatorBuilder: (_, __) => const SizedBox(width: GcSpace.sm),
        itemBuilder: (context, i) {
          final day = days[i];
          final key = utcDay(day);
          final isSelected = key == selected;
          final label = key == today ? 'Today' : DateFormat('E d').format(day.toLocal());

          return GestureDetector(
            onTap: () => onSelect(key),
            child: Container(
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: GcSpace.md),
              decoration: BoxDecoration(
                color: isSelected ? GcColors.accent : GcColors.surface,
                borderRadius: BorderRadius.circular(GcRadius.pill),
              ),
              child: Text(
                label,
                style: GcType.label.copyWith(
                  color: isSelected ? GcColors.onAccent : GcColors.inkMuted,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _DayList extends StatelessWidget {
  const _DayList({required this.cached});

  final Cached<MatchDay> cached;

  @override
  Widget build(BuildContext context) {
    final day = cached.value;

    if (day.groups.isEmpty) {
      // A list view, so pull-to-refresh still works on an empty day.
      return ListView(
        children: const [
          SizedBox(height: 120),
          GcEmptyView(
            title: 'No matches on this day',
            note: 'Nothing was scheduled, or the day has not been published yet.',
            icon: Icons.event_busy_rounded,
          ),
        ],
      );
    }

    return CustomScrollView(
      slivers: [
        if (cached.fromCache)
          SliverToBoxAdapter(child: GcStaleBanner(fetchedAt: cached.fetchedAt)),
        for (final group in day.groups) ...[
          SliverStickyHeader(child: GcCompetitionHeader(competition: group.competition)),
          SliverList.separated(
            itemCount: group.fixtures.length,
            separatorBuilder: (_, __) => const Divider(height: 1, indent: GcSpace.lg),
            itemBuilder: (context, i) {
              final fixture = group.fixtures[i];
              return GcFixtureTile(
                fixture: fixture,
                onTap: () => context.push('/scores/match/${fixture.id}'),
              );
            },
          ),
        ],
        if (day.isTrimmed)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(GcSpace.lg),
              child: Text(
                // Said plainly, because a list that stops at 150 without a word reads as if the
                // rest of the world's football did not happen.
                'Showing ${day.shown} of ${day.total} matches. The biggest competitions come first.',
                style: GcType.caption,
                textAlign: TextAlign.center,
              ),
            ),
          ),
        const SliverToBoxAdapter(child: SizedBox(height: GcSpace.xl)),
      ],
    );
  }
}

/// A competition heading that stays put while its own fixtures scroll past.
///
/// Flutter has no sticky sliver header in the framework, and a package for one line of layout is a
/// dependency to keep updated forever. SliverPersistentHeader with `pinned` does it.
class SliverStickyHeader extends StatelessWidget {
  const SliverStickyHeader({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => SliverPersistentHeader(
        pinned: true,
        delegate: _HeaderDelegate(child),
      );
}

class _HeaderDelegate extends SliverPersistentHeaderDelegate {
  const _HeaderDelegate(this.child);

  final Widget child;

  static const _height = 30.0;

  @override
  double get minExtent => _height;

  @override
  double get maxExtent => _height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) =>
      SizedBox(height: _height, child: child);

  @override
  bool shouldRebuild(_HeaderDelegate old) => old.child != child;
}
