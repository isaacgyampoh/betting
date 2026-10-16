import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/brand/gc_claw.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_crest.dart';
import '../../ui/components/gc_chip.dart';
import '../../ui/components/gc_fixture_row.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_sheet.dart';
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

  /// Competition ids the user has narrowed to. Empty means every competition, which is the
  /// default and the common case - a filter that starts with something excluded hides football
  /// the user never asked to hide.
  Set<int> _competitions = {};

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
                // A competition chosen for one day may not play on another; keeping the filter
                // across days is how a screen ends up empty for no visible reason.
                _competitions = {};
              }),
              filter: _filter,
              onFilter: (f) => setState(() {
                _filter = f;
                _filterChosen = true;
              }),
              favouritesOnly: _favouritesOnly,
              favouriteCount: favourites.length,
              onFavouritesOnly: () => setState(() => _favouritesOnly = !_favouritesOnly),
              competitionCount: _competitions.length,
              onCompetitions: () => _pickCompetitions(request.value?.value),
            ),
            Expanded(
              child: RefreshIndicator(
                color: gc(context).accentInk,
                backgroundColor: gc(context).surfaceRaised,
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
                    competitions: _competitions,
                    onTapFixture: (f) => context.push('/home/match/${f.id}?date=${matchDayOf(f)}'),
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

  /// Narrows to chosen competitions, from whichever ones this day actually has.
  ///
  /// The list is built from the loaded day rather than from a fixed catalogue: offering a
  /// competition that has no match today is offering an empty screen.
  Future<void> _pickCompetitions(MatchDay? day) async {
    if (day == null) return;
    final chosen = await showGcSheet<Set<int>>(
      context: context,
      title: 'Competitions',
      subtitle: 'Showing ${day.groups.length} with matches on this day',
      child: _CompetitionPicker(day: day, selected: _competitions),
    );
    if (chosen != null && mounted) setState(() => _competitions = chosen);
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
    required this.competitionCount,
    required this.onCompetitions,
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
  final int competitionCount;
  final VoidCallback onCompetitions;

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
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        GcClawMark(size: 13, colour: gc(context).accentInk),
                        const SizedBox(width: 5),
                        Text(
                          'GAMECLAW',
                          style: GcType.overline.copyWith(color: gc(context).accentInk),
                        ),
                      ],
                    ),
                    const SizedBox(height: GcSpace.xs),
                    Text(_dayTitle(), style: GcType.display),
                  ],
                ),
              ),
              if (favouriteCount > 0) ...[
                GcFilterChip(
                  label: 'Following',
                  icon: Icons.star_rounded,
                  selected: favouritesOnly,
                  onTap: onFavouritesOnly,
                  count: favouriteCount,
                ),
                const SizedBox(width: GcSpace.sm),
              ],
              GcFilterChip(
                label: 'Leagues',
                icon: Icons.tune_rounded,
                selected: competitionCount > 0,
                onTap: onCompetitions,
                count: competitionCount > 0 ? competitionCount : null,
              ),
              const SizedBox(width: GcSpace.sm),
              GcFilterChip(
                label: 'Browse',
                icon: Icons.public_rounded,
                selected: false,
                onTap: () => context.push('/home/competitions'),
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
    required this.competitions,
    required this.onTapFixture,
    required this.onToggleFavourite,
  });

  final Cached<MatchDay> cached;
  final LiveFilter filter;
  final Set<int> favourites;
  final bool favouritesOnly;
  final Set<int> competitions;
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
        if ((competitions.isEmpty || competitions.contains(group.competition.id)) &&
            group.fixtures.any(_kept))
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
            title: competitions.isNotEmpty
                ? 'Nothing in those leagues'
                : favouritesOnly
                ? 'None of your teams here'
                : switch (filter) {
                    LiveFilter.live => 'Nothing live right now',
                    LiveFilter.upcoming => 'No matches left today',
                    LiveFilter.results => 'No results yet',
                  },
            note: competitions.isNotEmpty
                ? 'No match in the leagues you picked is in this list. Clear the Leagues filter to see everything.'
                : favouritesOnly
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

    // Only on the full, unfiltered day. Once somebody has narrowed to a filter, a competition or
    // their own teams, they have said what they want to look at, and a row of suggestions on top
    // of that is noise rather than help.
    final featured = (filter == LiveFilter.upcoming && !favouritesOnly && competitions.isEmpty)
        ? cached.value.featured
        : const <FeaturedFixture>[];

    return CustomScrollView(
      slivers: [
        if (cached.fromCache) SliverToBoxAdapter(child: GcStaleBar(fetchedAt: cached.fetchedAt)),
        if (featured.isNotEmpty)
          SliverToBoxAdapter(
            child: _Featured(featured: featured, onTap: onTapFixture),
          ),
        // Each competition is its own group: the header pins only while that competition's own
        // fixtures are on screen, then the next one pushes it out.
        //
        // This is why it is a SliverMainAxisGroup rather than a bare pinned header per section.
        // Pinned slivers in one CustomScrollView all pin at the top of the viewport, so with
        // seventy competitions they stack - scrolling produced a screen of nothing but headers
        // with every match hidden behind them. Reproduced on the device before it was changed.
        for (final group in groups)
          SliverMainAxisGroup(
            slivers: [
              SliverPersistentHeader(
                pinned: true,
                delegate: GcPinnedHeader(
                  child: GcCompetitionHeader(
                    competition: group.competition,
                    trailing: Text(
                      '${group.fixtures.length}',
                      style: GcType.figureSm.copyWith(color: gc(context).inkFaint),
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
                        favourites.contains(fixture.home.id) ||
                        favourites.contains(fixture.away.id),
                    onToggleFavourite: () => onToggleFavourite(fixture.home),
                  );
                },
              ),
            ],
          ),
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
              style: GcType.caption.copyWith(color: gc(context).inkFaint),
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ],
    );
  }
}

