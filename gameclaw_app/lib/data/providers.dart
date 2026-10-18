import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/models.dart';
import 'api_client.dart';
import 'follows_client.dart';
import 'local/cache.dart';
import 'repository.dart';
import 'push.dart';
import 'session.dart';

export 'push.dart';
export 'session.dart';

final cacheDbProvider = Provider<CacheDb>((ref) {
  final db = CacheDb();
  // Four days: enough that a user who opens the app on a train sees the fixtures they were looking
  // at, and not so much that the file grows without bound. Swept once, off the read path.
  db.sweep(const Duration(days: 4)).ignore();
  ref.onDispose(db.close);
  return db;
});

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    config: ApiConfig.fromEnvironment(),
    // Asked per request, and the session refreshes it if it has expired. Not captured: a token
    // captured at construction is the stale one the moment it rotates.
    token: () => ref.read(sessionProvider.notifier).validToken(),
  );
});

final repositoryProvider = Provider<FootballRepository>((ref) {
  // Signing in or out rebuilds this, and with it every screen reading from it. Watching the token
  // itself would re-fetch everything each time it quietly rotates.
  ref.watch(isSignedInProvider);
  return FootballRepository(api: ref.watch(apiClientProvider), cache: ref.watch(cacheDbProvider));
});

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  ref.watch(isSignedInProvider);
  return ChatRepository(api: ref.watch(apiClientProvider));
});

final slipsRepositoryProvider = Provider<SlipsRepository>((ref) {
  ref.watch(isSignedInProvider);
  return SlipsRepository(api: ref.watch(apiClientProvider));
});

/// The bookmakers the server has enabled. Read once per session: the list changes when an
/// integration is turned on, which is a deploy, not something that happens while the app is open.
final bookmakersProvider = FutureProvider<List<Bookmaker>>(
  (ref) => ref.watch(slipsRepositoryProvider).bookmakers(),
);

