import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/models.dart';
import 'api_client.dart';
import 'local/cache.dart';
import 'repository.dart';
import 'secure_store.dart';

final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

/// The signed-in user's token, or null.
///
/// Held here rather than read from the keystore on every request: a keystore read is a platform
/// channel round trip, and the request interceptor asks for the token on every single call.
class SessionController extends AsyncNotifier<String?> {
  @override
  Future<String?> build() => ref.read(secureStoreProvider).readSession();

  Future<void> signedIn(String token) async {
    await ref.read(secureStoreProvider).writeSession(token);
    state = AsyncData(token);
  }

  Future<void> signedOut() async {
    await ref.read(secureStoreProvider).clear();
    state = const AsyncData(null);
  }
}

final sessionProvider = AsyncNotifierProvider<SessionController, String?>(SessionController.new);

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
    // Read per request, from whatever the session currently is. Not captured: a token captured at
    // construction is the stale one the moment the user signs in or out.
    token: () async => ref.read(sessionProvider).value,
  );
});

final repositoryProvider = Provider<FootballRepository>((ref) => FootballRepository(
      api: ref.watch(apiClientProvider),
      cache: ref.watch(cacheDbProvider),
    ));

final chatRepositoryProvider =
    Provider<ChatRepository>((ref) => ChatRepository(api: ref.watch(apiClientProvider)));

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
