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
import '../../ui/components/gc_fixture_row.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_states.dart';
import '../../ui/components/gc_tabs.dart';

/// A team: who they are, what they have just done, and what is next.
///
/// Every section can be absent and each absence is its own sentence. A national side has no club
/// squad, a provider may carry no squad for a competition at all, and a team with no fixtures
/// scheduled is not a team whose fixtures failed to load.
class TeamScreen extends ConsumerStatefulWidget {
  const TeamScreen({super.key, required this.teamId});

  final int teamId;

  @override
  ConsumerState<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends ConsumerState<TeamScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final request = ref.watch(teamProvider(widget.teamId));
    final favourites = ref.watch(favouriteIdsProvider).value ?? const <int>{};

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: request.when(
          skipLoadingOnRefresh: true,
          loading: () => Column(
            children: const [
              _BackBar(),
              SizedBox(height: GcSpace.xl),
              GcSkeleton(width: 120, height: 14),
              SizedBox(height: GcSpace.xxl),
              Expanded(child: GcFixtureSkeleton(rows: 5)),
            ],
          ),
          error: (error, _) => Column(
            children: [
              const _BackBar(),
              Expanded(
                child: GcError(
                  error: error,
                  onRetry: () => ref.invalidate(teamProvider(widget.teamId)),
                ),
              ),
            ],
          ),
          data: (cached) => _Body(
            cached: cached,
            tab: _tab,
            onTab: (i) => setState(() => _tab = i),
            isFavourite: favourites.contains(cached.value.team.id),
            onToggleFavourite: () => ref.read(toggleFavouriteProvider)(cached.value.team.asTeam),
            onRefresh: () => ref.refresh(teamProvider(widget.teamId).future),
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
  Widget build(BuildContext context) => Row(
    children: [
      GcIconButton(
        icon: Icons.arrow_back_rounded,
        colour: gc(context).ink,
        tooltip: 'Back',
        onPressed: () => Navigator.of(context).maybePop(),
      ),
      const Spacer(),
      if (trailing != null) trailing!,
    ],
  );
}

class _Body extends StatelessWidget {
  const _Body({
    required this.cached,
    required this.tab,
    required this.onTab,
    required this.isFavourite,
    required this.onToggleFavourite,
    required this.onRefresh,
  });

  final Cached<TeamPage> cached;
  final int tab;
  final ValueChanged<int> onTab;
  final bool isFavourite;
  final VoidCallback onToggleFavourite;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final page = cached.value;

    // Only the sections with something in them. A squad tab that is always empty promises
    // something this competition does not carry.
    final tabs = <(String, Widget)>[
      ('Results', _Fixtures(fixtures: page.recent, empty: _emptyRecent(page))),
      ('Fixtures', _Fixtures(fixtures: page.upcoming, empty: _emptyUpcoming(page))),
      if (page.squad.isNotEmpty) ('Squad', _Squad(players: page.squad)),
    ];
    final index = tab.clamp(0, tabs.length - 1);

    return Column(
      children: [
        _BackBar(
          trailing: GcIconButton(
            icon: isFavourite ? Icons.star_rounded : Icons.star_outline_rounded,
            colour: isFavourite ? gc(context).accent : null,
            tooltip: isFavourite ? 'Unfollow' : 'Follow',
            onPressed: onToggleFavourite,
          ),
        ),
        if (cached.fromCache) GcStaleBar(fetchedAt: cached.fetchedAt),
        _Header(team: page.team, form: page.form),
        const SizedBox(height: GcSpace.sm),
        GcTabBar(tabs: [for (final t in tabs) t.$1], index: index, onChanged: onTab),
        const Divider(height: 1),
        Expanded(
          child: RefreshIndicator(
            color: gc(context).accent,
            backgroundColor: gc(context).surfaceRaised,
            onRefresh: onRefresh,
            child: tabs[index].$2,
          ),
        ),
      ],
    );
  }

  Widget _emptyRecent(TeamPage page) => GcEmpty(
    icon: Icons.history_rounded,
    title: page.unavailable.contains('recent') ? 'Results unavailable' : 'No results yet',
    note: page.unavailable.contains('recent')
        ? 'The provider returned no match history for this team.'
        : 'This team has no finished matches on record.',
  );

  Widget _emptyUpcoming(TeamPage page) => GcEmpty(
    icon: Icons.event_outlined,
    title: page.unavailable.contains('upcoming') ? 'Fixtures unavailable' : 'Nothing scheduled',
    note: page.unavailable.contains('upcoming')
        ? 'The provider returned no fixture list for this team.'
        : 'No upcoming match has been scheduled yet.',
  );
}

class _Header extends StatelessWidget {
  const _Header({required this.team, required this.form});

