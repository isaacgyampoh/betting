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
/// Held here as well as on the server, not instead of it. The local copy is what makes the
/// favourites screen render offline and before any request returns - the whole point of a
/// favourites list on a commute - and the name and crest are stored alongside the id so it needs
/// no fixture fetch to say who is who.
///
/// The server copy is what makes a notification possible at all: it has to know who cares about
/// what. This used to be device-only, which is why no alert could ever have been sent.
class FavouriteTeams extends Table {
  IntColumn get teamId => integer()();
  TextColumn get name => text()();
  TextColumn get logoUrl => text().nullable()();
  DateTimeColumn get addedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {teamId};
}

/// Matches the user follows, as opposed to teams.
///
/// A separate table rather than a `kind` column on the one above, because the two carry different
/// things: a team has a crest and a lasting name, a fixture has two sides, a kickoff and an
/// expiry. Following Arsenal is open-ended; following one match stops mattering once it ends.
// Named explicitly: drift derives the row class by stripping the plural, which turns
// FollowedMatches into "FollowedMatche".
@DataClassName('FollowedMatch')
class FollowedMatches extends Table {
  IntColumn get fixtureId => integer()();
  TextColumn get label => text()();
  /// Named `At`, not `Utc`, because drift stores a DateTime as epoch seconds and hands it
  /// back with isUtc false - the instant is preserved exactly, but expressed in local time.
  /// Calling it Utc invited reading the wall-clock numbers as UTC, which is only harmless in a
  /// UTC+0 timezone and this is not only shipped in one.
  DateTimeColumn get kickoffAt => dateTime().nullable()();

  /// Silenced without unfollowing: it stays on the Following screen, it just says nothing.
  BoolColumn get muted => boolean().withDefault(const Constant(false))();
  DateTimeColumn get addedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {fixtureId};
}

@DriftDatabase(tables: [CachedResponses, FavouriteTeams, FollowedMatches])
class CacheDb extends _$CacheDb {
  CacheDb() : super(_open());

  /// For tests: an in-memory database, so a test never touches the device's files.
  CacheDb.memory() : super(NativeDatabase.memory());

  @override
  int get schemaVersion => 2;

  /// Without this, adding a table breaks every phone that already has the app.
  ///
  /// Drift creates the schema on a fresh install and does nothing on an upgrade unless told to,
  /// so an existing install would open a version-1 database, find no `followed_matches`, and
  /// throw on the first read. There was no strategy here at all because there had never been a
  /// second version.
  ///
  /// Only the new table is created. Nothing drops or rewrites what is already there: the cache
  /// and the existing favourites survive the upgrade untouched.
  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) => m.createAll(),
    onUpgrade: (m, from, to) async {
      if (from < 2) await m.createTable(followedMatches);
    },
  );

  Future<CachedResponse?> read(String key) =>
      (select(cachedResponses)..where((row) => row.key.equals(key))).getSingleOrNull();

  Future<void> write(String key, String payload, DateTime fetchedAt) => into(
    cachedResponses,
  ).insertOnConflictUpdate(CachedResponse(key: key, payload: payload, fetchedAt: fetchedAt));

  Future<List<FollowedMatch>> allFollowedMatches() =>
      (select(followedMatches)..orderBy([(t) => OrderingTerm.asc(t.kickoffAt)])).get();

  Stream<List<FollowedMatch>> watchFollowedMatches() =>
      (select(followedMatches)..orderBy([(t) => OrderingTerm.asc(t.kickoffAt)])).watch();

  Future<void> followMatch(int fixtureId, String label, DateTime? kickoffAt) =>
      into(followedMatches).insertOnConflictUpdate(
        FollowedMatch(
          fixtureId: fixtureId,
          label: label,
          kickoffAt: kickoffAt,
          muted: false,
          addedAt: DateTime.now().toUtc(),
        ),
      );

  Future<void> unfollowMatch(int fixtureId) =>
      (delete(followedMatches)..where((t) => t.fixtureId.equals(fixtureId))).go();

  Future<void> setMatchMuted(int fixtureId, bool muted) =>
      (update(followedMatches)..where((t) => t.fixtureId.equals(fixtureId))).write(
        FollowedMatchesCompanion(muted: Value(muted)),
      );

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
