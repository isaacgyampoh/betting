import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/local/cache.dart';
import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_crest.dart';
import '../../ui/components/gc_fixture_row.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_states.dart';

/// The teams this phone follows, and what they are doing today.
///
/// Favourites are stored on the device, not the account: following a team is a preference about
/// this phone, it needs no sign-in, and it has to keep working on a commute. That is also why the
/// list renders from the stored name and crest rather than waiting on a day of fixtures.
class FavouritesScreen extends ConsumerWidget {
  const FavouritesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teams = ref.watch(favouriteTeamsProvider);
    final today = utcDay(DateTime.now());
    final day = ref.watch(matchDayProvider(today));

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.md, GcSpace.gutter, GcSpace.sm),
              child: Text('Following', style: GcType.display),
            ),
            Expanded(
              child: teams.when(
                loading: () => const GcFixtureSkeleton(rows: 3),
                error: (error, _) =>
                    GcError(error: error, onRetry: () => ref.invalidate(favouriteTeamsProvider)),
                data: (rows) => rows.isEmpty
                    ? GcEmpty(
                        icon: Icons.star_outline_rounded,
                        title: 'No teams followed yet',
                        note:
                            'Tap the star beside any match to follow a team. '
                            'Their fixtures then appear here and can be filtered on the live centre.',
                        actionLabel: 'Find matches',
                        onAction: () => context.go('/home'),
                      )
                    : _Followed(teams: rows, day: day, ref: ref),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Followed extends StatelessWidget {
  const _Followed({required this.teams, required this.day, required this.ref});

  final List<FavouriteTeam> teams;
  final AsyncValue<Cached<MatchDay>> day;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    final ids = {for (final t in teams) t.teamId};

    // Today's matches involving any followed team, if today has loaded. The list of teams does not
    // wait on it: an offline phone still shows who you follow.
    final fixtures = <Fixture>[];
    final today = day.value;
    if (today != null) {
      for (final group in today.value.groups) {
        for (final fixture in group.fixtures) {
          if (ids.contains(fixture.home.id) || ids.contains(fixture.away.id)) fixtures.add(fixture);
        }
      }
      fixtures.sort((a, b) => a.kickoffUtc.compareTo(b.kickoffUtc));
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
      children: [
        if (fixtures.isNotEmpty) ...[
          const GcSectionHeader(title: 'Today', dense: true),
          for (final fixture in fixtures)
            GcFixtureRow(
              fixture: fixture,
              onTap: () => context.push('/following/match/${fixture.id}'),
            ),
        ] else if (day.hasValue) ...[
          const GcSectionHeader(title: 'Today', dense: true),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: GcNote('None of your teams play today.', icon: Icons.event_busy_rounded),
          ),
        ],
        GcSectionHeader(title: '${teams.length} ${teams.length == 1 ? 'team' : 'teams'}'),
        for (final team in teams)
          _TeamRow(
            team: team,
            onRemove: () => ref.read(toggleFavouriteProvider)(
              Team(id: team.teamId, name: team.name, logoUrl: team.logoUrl),
            ),
          ),
      ],
    );
  }
}

class _TeamRow extends StatelessWidget {
  const _TeamRow({required this.team, required this.onRemove});

  final FavouriteTeam team;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.sm),
      child: Row(
        children: [
          GcCrest(url: team.logoUrl, name: team.name, size: GcSize.crestMd),
          const SizedBox(width: GcSpace.md),
          Expanded(
            child: Text(
              team.name,
              style: GcType.bodyStrong,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          GcIconButton(
            icon: Icons.star_rounded,
            colour: GcColors.accent,
            tooltip: 'Unfollow ${team.name}',
            onPressed: onRemove,
          ),
        ],
      ),
    );
  }
}
