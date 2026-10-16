import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/api_client.dart';
import 'package:gameclaw_app/data/auth_client.dart';
import 'package:gameclaw_app/data/local/cache.dart';
import 'package:gameclaw_app/data/providers.dart';
import 'package:gameclaw_app/data/secure_store.dart';

/// The session is the part of the app that fails in ways a user cannot diagnose: signed out on
/// launch, signed out on a train, or signed out because six screens all asked for a token at once.
/// These pin the behaviour that prevents each of those.
void main() {
  late _FakeStore store;
  late _FakeAuth auth;
  late CacheDb cache;

  AuthSession session({required Duration expiresIn, String access = 'a1', String refresh = 'r1'}) =>
      AuthSession(
        accessToken: access,
        refreshToken: refresh,
        expiresAtUtc: DateTime.now().toUtc().add(expiresIn),
        email: 'user@example.com',
      );

  ProviderContainer containerWith() {
    final container = ProviderContainer(
      overrides: [
        secureStoreProvider.overrideWithValue(store),
        authClientProvider.overrideWithValue(auth),
        cacheDbProvider.overrideWithValue(cache),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  setUp(() {
    store = _FakeStore();
    auth = _FakeAuth();
    cache = CacheDb.memory();
  });

  tearDown(() => cache.close());

  test('a cold launch with a stored session comes up signed in, without a network call', () async {
    store.stored = session(expiresIn: const Duration(hours: 1));
    final container = containerWith();

    final restored = await container.read(sessionProvider.future);

    expect(restored, isNotNull);
    expect(container.read(isSignedInProvider), isTrue);
    // Launch must not wait on a round trip. The first request that needs a token refreshes it.
    expect(auth.refreshCalls, 0);
  });

  test('a cold launch with nothing stored is simply signed out', () async {
    final container = containerWith();
    expect(await container.read(sessionProvider.future), isNull);
    expect(container.read(isSignedInProvider), isFalse);
  });

  test('an expired access token is refreshed before the request goes out', () async {
    store.stored = session(expiresIn: const Duration(seconds: 5));
    final container = containerWith();
    await container.read(sessionProvider.future);

    final token = await container.read(sessionProvider.notifier).validToken();

    expect(auth.refreshCalls, 1);
    expect(token, 'a2', reason: 'the refreshed access token, not the expired one');
  });

  test('a token expiring within the minute counts as expired', () async {
    // A token that expires while the request is in flight was already too old to send.
    store.stored = session(expiresIn: const Duration(seconds: 45));
    final container = containerWith();
    await container.read(sessionProvider.future);

    await container.read(sessionProvider.notifier).validToken();
    expect(auth.refreshCalls, 1);
  });

  test('six screens asking at once produce one refresh, not six', () async {
    // Supabase rotates the refresh token. Without the in-flight guard the first refresh succeeds
    // and the other five are rejected with a token that no longer exists - signing the user out
    // on launch, which is exactly when six screens do ask at once.
    store.stored = session(expiresIn: Duration.zero);
    final container = containerWith();
    await container.read(sessionProvider.future);
    final notifier = container.read(sessionProvider.notifier);

    final tokens = await Future.wait([for (var i = 0; i < 6; i++) notifier.validToken()]);

    expect(auth.refreshCalls, 1);
    expect(tokens, everyElement('a2'));
  });

  test('the rotated refresh token is the one stored, not the one it replaced', () async {
    store.stored = session(expiresIn: Duration.zero);
    final container = containerWith();
    await container.read(sessionProvider.future);

    await container.read(sessionProvider.notifier).validToken();

    expect(store.stored!.refreshToken, 'r2');
    expect(auth.lastRefreshTokenSeen, 'r1');
  });

  test('being offline does not sign anyone out', () async {
    // The request that asked for this token fails with its own offline error and falls back to
    // the cache. The session has to survive, or a tunnel logs the user out.
    store.stored = session(expiresIn: Duration.zero);
    auth.failWith = const OfflineFailure();
    final container = containerWith();
    await container.read(sessionProvider.future);

    final token = await container.read(sessionProvider.notifier).validToken();

    expect(token, isNull, reason: 'no usable token right now');
    expect(container.read(isSignedInProvider), isTrue, reason: 'but still signed in');
    expect(store.cleared, isFalse);
  });

  test('a refused refresh token ends the session', () async {
    store.stored = session(expiresIn: Duration.zero);
    auth.failWith = const ServerFailure('Invalid Refresh Token', status: 400);
    final container = containerWith();
    await container.read(sessionProvider.future);

    await container.read(sessionProvider.notifier).validToken();

    expect(container.read(isSignedInProvider), isFalse);
    expect(store.cleared, isTrue);
  });

  test('recovery: once back online the next request refreshes and succeeds', () async {
    store.stored = session(expiresIn: Duration.zero);
    auth.failWith = const OfflineFailure();
    final container = containerWith();
    await container.read(sessionProvider.future);
    final notifier = container.read(sessionProvider.notifier);

    expect(await notifier.validToken(), isNull);

    auth.failWith = null;
    expect(await notifier.validToken(), 'a2');
    expect(container.read(isSignedInProvider), isTrue);
  });

  test('signing out clears the session on this device and at Supabase', () async {
    store.stored = session(expiresIn: const Duration(hours: 1));
    final container = containerWith();
    await container.read(sessionProvider.future);

    await container.read(sessionProvider.notifier).signOut();

    expect(container.read(isSignedInProvider), isFalse);
    expect(store.cleared, isTrue);
    expect(auth.signedOut, isTrue, reason: 'so the refresh token cannot be used from elsewhere');
  });

  test('signing out forgets what the account was shown, but keeps followed teams', () async {
    // A phone gets handed around. The next person must not find the last one's slips in the cache
    // - but wiping the teams they follow would be a surprise, and those are a property of the
    // phone rather than of the account.
    await cache.write('picks:today', '{"data":[]}', DateTime.now().toUtc());
    await cache.addFavourite(42, 'Arsenal', null);

    store.stored = session(expiresIn: const Duration(hours: 1));
    final container = containerWith();
    await container.read(sessionProvider.future);

    await container.read(signOutProvider)();

    expect(await cache.read('picks:today'), isNull);
    expect(await cache.favourites(), hasLength(1));
  });

  test('signing in stores the session and flips everything that reads the API', () async {
    final container = containerWith();
    await container.read(sessionProvider.future);
    expect(container.read(isSignedInProvider), isFalse);

    await container.read(sessionProvider.notifier).signIn(email: 'a@b.c', password: 'x');

    expect(container.read(isSignedInProvider), isTrue);
    expect(store.stored, isNotNull);
  });

  test('a sign-up awaiting email confirmation does not pretend to be signed in', () async {
    auth.signUpReturnsSession = false;
    final container = containerWith();
    await container.read(sessionProvider.future);

    final signedIn = await container
        .read(sessionProvider.notifier)
        .signUp(email: 'a@b.c', password: 'xxxxxxxx');

    expect(signedIn, isFalse);
    expect(container.read(isSignedInProvider), isFalse);
  });
}

class _FakeStore implements SecureStore {
  AuthSession? stored;
  bool cleared = false;

  @override
  Future<AuthSession?> readSession() async => stored;

  @override
  Future<void> writeSession(AuthSession session) async => stored = session;

  @override
  Future<void> clear() async {
    stored = null;
    cleared = true;
  }
}

class _FakeAuth implements AuthClient {
  int refreshCalls = 0;
  String? lastRefreshTokenSeen;
  bool signedOut = false;
  bool signUpReturnsSession = true;
  ApiFailure? failWith;

  AuthSession _fresh() => AuthSession(
    accessToken: 'a2',
    refreshToken: 'r2',
    expiresAtUtc: DateTime.now().toUtc().add(const Duration(hours: 1)),
    email: 'user@example.com',
  );

  @override
  Future<AuthSession> refresh(String refreshToken) async {
    refreshCalls++;
    lastRefreshTokenSeen = refreshToken;
    // A real round trip is not instant, which is what makes the concurrency test meaningful.
    await Future<void>.delayed(const Duration(milliseconds: 10));
    if (failWith != null) throw failWith!;
    return _fresh();
  }

  @override
  Future<AuthSession> signIn({required String email, required String password}) async {
    if (failWith != null) throw failWith!;
    return _fresh();
  }

  @override
  Future<SignUpResult> signUp({required String email, required String password}) async {
    if (failWith != null) throw failWith!;
    return signUpReturnsSession
        ? SignUpResult(session: _fresh(), needsEmailConfirmation: false)
        : const SignUpResult(session: null, needsEmailConfirmation: true);
  }

  @override
  Future<void> signOut(String accessToken) async => signedOut = true;
}
