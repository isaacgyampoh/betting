import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

part 'cache.g.dart';

/// Every response the app has read, keyed by the request that produced it.
///
/// One table rather than a table per entity. The app's job offline is to show what it last saw,
/// and a fixture list is only ever read as a whole - nobody queries "all matches where the home
/// team is X" on the device, because the server already answers that. Storing the response whole
/// keeps the cache honest (it is exactly what the server said, not a lossy re-assembly) and means
/// a new endpoint needs no migration.
///
/// [fetchedAt] is the point of it. A cached screen says when it was read, so stale data is never
/// passed off as current.
@DataClassName('CachedResponse')
class CachedResponses extends Table {
  /// The request: path plus whichever query parameters change the answer.
  TextColumn get key => text()();

  /// The response body, exactly as received.
  TextColumn get payload => text()();

  DateTimeColumn get fetchedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {key};
}

/// Teams the user follows.
///
/// On the device, not the server. Following a team is a preference about this phone, it needs no
/// account, and it must keep working offline - which is the whole point of a favourites list on a
/// commute. The name and crest are stored alongside the id so the favourites screen can render
/// without first fetching a day of fixtures to look them up.
class FavouriteTeams extends Table {
  IntColumn get teamId => integer()();
  TextColumn get name => text()();
  TextColumn get logoUrl => text().nullable()();
  DateTimeColumn get addedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {teamId};
}

@DriftDatabase(tables: [CachedResponses, FavouriteTeams])
class CacheDb extends _$CacheDb {
  CacheDb() : super(_open());

  /// For tests: an in-memory database, so a test never touches the device's files.
  CacheDb.memory() : super(NativeDatabase.memory());

  @override
  int get schemaVersion => 1;

  Future<CachedResponse?> read(String key) =>
      (select(cachedResponses)..where((row) => row.key.equals(key))).getSingleOrNull();

  Future<void> write(String key, String payload, DateTime fetchedAt) => into(
    cachedResponses,
  ).insertOnConflictUpdate(CachedResponse(key: key, payload: payload, fetchedAt: fetchedAt));

  Future<List<FavouriteTeam>> favourites() =>
      (select(favouriteTeams)..orderBy([(t) => OrderingTerm.asc(t.name)])).get();

  Stream<List<FavouriteTeam>> watchFavourites() =>
      (select(favouriteTeams)..orderBy([(t) => OrderingTerm.asc(t.name)])).watch();

  Future<void> addFavourite(int teamId, String name, String? logoUrl) =>
      into(favouriteTeams).insertOnConflictUpdate(
        FavouriteTeam(
          teamId: teamId,
          name: name,
          logoUrl: logoUrl,
          addedAt: DateTime.now().toUtc(),
        ),
      );

  Future<void> removeFavourite(int teamId) =>
      (delete(favouriteTeams)..where((t) => t.teamId.equals(teamId))).go();

  /// Forgets cached responses. Called on sign-out: a phone gets handed around, and the next person to
  /// sign in must not find the last one's slips sitting in the cache.
  /// Favourites are deliberately left alone: they are a property of the phone, not of the account,
  /// and wiping someone's followed teams because they signed out would be a surprise.
  Future<int> clearAll() => delete(cachedResponses).go();

  /// Drops anything older than [age]. Called on startup rather than on every write: a cache sweep
  /// in the path of a read is latency the user pays for no benefit.
  Future<int> sweep(Duration age) => (delete(
    cachedResponses,
  )..where((row) => row.fetchedAt.isSmallerThanValue(DateTime.now().toUtc().subtract(age)))).go();
}

QueryExecutor _open() => LazyDatabase(() async {
  final dir = await getApplicationSupportDirectory();
  final file = File(p.join(dir.path, 'gameclaw-cache.sqlite'));
  // createInBackground runs sqlite on its own isolate, so a slow disk read never drops a frame.
  return NativeDatabase.createInBackground(file);
});
