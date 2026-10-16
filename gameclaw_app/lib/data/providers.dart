import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/models.dart';
import 'api_client.dart';
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

final matchDetailProvider = FutureProvider.family<Cached<MatchDetail>, int>(
  (ref, id) => ref.watch(repositoryProvider).matchDetail(id),
);

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

final trackRecordProvider = FutureProvider<Cached<TrackRecord>>(
  (ref) => ref.watch(repositoryProvider).trackRecord(),
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
