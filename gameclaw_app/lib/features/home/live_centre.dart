import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_chip.dart';
import '../../ui/components/gc_fixture_row.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_states.dart';
import '../../ui/components/gc_tabs.dart';

/// Which matches a day is filtered down to.
enum LiveFilter { live, upcoming, results }

extension on LiveFilter {
  String get label => switch (this) {
    LiveFilter.live => 'Live',
    LiveFilter.upcoming => 'Upcoming',
    LiveFilter.results => 'Results',
  };

  bool matches(Fixture f) => switch (this) {
    LiveFilter.live => f.status.isLive,
    LiveFilter.upcoming => f.status == MatchStatus.scheduled,
    LiveFilter.results => f.status.isDone,
  };
}

/// The landing screen: football first, in the order it matters.
///
/// There is deliberately no hero image and no hand-picked "featured match". Both are decoration
/// that pushes the first real row below the fold, and on a product whose value is what it knows,
/// the first thing on screen should already be football.
class LiveCentreScreen extends ConsumerStatefulWidget {
  const LiveCentreScreen({super.key});

  @override
  ConsumerState<LiveCentreScreen> createState() => _LiveCentreScreenState();
}

class _LiveCentreScreenState extends ConsumerState<LiveCentreScreen> {
  /// Three days either side. Further is a different question - a competition's calendar - and a
  /// strip long enough to reach it is a strip nobody can aim at.
  static const _span = 3;

  late final DateTime _today = DateTime.now().toUtc();
  late String _day = utcDay(_today);
  LiveFilter _filter = LiveFilter.live;
  bool _favouritesOnly = false;

  /// The filter the user last chose explicitly. Until they do, the screen picks the one with
  /// something in it - opening on an empty Live tab at 3am is a worse default than opening on
  /// whatever is actually on.
  bool _filterChosen = false;

  List<DateTime> get _days => [for (var i = -_span; i <= _span; i++) _today.add(Duration(days: i))];

  @override
  Widget build(BuildContext context) {
    final request = ref.watch(matchDayProvider(_day));
    final favourites = ref.watch(favouriteIdsProvider).value ?? const <int>{};

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _Header(
              days: _days,
              selected: _day,
              today: utcDay(_today),
              onSelectDay: (day) => setState(() {
                _day = day;
                _filterChosen = false;
              }),
              filter: _filter,
              onFilter: (f) => setState(() {
                _filter = f;
                _filterChosen = true;
              }),
              favouritesOnly: _favouritesOnly,
              favouriteCount: favourites.length,
              onFavouritesOnly: () => setState(() => _favouritesOnly = !_favouritesOnly),
            ),
            Expanded(
              child: RefreshIndicator(
                color: GcColors.accent,
                backgroundColor: GcColors.surfaceRaised,
                onRefresh: () => ref.refresh(matchDayProvider(_day).future),
                child: request.when(
                  skipLoadingOnRefresh: true,
                  loading: () => const GcFixtureSkeleton(),
                  error: (error, _) => ListView(
                    children: [
                      const SizedBox(height: GcSpace.xxl),
                      GcError(error: error, onRetry: () => ref.invalidate(matchDayProvider(_day))),
                    ],
                  ),
                  data: (cached) => _Body(
                    cached: cached,
                    filter: _resolve(cached.value),
                    favourites: favourites,
                    favouritesOnly: _favouritesOnly,
                    onTapFixture: (f) => context.push('/home/match/${f.id}'),
                    onToggleFavourite: (team) => ref.read(toggleFavouriteProvider)(team),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Falls back to the first filter with something in it, until the user picks one themselves.
  LiveFilter _resolve(MatchDay day) {
    if (_filterChosen) return _filter;
    final all = [for (final g in day.groups) ...g.fixtures];
    for (final candidate in [LiveFilter.live, LiveFilter.upcoming, LiveFilter.results]) {
      if (all.any(candidate.matches)) {
        // Deferred: this runs during build, and the strip has to show what the list is showing.
        if (candidate != _filter) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) setState(() => _filter = candidate);
          });
        }
        return candidate;
      }
    }
    return _filter;
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.days,
    required this.selected,
    required this.today,
    required this.onSelectDay,
    required this.filter,
    required this.onFilter,
    required this.favouritesOnly,
    required this.favouriteCount,
    required this.onFavouritesOnly,
  });

