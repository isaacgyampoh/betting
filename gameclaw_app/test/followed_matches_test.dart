import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/local/cache.dart';

/// Following a match on the device.
///
/// The device copy is what makes the Following screen render offline and before any request
/// returns. The server is told separately; that is what makes an alert possible at all.
void main() {
  late CacheDb db;

  setUp(() => db = CacheDb.memory());
  tearDown(() => db.close());

  test('a followed match is kept, with its label and kickoff', () async {
    final kickoff = DateTime.utc(2026, 10, 17, 19, 30);
    await db.followMatch(1557430, 'Everton v Chelsea', kickoff);

    final rows = await db.allFollowedMatches();
    expect(rows, hasLength(1));
    expect(rows.single.label, 'Everton v Chelsea');
    // The instant, not the flag: drift stores epoch seconds and returns a local-flavoured
    // DateTime for the same moment. Comparing the objects passes only in a UTC+0 timezone.
    expect(
      rows.single.kickoffAt!.millisecondsSinceEpoch,
      kickoff.millisecondsSinceEpoch,
    );
    expect(rows.single.muted, isFalse);
  });

  test('following the same match twice keeps one row', () async {
    await db.followMatch(42, 'A v B', null);
    await db.followMatch(42, 'A v B', null);
    expect(await db.allFollowedMatches(), hasLength(1));
  });

  test('following again refreshes the label rather than duplicating', () async {
    await db.followMatch(42, 'A v B', null);
    await db.followMatch(42, 'Arsenal v Brentford', null);
    final rows = await db.allFollowedMatches();
    expect(rows, hasLength(1));
    expect(rows.single.label, 'Arsenal v Brentford');
  });

  test('unfollowing removes it', () async {
    await db.followMatch(7, 'A v B', null);
    await db.unfollowMatch(7);
    expect(await db.allFollowedMatches(), isEmpty);
  });

  test('muting keeps the match but marks it silent', () async {
    await db.followMatch(9, 'A v B', null);
    await db.setMatchMuted(9, true);

    final rows = await db.allFollowedMatches();
    // Still followed: it belongs on the Following screen, it just says nothing.
    expect(rows, hasLength(1));
    expect(rows.single.muted, isTrue);

    await db.setMatchMuted(9, false);
    expect((await db.allFollowedMatches()).single.muted, isFalse);
  });

  test('matches and teams are separate lists', () async {
    // The same id can be a fixture and a team; they must not collide.
    await db.followMatch(50, 'A v B', null);
    await db.addFavourite(50, 'Everton', null);

    expect(await db.allFollowedMatches(), hasLength(1));
    expect(await db.favourites(), hasLength(1));
  });

  test('the stream reports a follow as it happens', () async {
    final seen = <int>[];
    final sub = db.watchFollowedMatches().listen((rows) => seen.add(rows.length));
    await db.followMatch(1, 'A v B', null);
    await db.followMatch(2, 'C v D', null);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    await sub.cancel();
    // A star tapped on one screen has to light up on another, which is why this is a stream.
    expect(seen.last, 2);
  });

  test('alerts default to kickoff, goals, red cards and full time', () async {
    await db.followMatch(1, 'A v B', null);
    final row = (await db.allFollowedMatches()).single;
    expect(row.alertKickoff, isTrue);
    expect(row.alertGoals, isTrue);
    expect(row.alertRedCards, isTrue);
    expect(row.alertFullTime, isTrue);
    // The one people switch off first.
    expect(row.alertHalfTime, isFalse);
  });

  test('re-following refreshes the label without resetting alerts', () async {
    await db.followMatch(1, 'A v B', null);
    await db.setMatchAlerts(
      1,
      kickoff: false,
      goals: false,
      redCards: true,
      halfTime: true,
      fullTime: false,
    );
    // The app refreshes labels opportunistically. Writing the whole row would quietly undo what
    // somebody chose to hear about, which is why the insert uses a partial companion.
    await db.followMatch(1, 'Arsenal v Brentford', null);

    final row = (await db.allFollowedMatches()).single;
    expect(row.label, 'Arsenal v Brentford');
    expect(row.alertKickoff, isFalse);
    expect(row.alertGoals, isFalse);
    expect(row.alertHalfTime, isTrue);
    expect(row.alertFullTime, isFalse);
  });

  test('ordering is by kickoff, so the next match is first', () async {
    await db.followMatch(1, 'Later', DateTime.utc(2026, 10, 18, 20));
    await db.followMatch(2, 'Sooner', DateTime.utc(2026, 10, 18, 12));
    final rows = await db.allFollowedMatches();
    expect(rows.map((r) => r.label), ['Sooner', 'Later']);
  });
}