/// Pick which competitions to show, from the ones this day actually has.
///
/// Selection is applied on Done rather than live, so a user who taps four leagues does not watch
/// the list behind them rebuild four times.
class _CompetitionPicker extends StatefulWidget {
  const _CompetitionPicker({required this.day, required this.selected});

  final MatchDay day;
  final Set<int> selected;

  @override
  State<_CompetitionPicker> createState() => _CompetitionPickerState();
}

class _CompetitionPickerState extends State<_CompetitionPicker> {
  late final Set<int> _chosen = {...widget.selected};

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: ListView.builder(
            shrinkWrap: true,
            padding: const EdgeInsets.symmetric(vertical: GcSpace.sm),
            itemCount: widget.day.groups.length,
            itemBuilder: (context, i) {
              final group = widget.day.groups[i];
              final on = _chosen.contains(group.competition.id);
              return InkWell(
                onTap: () => setState(() {
                  on ? _chosen.remove(group.competition.id) : _chosen.add(group.competition.id);
                }),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: GcSpace.gutter,
                    vertical: GcSpace.md,
                  ),
                  child: Row(
                    children: [
                      GcCrest(
                        url: group.competition.logoUrl,
                        name: group.competition.name,
                        size: GcSize.crestMd,
                      ),
                      const SizedBox(width: GcSpace.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              group.competition.name,
                              style: GcType.bodyStrong.copyWith(fontSize: 14.5),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              '${group.competition.country} · ${group.fixtures.length} '
                              '${group.fixtures.length == 1 ? 'match' : 'matches'}',
                              style: GcType.caption.copyWith(fontSize: 11.5),
                            ),
                          ],
                        ),
                      ),
                      Icon(
                        on ? Icons.check_circle_rounded : Icons.circle_outlined,
                        size: 20,
                        color: on ? gc(context).accentInk : gc(context).inkFaint,
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.all(GcSpace.md),
          child: Row(
            children: [
              Expanded(
                child: GcButton(
                  label: 'All leagues',
                  kind: GcButtonKind.secondary,
                  onPressed: _chosen.isEmpty ? null : () => Navigator.of(context).pop(<int>{}),
                ),
              ),
              const SizedBox(width: GcSpace.sm),
              Expanded(
                child: GcButton(
                  label: _chosen.isEmpty ? 'Done' : 'Show ${_chosen.length}',
                  onPressed: () => Navigator.of(context).pop(_chosen),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The fixtures the day leads with.
///
/// Headed "Featured", not "Big Games". Significance is not something this data knows - there is
/// no attendance, no popularity, no derby flag - so the only claim made here is the one that is
/// true: these are from the competitions GameClaw ranks highest, and the row says so in as many
/// words. A day with nothing from a ranked competition shows no row at all, which is a better
/// answer than promoting a third tier to fill the space.
class _Featured extends StatelessWidget {
  const _Featured({required this.featured, required this.onTap});

  final List<FeaturedFixture> featured;
  final ValueChanged<Fixture> onTap;

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
            GcSpace.sm,
          ),
          child: Row(
            children: [
              Text('FEATURED', style: GcType.overline.copyWith(color: gc(context).inkMuted)),
              const SizedBox(width: GcSpace.sm),
              Expanded(
                child: Text(
                  'from the competitions we rank highest',
                  style: GcType.caption.copyWith(color: gc(context).inkFaint),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 108,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            itemCount: featured.length,
            separatorBuilder: (_, __) => const SizedBox(width: GcSpace.sm),
            itemBuilder: (context, i) {
              final item = featured[i];
              return _FeaturedCard(item: item, onTap: () => onTap(item.fixture));
            },
          ),
        ),
        const SizedBox(height: GcSpace.md),
        Divider(height: 1, color: gc(context).border),
      ],
    );
  }
}

class _FeaturedCard extends StatelessWidget {
  const _FeaturedCard({required this.item, required this.onTap});

  final FeaturedFixture item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final f = item.fixture;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 232,
        padding: const EdgeInsets.all(GcSpace.md),
        decoration: BoxDecoration(
          color: gc(context).surface,
          borderRadius: BorderRadius.circular(GcRadius.md),
          border: Border.all(color: gc(context).border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              item.reason,
              style: GcType.overline.copyWith(color: gc(context).accentInk),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: GcSpace.sm),
            _FeaturedSide(team: f.home, goals: f.homeGoals),
            const SizedBox(height: GcSpace.xs),
            _FeaturedSide(team: f.away, goals: f.awayGoals),
            const Spacer(),
            Text(
              f.status == MatchStatus.scheduled
                  ? DateFormat.Hm().format(f.kickoffUtc.toLocal())
                  : f.statusLabel,
              style: GcType.caption.copyWith(
                color: f.status == MatchStatus.live ? gc(context).live : gc(context).inkFaint,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeaturedSide extends StatelessWidget {
  const _FeaturedSide({required this.team, required this.goals});

  final Team team;
  final int? goals;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        GcCrest(url: team.logoUrl, name: team.name, size: 16),
        const SizedBox(width: GcSpace.sm),
        Expanded(
          child: Text(
            team.name,
            style: GcType.body.copyWith(color: gc(context).ink),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        // Null before kick-off, and never defaulted to zero.
        if (goals != null) Text('$goals', style: GcType.figureSm.copyWith(color: gc(context).ink)),
      ],
    );
  }
}
