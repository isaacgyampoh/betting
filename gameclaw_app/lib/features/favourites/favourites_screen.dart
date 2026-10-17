import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/local/cache.dart';
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
    final matches = ref.watch(followedMatchesProvider).value ?? const <FollowedMatch>[];
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
                data: (rows) => rows.isEmpty && matches.isEmpty
                    ? GcEmpty(
                        icon: Icons.notifications_none_rounded,
                        title: 'Nothing followed yet',
                        note:
                            'The bell on a match follows that one game. The star follows a team, '
                            'and every game they play turns up here.',
                        actionLabel: 'Find matches',
                        onAction: () => context.go('/home'),
                      )
                    : _Followed(teams: rows, matches: matches, day: day, ref: ref),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Followed extends StatelessWidget {
  const _Followed({
    required this.teams,
    required this.matches,
    required this.day,
    required this.ref,
  });

  final List<FavouriteTeam> teams;
  final List<FollowedMatch> matches;
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
              onTap: () =>
                  context.push('/following/match/${fixture.id}?date=${matchDayOf(fixture)}'),
            ),
        ] else if (day.hasValue) ...[
          const GcSectionHeader(title: 'Today', dense: true),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter),
            child: GcNote('None of your teams play today.', icon: Icons.event_busy_rounded),
          ),
        ],
        // Matches first, and under their own heading. Following one game and following a team
        // are different intentions, and a single undifferentiated list made the app look as
        // though it could only do the second - which until now it could.
        if (matches.isNotEmpty) ...[
          GcSectionHeader(title: '${matches.length} ${matches.length == 1 ? 'match' : 'matches'}'),
          for (final match in matches)
            _MatchRow(
              match: match,
              onOpen: () => context.push('/following/match/${match.fixtureId}'),
              onMute: () => ref.read(setMatchMutedProvider)(match.fixtureId, !match.muted),
            ),
        ],
        if (teams.isNotEmpty)
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
            colour: gc(context).accentInk,
            tooltip: 'Unfollow ${team.name}',
            onPressed: onRemove,
          ),
        ],
      ),
    );
  }
}

/// One followed match.
///
/// Carries its own mute control, because the useful thing to do with a match you followed and
/// then stopped caring about mid-game is to silence it, not to unfollow and lose it from the
/// list.
class _MatchRow extends StatelessWidget {
  const _MatchRow({required this.match, required this.onOpen, required this.onMute});

  final FollowedMatch match;
  final VoidCallback onOpen;
  final VoidCallback onMute;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onOpen,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.md),
        child: Row(
          children: [
            Icon(
              match.muted ? Icons.notifications_off_outlined : Icons.notifications_active_rounded,
              size: 18,
              color: match.muted ? gc(context).inkFaint : gc(context).accentInk,
            ),
            const SizedBox(width: GcSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    match.label,
                    style: GcType.bodyStrong.copyWith(
                      color: match.muted ? gc(context).inkMuted : gc(context).ink,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (match.kickoffAt != null)
                    Text(
                      // Already local; see the column's comment in cache.dart.
                      DateFormat('EEE d MMM, HH:mm').format(match.kickoffAt!),
                      style: GcType.caption.copyWith(color: gc(context).inkFaint),
                    ),
                ],
              ),
            ),
            GcIconButton(
              icon: match.muted
                  ? Icons.notifications_off_outlined
                  : Icons.notifications_none_rounded,
              tooltip: match.muted ? 'Unmute this match' : 'Mute this match',
              onPressed: onMute,
            ),
          ],
        ),
      ),
    );
  }
}