  final TeamProfile team;
  final TeamForm? form;

  @override
  Widget build(BuildContext context) {
    final facts = <String>[
      if (team.country != null && team.country!.isNotEmpty) team.country!,
      if (team.founded != null) 'est. ${team.founded}',
      if (team.venueName != null) team.venueName!,
    ];

    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.sm, GcSpace.gutter, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              GcCrest(url: team.logoUrl, name: team.name, size: 52),
              const SizedBox(width: GcSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      team.name,
                      style: GcType.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (facts.isNotEmpty) ...[
                      const SizedBox(height: GcSpace.xxs),
                      Text(
                        facts.join(' · '),
                        style: GcType.caption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          if (form != null && form!.summary.played > 0) ...[
            const SizedBox(height: GcSpace.lg),
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${form!.summary.won}W ${form!.summary.drawn}D ${form!.summary.lost}L'
                    '  ·  ${form!.summary.goalsFor}–${form!.summary.goalsAgainst}',
                    style: GcType.caption,
                  ),
                ),
                for (final game in form!.games.take(6).toList().reversed) _Pip(result: game.result),
              ],
            ),
          ],
          const SizedBox(height: GcSpace.sm),
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
      FormResult.win => gc(context).win,
      FormResult.draw => gc(context).inkFaint,
      FormResult.loss => gc(context).loss,
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

class _Fixtures extends StatelessWidget {
  const _Fixtures({required this.fixtures, required this.empty});

  final List<Fixture> fixtures;
  final Widget empty;

  @override
  Widget build(BuildContext context) {
    if (fixtures.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: GcSpace.xxl),
          empty,
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
      itemCount: fixtures.length,
      separatorBuilder: (_, __) =>
          const Divider(height: 1, indent: GcSpace.gutter, endIndent: GcSpace.gutter),
      itemBuilder: (context, i) => GcFixtureRow(
        fixture: fixtures[i],
        onTap: () => context.push('/home/match/${fixtures[i].id}'),
      ),
    );
  }
}

class _Squad extends StatelessWidget {
  const _Squad({required this.players});

  final List<SquadPlayer> players;

  /// The provider's own position wording, in the order a team sheet reads.
  static const _order = {'Goalkeeper': 0, 'Defender': 1, 'Midfielder': 2, 'Attacker': 3};

  @override
  Widget build(BuildContext context) {
    final sorted = [...players]
      ..sort((a, b) {
        final ra = _order[a.position] ?? 9;
        final rb = _order[b.position] ?? 9;
        return ra != rb ? ra.compareTo(rb) : (a.number ?? 99).compareTo(b.number ?? 99);
      });

    String? lastGroup;

    return ListView.builder(
      padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
      itemCount: sorted.length,
      itemBuilder: (context, i) {
        final player = sorted[i];
        final group = player.position;
        final isNew = group != lastGroup;
        lastGroup = group;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (isNew && group != null) GcSectionHeader(title: group, dense: i == 0),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.sm),
              child: Row(
                children: [
                  SizedBox(
                    width: 28,
                    child: Text(
                      player.number?.toString() ?? '–',
                      style: GcType.figureSm.copyWith(color: gc(context).inkFaint),
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
                  if (player.age != null)
                    Text(
                      '${player.age}',
                      style: GcType.caption.copyWith(fontSize: 11.5, color: gc(context).inkFaint),
                    ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}
