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

@DriftDatabase(tables: [CachedResponses])
class CacheDb extends _$CacheDb {
  CacheDb() : super(_open());

  /// For tests: an in-memory database, so a test never touches the device's files.
  CacheDb.memory() : super(NativeDatabase.memory());

  @override
  int get schemaVersion => 1;

  Future<CachedResponse?> read(String key) =>
      (select(cachedResponses)..where((row) => row.key.equals(key))).getSingleOrNull();

  Future<void> write(String key, String payload, DateTime fetchedAt) =>
      into(cachedResponses).insertOnConflictUpdate(
        CachedResponse(key: key, payload: payload, fetchedAt: fetchedAt),
      );

  /// Forgets everything. Called on sign-out: a phone gets handed around, and the next person to
  /// sign in must not find the last one's slips sitting in the cache.
  Future<int> clearAll() => delete(cachedResponses).go();

  /// Drops anything older than [age]. Called on startup rather than on every write: a cache sweep
  /// in the path of a read is latency the user pays for no benefit.
  Future<int> sweep(Duration age) =>
      (delete(cachedResponses)..where((row) => row.fetchedAt.isSmallerThanValue(DateTime.now().toUtc().subtract(age))))
          .go();
}

QueryExecutor _open() => LazyDatabase(() async {
      final dir = await getApplicationSupportDirectory();
      final file = File(p.join(dir.path, 'gameclaw-cache.sqlite'));
      // createInBackground runs sqlite on its own isolate, so a slow disk read never drops a frame.
      return NativeDatabase.createInBackground(file);
    });