  final List<DateTime> days;
  final String selected;
  final String today;
  final ValueChanged<String> onSelectDay;
  final LiveFilter filter;
  final ValueChanged<LiveFilter> onFilter;
  final bool favouritesOnly;
  final int favouriteCount;
  final VoidCallback onFavouritesOnly;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            GcSpace.gutter,
            GcSpace.md,
            GcSpace.gutter,
            GcSpace.lg,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('GAMECLAW', style: GcType.overline.copyWith(color: GcColors.accent)),
                    const SizedBox(height: GcSpace.xs),
                    Text(_dayTitle(), style: GcType.display),
                  ],
                ),
              ),
              if (favouriteCount > 0)
                GcFilterChip(
                  label: 'Following',
                  icon: Icons.star_rounded,
                  selected: favouritesOnly,
                  onTap: onFavouritesOnly,
                  count: favouriteCount,
                ),
            ],
          ),
        ),
        SizedBox(
          height: 36,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            itemCount: days.length,
            separatorBuilder: (_, __) => const SizedBox(width: GcSpace.sm),
            itemBuilder: (context, i) {
              final key = utcDay(days[i]);
              return GcFilterChip(
                label: key == today ? 'Today' : DateFormat('E d').format(days[i].toLocal()),
                selected: key == selected,
                onTap: () => onSelectDay(key),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            GcSpace.gutter,
            GcSpace.md,
            GcSpace.gutter,
            GcSpace.md,
          ),
          child: GcSegmented(
            segments: [for (final f in LiveFilter.values) f.label],
            index: LiveFilter.values.indexOf(filter),
            onChanged: (i) => onFilter(LiveFilter.values[i]),
          ),
        ),
      ],
    );
  }

  String _dayTitle() {
    if (selected == today) return 'Today';
    final date = DateTime.parse(selected);
    return DateFormat('EEEE d MMM').format(date);
  }
}

class _Body extends StatelessWidget {
  const _Body({
    required this.cached,
    required this.filter,
    required this.favourites,
    required this.favouritesOnly,
    required this.onTapFixture,
    required this.onToggleFavourite,
  });

  final Cached<MatchDay> cached;
  final LiveFilter filter;
  final Set<int> favourites;
  final bool favouritesOnly;
  final ValueChanged<Fixture> onTapFixture;
  final ValueChanged<Team> onToggleFavourite;

  bool _kept(Fixture f) {
    if (!filter.matches(f)) return false;
    if (!favouritesOnly) return true;
    return favourites.contains(f.home.id) || favourites.contains(f.away.id);
  }

  /// Two different numbers, which must not be run together.
  ///
  /// [count] is how many matches this filter kept. The day's own total is how many were played at
  /// all, and the server lists at most the biggest 150 of them. Saying "5 shown of 391" conflates
  /// the two and reads as though 386 live matches were being hidden, when almost all of them were
  /// simply not live.
  String _footer(int count, MatchDay day) {
    final kind = switch (filter) {
      LiveFilter.live => count == 1 ? 'match live now' : 'matches live now',
      LiveFilter.upcoming => count == 1 ? 'match still to come' : 'matches still to come',
      LiveFilter.results => count == 1 ? 'result' : 'results',
    };
    final head = favouritesOnly ? '$count $kind from teams you follow.' : '$count $kind.';
    if (!day.isTrimmed) return head;
    return '$head\nThe day had ${day.total} matches in all; ${day.shown} from the biggest '
        'competitions are listed.';
  }

  @override
  Widget build(BuildContext context) {
    final groups = [
      for (final group in cached.value.groups)
        if (group.fixtures.any(_kept))
          LeagueGroup(
            competition: group.competition,
            fixtures: [
              for (final f in group.fixtures)
                if (_kept(f)) f,
            ],
          ),
    ];

    if (groups.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: GcSpace.xxl),
          GcEmpty(
            icon: favouritesOnly ? Icons.star_outline_rounded : Icons.sports_soccer_outlined,
            title: favouritesOnly
                ? 'None of your teams here'
                : switch (filter) {
                    LiveFilter.live => 'Nothing live right now',
                    LiveFilter.upcoming => 'No matches left today',
                    LiveFilter.results => 'No results yet',
                  },
            note: favouritesOnly
                ? 'No followed team has a match in this list. Turn off Following to see everything.'
                : switch (filter) {
                    LiveFilter.live => 'No match on this day is in play. Try Upcoming or Results.',
                    LiveFilter.upcoming => 'Everything scheduled has already kicked off.',
                    LiveFilter.results => 'Nothing has finished on this day yet.',
                  },
          ),
        ],
      );
    }

    final count = groups.fold(0, (sum, g) => sum + g.fixtures.length);

    return CustomScrollView(
      slivers: [
        if (cached.fromCache) SliverToBoxAdapter(child: GcStaleBar(fetchedAt: cached.fetchedAt)),
        for (final group in groups) ...[
          SliverPersistentHeader(
            pinned: true,
            delegate: GcPinnedHeader(
              child: GcCompetitionHeader(
                competition: group.competition,
                trailing: Text(
                  '${group.fixtures.length}',
                  style: GcType.figureSm.copyWith(color: GcColors.inkFaint),
                ),
              ),
            ),
          ),
          SliverList.separated(
            itemCount: group.fixtures.length,
            separatorBuilder: (_, __) =>
                const Divider(height: 1, indent: GcSpace.gutter, endIndent: GcSpace.gutter),
            itemBuilder: (context, i) {
              final fixture = group.fixtures[i];
              return GcFixtureRow(
                fixture: fixture,
                onTap: () => onTapFixture(fixture),
                isFavourite:
                    favourites.contains(fixture.home.id) || favourites.contains(fixture.away.id),
                onToggleFavourite: () => onToggleFavourite(fixture.home),
              );
            },
          ),
        ],
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              GcSpace.gutter,
              GcSpace.xl,
              GcSpace.gutter,
              GcSpace.xxxl,
            ),
            child: Text(
              _footer(count, cached.value),
              style: GcType.caption.copyWith(color: GcColors.inkFaint),
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ],
    );
  }
}