/// Today in UTC as YYYY-MM-DD, which is how the server keys a matchday.
String utcDay(DateTime day) {
  final d = day.toUtc();
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

final matchDayProvider = FutureProvider.family<Cached<MatchDay>, String>(
  (ref, date) => ref.watch(repositoryProvider).matchDay(date),
);

/// Keyed by the fixture and the matchday it was opened from.
///
/// The date is not decoration. Without it the server has to ask the provider for this one
/// fixture by id, which is a separate upstream call that can be refused on its own; with it the
/// server finds the fixture in the day it already holds. A match opened from a day list that
/// loaded a moment ago should never fail to open.
/// The fixture as the list already knew it, if that list is still loaded.
///
/// Opening a match used to show a skeleton while it re-fetched the teams, the score and the
/// status - all of which were on screen a moment earlier, in the row the user tapped. The detail
/// request is quick (about a third of a second against production, warm) but a blank header for a
/// third of a second after a tap is exactly what "slow" feels like.
///
/// Nothing is cached specially for this. The day's fixtures are already in [matchDayProvider],
/// keyed by date, and a [MatchRef] carries the date it was opened from - so this is a lookup in
/// memory, not a second copy of the truth that could disagree with the first.
///
/// Null when the match was opened from a notification or a deep link, where there is no list
/// behind it. Those still show the skeleton, which is honest: we genuinely do not know yet.
final knownFixtureProvider = Provider.family<Fixture?, MatchRef>((ref, match) {
  final date = match.date;
  if (date == null) return null;

  // Only consult a day that is already loaded. Watching it outright would *start* a fetch - and
  // for a match opened from a notification, that means pulling a whole day of fixtures (267 of
  // them on an ordinary Sunday) purely to draw a header the detail request supplies a third of a
  // second later. The point of this provider is to use what we have, not to go and get more.
  final day = ref.container.exists(matchDayProvider(date))
      ? ref.watch(matchDayProvider(date)).value?.value
      : null;
  if (day == null) return null;
  for (final group in day.groups) {
    for (final fixture in group.fixtures) {
      if (fixture.id == match.id) return fixture;
    }
  }
  return null;
});

final matchDetailProvider = FutureProvider.family<Cached<MatchDetail>, MatchRef>(
  (ref, at) => ref.watch(repositoryProvider).matchDetail(at.id, dateHint: at.date),
);

/// A fixture plus the day it belongs to, as a value so Riverpod can key a family on it.
@immutable
class MatchRef {
  const MatchRef(this.id, [this.date]);

  /// Builds the reference from a fixture, using its own kick-off day as the hint.
  factory MatchRef.of(Fixture fixture) => MatchRef(fixture.id, matchDayOf(fixture));

  final int id;
  final String? date;

  @override
  bool operator ==(Object other) => other is MatchRef && other.id == id && other.date == date;

  @override
  int get hashCode => Object.hash(id, date);
}

final teamProvider = FutureProvider.family<Cached<TeamPage>, int>(
  (ref, id) => ref.watch(repositoryProvider).team(id),
);

final competitionProvider = FutureProvider.family<Cached<CompetitionPage>, int>(
  (ref, id) => ref.watch(repositoryProvider).competition(id),
);

/// The catalogue, keyed by the filter applied to it. A record rather than two providers, so a
/// country and a search term cannot get out of step.
typedef CompetitionQuery = ({String? country, String? search});

final competitionsProvider = FutureProvider.family<Cached<CompetitionDirectory>, CompetitionQuery>(
  (ref, q) => ref.watch(repositoryProvider).competitions(country: q.country, search: q.search),
);

final todaysPicksProvider = FutureProvider<Cached<List<DailyPick>>>(
  (ref) => ref.watch(repositoryProvider).todaysPicks(),
);

final trackRecordProvider = FutureProvider.family<Cached<TrackRecord>, RecordWindow>(
  (ref, window) => ref.watch(repositoryProvider).trackRecord(window: window),
);

/// The teams this phone follows, as a live set of ids.
///
/// A stream rather than a future: a star tapped on the live centre has to light up on the scores
/// tab too, and a set rather than a list because every fixture row asks "is this one followed?"
/// once per build.
final favouriteIdsProvider = StreamProvider<Set<int>>((ref) {
  return ref
      .watch(cacheDbProvider)
      .watchFavourites()
      .map((rows) => {for (final row in rows) row.teamId});
});

final favouriteTeamsProvider = StreamProvider<List<FavouriteTeam>>(
  (ref) => ref.watch(cacheDbProvider).watchFavourites(),
);

/// Follows or unfollows a team, keeping its name and crest so the favourites screen can render
/// without first fetching a day of fixtures to look them up.
final toggleFavouriteProvider = Provider<Future<void> Function(Team)>((ref) {
  return (team) async {
    final db = ref.read(cacheDbProvider);
    final current = ref.read(favouriteIdsProvider).value ?? const <int>{};
    if (current.contains(team.id)) {
      await db.removeFavourite(team.id);
    } else {
      await db.addFavourite(team.id, team.name, team.logoUrl);
    }
  };
});

final followsClientProvider = Provider<FollowsClient>(
  (ref) => FollowsClient(ref.watch(apiClientProvider)),
);

/// Matches the user follows, from the device.
///
/// The device is the source for rendering: the Following screen has to work offline and before
/// any request returns. The server is told separately, because it is what makes an alert
/// possible at all - it has to know who cares about which match.
final followedMatchesProvider = StreamProvider<List<FollowedMatch>>(
  (ref) => ref.watch(cacheDbProvider).watchFollowedMatches(),
);

final followedMatchIdsProvider = StreamProvider<Set<int>>((ref) {
  return ref
      .watch(cacheDbProvider)
      .watchFollowedMatches()
      .map((rows) => {for (final row in rows) row.fixtureId});
});

/// Follows or unfollows one match.
///
/// Written locally first and then pushed, so the star lights up immediately and keeps working
/// with no signal. A failed push is swallowed: the follow is real on this device either way, and
/// an error toast for a star tap would be noise. What it costs is that the server can be behind,
/// which `syncFollowsProvider` settles on the next sign-in.
final toggleFollowedMatchProvider = Provider<Future<void> Function(Fixture)>((ref) {
  return (fixture) async {
    final db = ref.read(cacheDbProvider);
    final following = ref.read(followedMatchIdsProvider).value ?? const <int>{};
    final label = '${fixture.home.name} v ${fixture.away.name}';

    if (following.contains(fixture.id)) {
      await db.unfollowMatch(fixture.id);
      await _quietly(() => ref.read(followsClientProvider).remove(FollowKind.fixture, fixture.id));
    } else {
      await db.followMatch(fixture.id, label, fixture.kickoffUtc);
      await _quietly(
        () => ref.read(followsClientProvider).set(FollowKind.fixture, fixture.id, label: label),
      );
    }
  };
});

/// Silences a followed match without unfollowing it.
final setMatchMutedProvider = Provider<Future<void> Function(int, bool)>((ref) {
  return (fixtureId, muted) async {
    await ref.read(cacheDbProvider).setMatchMuted(fixtureId, muted);
    await _quietly(
      () => ref.read(followsClientProvider).set(FollowKind.fixture, fixtureId, muted: muted),
    );
  };
});

/// Changes which events a followed match should alert on.
///
/// Written here and pushed, like the follow itself. The server copy is what actually decides
/// whether a notification is sent; this one is what lets the sheet open instantly and be changed
/// with no signal.
final setMatchAlertsProvider = Provider<Future<void> Function(int, AlertPrefs)>((ref) {
  return (fixtureId, prefs) async {
    await ref
        .read(cacheDbProvider)
        .setMatchAlerts(
          fixtureId,
          kickoff: prefs.kickoff,
          goals: prefs.goals,
          redCards: prefs.redCards,
          halfTime: prefs.halfTime,
          fullTime: prefs.fullTime,
        );
    await _quietly(
      () => ref.read(followsClientProvider).set(FollowKind.fixture, fixtureId, alerts: prefs),
    );
  };
});

/// Pushes what this device follows to the server.
///
/// Called after signing in, because follows made while signed out exist only here and the server
/// would otherwise never learn about them - which is the difference between getting an alert and
/// not. Teams go too: the server needs both to work out who to tell about a goal.
final syncFollowsProvider = Provider<Future<void> Function()>((ref) {
  return () async {
    final db = ref.read(cacheDbProvider);
    final client = ref.read(followsClientProvider);
    await _quietly(() async {
      for (final match in await db.allFollowedMatches()) {
        await client.set(
          FollowKind.fixture,
          match.fixtureId,
          label: match.label,
          muted: match.muted,
          // Carried too. Syncing without them would push the follow and leave the server on its
          // own defaults, quietly undoing anything chosen while signed out.
          alerts: AlertPrefs(
            kickoff: match.alertKickoff,
            goals: match.alertGoals,
            redCards: match.alertRedCards,
            halfTime: match.alertHalfTime,
            fullTime: match.alertFullTime,
          ),
        );
      }
      for (final team in await db.favourites()) {
        await client.set(FollowKind.team, team.teamId, label: team.name);
      }
    });
  };
});

/// Runs something and ignores a failure.
///
/// Only ever wrapped around telling the server about a follow. The follow itself is already
/// written on the device, so the user's action succeeded; a red message because a background
/// sync failed would be reporting our problem as theirs. The cost is that the server can lag,
/// which the next sync settles.
Future<void> _quietly(Future<void> Function() action) async {
  try {
    await action();
  } on Object {
    // Deliberate.
  }
}

/// Signs out, and forgets everything read for that account.
final signOutProvider = Provider<Future<void> Function()>((ref) {
  return () async {
    // Before the session goes, not after: unregistering needs the token that is about to be
    // thrown away, and a device left registered keeps receiving alerts for an account that is no
    // longer signed in on it.
    await ref.read(pushServiceProvider).unregister();
    await ref.read(sessionProvider.notifier).signOut();
    await ref.read(cacheDbProvider).clearAll();
  };
});

/// Confirms the user is 18 or older, which the API requires before it will answer anything about
/// football. Clears the age gate on success by rebuilding everything that was refused.
final confirmAgeProvider = Provider<Future<void> Function()>((ref) {
  return () async {
    await ref
        .read(apiClientProvider)
        .post<Map<String, dynamic>>(
          '/me/age-confirmation',
          body: {'confirmedOver18': true, 'acceptedTerms': true},
        );
    ref.invalidate(matchDayProvider);
    ref.invalidate(matchDetailProvider);
    ref.invalidate(todaysPicksProvider);
  };
});
