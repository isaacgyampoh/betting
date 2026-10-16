import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/models.dart';
import 'api_client.dart';
import 'local/cache.dart';
import 'repository.dart';
import 'session.dart';

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
  return FootballRepository(
    api: ref.watch(apiClientProvider),
    cache: ref.watch(cacheDbProvider),
  );
});

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  ref.watch(isSignedInProvider);
  return ChatRepository(api: ref.watch(apiClientProvider));
});

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

final todaysPicksProvider = FutureProvider<Cached<List<DailyPick>>>(
  (ref) => ref.watch(repositoryProvider).todaysPicks(),
);

final trackRecordProvider = FutureProvider<Cached<TrackRecord>>(
  (ref) => ref.watch(repositoryProvider).trackRecord(),
);

/// Signs out, and forgets everything read for that account.
final signOutProvider = Provider<Future<void> Function()>((ref) {
  return () async {
    await ref.read(sessionProvider.notifier).signOut();
    await ref.read(cacheDbProvider).clearAll();
  };
});

/// Confirms the user is 18 or older, which the API requires before it will answer anything about
/// football. Clears the age gate on success by rebuilding everything that was refused.
final confirmAgeProvider = Provider<Future<void> Function()>((ref) {
  return () async {
    await ref.read(apiClientProvider).post<Map<String, dynamic>>(
      '/me/age-confirmation',
      body: {'confirmedOver18': true, 'acceptedTerms': true},
    );
    ref.invalidate(matchDayProvider);
    ref.invalidate(matchDetailProvider);
    ref.invalidate(todaysPicksProvider);
  };
});
