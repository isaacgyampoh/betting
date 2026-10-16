import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'auth_client.dart';
import 'secure_store.dart';

/// The signed-in session, and the only thing that knows how to keep it fresh.
///
/// Held here rather than read from the keystore on every request: a keystore read is a platform
/// channel round trip and the request interceptor asks for a token on every single call.
class SessionController extends AsyncNotifier<AuthSession?> {
  /// One refresh at a time. Six screens loading at once on a cold start would otherwise fire six
  /// refreshes with the same refresh token, and Supabase rotates it - the first succeeds and the
  /// other five are rejected with a token that no longer exists, signing the user out on launch.
  Future<AuthSession?>? _refreshing;

  @override
  Future<AuthSession?> build() async {
    final stored = await ref.read(secureStoreProvider).readSession();
    if (stored == null) return null;
    // Not refreshed here even when expired: build() is awaited before the first frame, and a
    // network round trip on launch is a cold start spent staring at nothing. The first request
    // that needs a token refreshes it.
    return stored;
  }

  /// A token good enough to send, refreshing first if it is not.
  ///
  /// Returns null when there is no session, which is a request going out unauthenticated - correct
  /// for the endpoints that are open to everyone.
  Future<String?> validToken() async {
    final current = state.value;
    if (current == null) return null;
    if (!current.isExpired) return current.accessToken;
    return (await _refresh(current))?.accessToken;
  }

  Future<AuthSession?> _refresh(AuthSession expired) {
    return _refreshing ??= _doRefresh(expired).whenComplete(() => _refreshing = null);
  }

  Future<AuthSession?> _doRefresh(AuthSession expired) async {
    try {
      final fresh = await ref.read(authClientProvider).refresh(expired.refreshToken);
      await ref.read(secureStoreProvider).writeSession(fresh);
      state = AsyncData(fresh);
      return fresh;
    } on OfflineFailure {
      // Offline is not a reason to sign anyone out. The request that asked for this token will
      // fail with its own offline error and fall back to the cache; the session survives.
      return null;
    } on TimeoutFailure {
      return null;
    } on ApiFailure {
      // The refresh token was refused. That session is genuinely over.
      await signOut();
      return null;
    }
  }

  Future<void> signIn({required String email, required String password}) async {
    final session = await ref.read(authClientProvider).signIn(email: email, password: password);
    await ref.read(secureStoreProvider).writeSession(session);
    state = AsyncData(session);
  }

  /// Returns true when the user is signed in straight away, false when the project wants them to
  /// confirm their email first.
  Future<bool> signUp({required String email, required String password}) async {
    final result = await ref.read(authClientProvider).signUp(email: email, password: password);
    if (result.session == null) return false;
    await ref.read(secureStoreProvider).writeSession(result.session!);
    state = AsyncData(result.session);
    return true;
  }

  Future<void> signOut() async {
    final current = state.value;
    state = const AsyncData(null);
    await ref.read(secureStoreProvider).clear();
    if (current != null) {
      // Tell Supabase too, so the refresh token cannot be used again from anywhere else.
      await ref.read(authClientProvider).signOut(current.accessToken);
    }
  }
}

final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

final supabaseConfigProvider = Provider<SupabaseConfig>((ref) => SupabaseConfig.fromEnvironment());

final authClientProvider =
    Provider<AuthClient>((ref) => AuthClient(config: ref.watch(supabaseConfigProvider)));

final sessionProvider = AsyncNotifierProvider<SessionController, AuthSession?>(SessionController.new);

/// Whether anyone is signed in - not which token they hold.
///
/// Everything that reads the API watches this rather than [sessionProvider], so a token rotating
/// in the background does not re-fetch every screen. Signing in or out flips it, and that is
/// exactly when every screen should be re-read.
final isSignedInProvider = Provider<bool>((ref) => ref.watch(sessionProvider).value != null);
