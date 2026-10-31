import 'dart:convert';
import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'api_client.dart';

/// Where the app signs people in: GameClaw's own API, and nothing else.
///
/// This class was `SupabaseConfig` and carried two backends. Google or Apple handed back an ID
/// token, and the app posted it either to GameClaw's `/auth/*` or, when `GC_AUTH_BASE` was unset,
/// to a Supabase project - the second path being the rollback, "one build flag to go back to it".
///
/// There is nothing to roll back to. That project has been deleted and its hostname does not
/// resolve, so the fallback could only ever fail; it was also unreachable in practice, because no
/// build script has ever passed `GC_SUPABASE_URL` or `GC_SUPABASE_ANON_KEY`, so it would have been
/// handed two empty strings and reported itself unconfigured. A rollback path that cannot work is
/// worse than no rollback path, because it reads like a safety net.
///
/// What goes with it: the email-and-password `signIn` and `signUp`. Those posted to
/// `/token?grant_type=password` and `/signup`, which are Supabase's endpoints and have no GameClaw
/// equivalent - both answer 404 on the API today. They were already unreachable in the interface,
/// shown only `if (!google)`, and every build passes a Google client id.
class AuthConfig {
  const AuthConfig({
    required this.authBase,
    required this.googleServerClientId,
    this.googleIosClientId = '',
  });

  /// GameClaw's auth endpoints, e.g. https://gameclaw-api.onrender.com/api/v1.
  ///
  /// Required. With it empty there is no sign-in at all, and [isConfigured] is how the screen
  /// knows to say so rather than offering a button that cannot work.
  static const _authBase = String.fromEnvironment('GC_AUTH_BASE');

  /// The **Web** OAuth client id, not the Android one.
  ///
  /// This is the counter-intuitive part of native Google sign-in and the usual reason it fails.
  /// The Android client is what lets Google trust the app - it is matched by package name and
  /// signing fingerprint and is never named in code. The web client is what the ID token is
  /// *addressed to*, and both Google and the API check that audience, so it is the one the app has
  /// to hand over. Supplying the Android id here produces a token the API rejects.
  static const _googleServerClientId = String.fromEnvironment('GC_GOOGLE_SERVER_CLIENT_ID');

  /// The **iOS** OAuth client id, which is a different thing again from both of the above.
  ///
  /// Android needs no such value: its client is matched by package name and signing fingerprint
  /// and is never named in code. iOS has no equivalent, so the app has to say which client it is.
  ///
  /// Supplied explicitly rather than left to the plugin, and that is the whole point of it. Given
  /// nothing, `google_sign_in_ios` reads `CLIENT_ID` out of `GoogleService-Info.plist`
  /// (GoogleSignInPlugin.swift, `clientIdKey`). That plist comes from the Firebase project,
  /// `gameclaw-push-notifications` / 569032239509, and every OAuth client this product uses lives
  /// in a *different* project, `game-claw` / 400646694915 - which is the one whose web client the
  /// API checks the token's audience against. Letting the plist answer would sign in with a client
  /// from the wrong project and the API would reject the token, which is the same failure, from
  /// the same cause, as the `[28444]` conflict documented in docs/oauth-conflict-evidence.md.
  ///
  /// So: create the iOS client in `game-claw`, pass its id here, and leave the plist to Firebase.
  static const _googleIosClientId = String.fromEnvironment('GC_GOOGLE_IOS_CLIENT_ID');

  factory AuthConfig.fromEnvironment() => const AuthConfig(
    authBase: _authBase,
    googleServerClientId: _googleServerClientId,
    googleIosClientId: _googleIosClientId,
  );

  final String authBase;
  final String googleServerClientId;

  /// Empty on Android, where the client is matched by package and fingerprint instead.
  final String googleIosClientId;

  /// False in a build with no `GC_AUTH_BASE`. The sign-in screen then says which flag is missing
  /// rather than offering a button that dead-ends, and [AuthClient] refuses before any request.
  bool get isConfigured => authBase.isNotEmpty;

  /// Whether this build can offer Google at all. False is a configuration fact, not a failure,
  /// and the screen says which piece is missing rather than showing a button that dead-ends.
  ///
  /// iOS needs a second value, and without it the button does worse than dead-end: it takes the
  /// app down. google_sign_in_ios resolves its client id from the one passed in, falling back to
  /// CLIENT_ID in GoogleService-Info.plist (GoogleSignInPlugin.swift). With neither, it builds no
  /// GIDConfiguration, and the Google SDK raises an uncaught Objective-C exception the moment a
  /// sign-in is attempted - which on a device is not an error dialog, it is the app disappearing.
  /// Observed on an iPhone 12 Pro Max: tapping Continue with Google returned the user to the home
  /// screen with the process gone.
  ///
  /// Android needs no equivalent, because its client is matched by package name and signing
  /// fingerprint rather than named in the build.
  bool get hasGoogle => googleAvailable(
    configured: isConfigured,
    serverClientId: googleServerClientId,
    iosClientId: googleIosClientId,
    isIOS: Platform.isIOS,
  );

  /// The rule behind [hasGoogle], as a plain function so it can be tested on both platforms.
  /// A test runs on the Dart VM, where `Platform.isIOS` is always false, so the branch that
  /// matters most is the one a test could never otherwise reach.
  static bool googleAvailable({
    required bool configured,
    required String serverClientId,
    required String iosClientId,
    required bool isIOS,
  }) =>
      configured && serverClientId.isNotEmpty && (!isIOS || iosClientId.isNotEmpty);
}

/// A signed-in session.
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAtUtc,
    required this.email,
  });

  final String accessToken;
  final String refreshToken;

  /// When the access token stops being accepted. Held so the app can refresh just before, rather
  /// than discovering it through a 401 in the middle of something.
  final DateTime expiresAtUtc;
  final String? email;

  /// A minute of margin: a token that expires while a request is in flight is a token that was
  /// already too old to send.
  bool get isExpired =>
      DateTime.now().toUtc().isAfter(expiresAtUtc.subtract(const Duration(minutes: 1)));

  Map<String, dynamic> toJson() => {
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'expiresAt': expiresAtUtc.toIso8601String(),
    'email': email,
  };

  static AuthSession? fromJson(Map<String, dynamic> json) {
    final access = json['accessToken'] as String?;
    final refresh = json['refreshToken'] as String?;
    final expires = json['expiresAt'] as String?;
    if (access == null || refresh == null || expires == null) return null;
    return AuthSession(
      accessToken: access,
      refreshToken: refresh,
      expiresAtUtc: DateTime.parse(expires).toUtc(),
      email: json['email'] as String?,
    );
  }

  /// What `/auth/google`, `/auth/apple` and `/auth/refresh` return, unwrapped from `data`.
  ///
  /// The field names are OAuth's rather than this app's because that is what the API emits:
  /// `{ access_token, refresh_token, expires_in, token_type, is_new }`. `user` is read when it is
  /// there and is simply absent today, so [email] is null on a fresh sign-in - the token carries
  /// the address, and the profile endpoint is what the app asks for it.
  static AuthSession? fromAuthResponse(Map<String, dynamic> json) {
    final access = json['access_token'] as String?;
    final refresh = json['refresh_token'] as String?;
    if (access == null || refresh == null) return null;
    final seconds = (json['expires_in'] as num?)?.toInt() ?? 3600;
    return AuthSession(
      accessToken: access,
      refreshToken: refresh,
      expiresAtUtc: DateTime.now().toUtc().add(Duration(seconds: seconds)),
      email: (json['user'] as Map<String, dynamic>?)?['email'] as String?,
    );
  }
}

/// Obtains a Google ID token for the given Web OAuth client id.
///
/// A seam, so the exchange with the API can be tested without the platform plugin, which cannot
/// run outside a device. The production implementation is [_googleIdToken]; everything that can
/// actually be reasoned about lives on the other side of it.
typedef GoogleIdTokenSource = Future<String?> Function(String serverClientId, String iosClientId);

Future<String?> _googleIdToken(String serverClientId, String iosClientId) async {
  final google = GoogleSignIn.instance;
  await google.initialize(
    // Null rather than empty on Android, where the platform ignores it anyway and an empty
    // string would be a value the plugin has to decide what to do with.
    clientId: iosClientId.isEmpty ? null : iosClientId,
    serverClientId: serverClientId,
  );
  if (!google.supportsAuthenticate()) {
    throw const GoogleSignInException(
      code: GoogleSignInExceptionCode.unknownError,
      description: 'Google sign-in is not available on this device.',
    );
  }
  final account = await google.authenticate();
  return account.authentication.idToken;
}

class AuthClient {
  AuthClient({required AuthConfig config, Dio? dio})
    : _config = config,
      _dio =
          dio ??
          Dio(
            BaseOptions(
              // The placeholder matters. With no GC_AUTH_BASE this would be the relative "/auth",
              // and Dio rejects that at construction - "Invalid argument (baseUrl): Must be a
              // valid URL on platforms other than Web" - which is an ArgumentError thrown while
              // building a provider, not the configuration message below. Found by the test for
              // that message, which could never reach it.
              //
              // `.invalid` is reserved by RFC 2606 and can never resolve, and _post refuses before
              // sending anything, so nothing is ever addressed to it.
              baseUrl: config.isConfigured ? '${config.authBase}/auth' : 'https://auth.invalid/',
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 20),
              validateStatus: (_) => true,
              // No API key of any kind. These endpoints are public by design - they are how you
              // *get* a token - so there is nothing to identify the caller with and nothing to
              // ship in the APK.
              headers: {'content-type': 'application/json'},
            ),
          );

  final AuthConfig _config;
  final Dio _dio;

  /// Signs in with the Google account already on the phone.
  ///
  /// This is the native flow, not a browser redirect: Google hands back an ID token and the API
  /// verifies it against Google's JWKS and issues our own session. Nothing opens a web view,
  /// nothing comes back through a deep link, and there is no redirect URL to get wrong - which
  /// removes the part of OAuth that most often breaks on Android.
  ///
  /// Three things have to line up before this can work, and the app can only supply one of them:
  ///   - an Android OAuth client registered against this package name and signing fingerprint,
  ///     which is how Google decides the caller is really GameClaw;
  ///   - a Web OAuth client, whose id is passed as [AuthConfig.googleServerClientId] and is the
  ///     audience of the token both Google and the API check;
  ///   - that same Web client id set as `GOOGLE_WEB_CLIENT_ID` on the API.
  /// Any of them missing produces a failure the user can act on, rather than a spinner.
  Future<AuthSession> signInWithGoogle({GoogleIdTokenSource? source}) async {
    if (!_config.hasGoogle) {
      throw const UnknownFailure('Google sign-in is not configured in this build.');
    }

    final String? idToken;
    try {
      idToken = await (source ?? _googleIdToken)(
        _config.googleServerClientId,
        _config.googleIosClientId,
      );
    } on GoogleSignInException catch (error) {
      throw switch (error.code) {
        // Backing out of the account chooser is a decision, not a fault, and gets no red message.
        //
        // But "canceled" is also what the plugin reports when Google itself abandons the flow,
        // and those two must not be treated alike. A person dismissing the sheet produces a bare
        // cancellation; a failure carries a reason. On this device, picking an account returned
        // canceled with "[16] Account reauth failed." - Google Play Services' own logs said
        // "Flow failed" and "Activity finished with error" - and the app showed nothing at all,
        // because it believed the user had changed their mind. Somebody who taps a button, picks
        // their account and is returned to the same screen in silence has been told nothing.
        GoogleSignInExceptionCode.canceled when (error.description ?? '').trim().isEmpty =>
          const CancelledFailure(),
        GoogleSignInExceptionCode.canceled => UnknownFailure(
          // Google's own reasons arrive punctuated ("[16] Account reauth failed.") and the
          // sentence that follows supplies its own full stop, so the two met as "failed.. This".
          'Google could not complete the sign-in: ${_trimStop(error.description)}. '
          'This usually means this build is not registered with Google yet.',
        ),
        GoogleSignInExceptionCode.interrupted ||
        GoogleSignInExceptionCode.providerConfigurationError => UnknownFailure(
          'Google sign-in is not set up for this app yet. ${error.description ?? ''}'.trim(),
        ),
        _ => UnknownFailure(error.description ?? 'Google sign-in did not complete.'),
      };
    }

    if (idToken == null) {
      // Google authenticated the person but gave us nothing the API can verify. In practice this
      // means the Web client id is wrong or is not the one Google issued the token for.
      throw const UnknownFailure(
        'Google did not return a usable token. Check the Web client id this build was given.',
      );
    }

    final body = await _post('/google', {'id_token': idToken});
    final session = AuthSession.fromAuthResponse(body);
    if (session == null) throw const UnknownFailure('Signed in, but no session came back.');
    return session;
  }

  /// A reason from Google with any trailing full stop removed, so it can be read into a sentence.
  static String _trimStop(String? reason) {
    final text = (reason ?? '').trim();
    return text.endsWith('.') ? text.substring(0, text.length - 1) : text;
  }

  Future<AuthSession> refresh(String refreshToken) async {
    final body = await _post('/refresh', {'refresh_token': refreshToken});
    final session = AuthSession.fromAuthResponse(body);
    if (session == null) throw const UnauthorizedFailure();
    return session;
  }

  /// Best effort. A sign-out that fails at the server still clears the session on this device,
  /// which is what the user asked for and the part that matters on a shared phone.
  ///
  /// The **refresh** token is what gets revoked, because that is the one that outlives the
  /// request: an access token expires within the hour by itself, and leaving the refresh token
  /// alive would mean the session could be resumed after the user signed out.
  Future<void> signOut(String accessToken, {String? refreshToken}) async {
    if (refreshToken == null || refreshToken.isEmpty) return;
    try {
      await _dio.post<dynamic>('/logout', data: jsonEncode({'refresh_token': refreshToken}));
    } on DioException {
      // Ignore.
    }
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    if (!_config.isConfigured) {
      // A configuration error, said as one. Previously an unconfigured build fell through to the
      // Supabase branch and failed with whatever that produced, which sent whoever met it looking
      // for credentials to a project that no longer exists.
      throw const UnknownFailure(
        'This build has no sign-in configured: it was built without GC_AUTH_BASE.',
      );
    }

    final Response<dynamic> response;
    try {
      response = await _dio.post<dynamic>(path, data: jsonEncode(body));
    } on DioException catch (error) {
      throw switch (error.type) {
        DioExceptionType.connectionTimeout ||
        DioExceptionType.receiveTimeout ||
        DioExceptionType.sendTimeout => const TimeoutFailure(),
        DioExceptionType.connectionError => const OfflineFailure(),
        _ => const UnknownFailure(),
      };
    }

    final status = response.statusCode ?? 0;
    final data = response.data;
    final json = data is Map<String, dynamic> ? data : const <String, dynamic>{};

    if (status >= 200 && status < 300) {
      // Every success is wrapped in {"data": …}. The fallback to the bare object is kept for a
      // response that is already unwrapped rather than as a second protocol.
      final payload = json['data'];
      return payload is Map<String, dynamic> ? payload : json;
    }

    // The API's shape is {"error": {"code", "message"}}, and it words its own refusals better
    // than anything generic this could substitute, so the server's wording is preferred wherever
    // it exists. The flatter keys are read too, because a 404 or a proxy error on the way there
    // does not come from the API at all.
    final nested = json['error'];
    final message =
        (nested is Map<String, dynamic> ? nested['message'] as String? : null) ??
        json['message'] as String? ??
        (nested is String ? nested : null);

    if (status == 400 || status == 401 || status == 422) {
      throw ServerFailure(message ?? 'Those details were not accepted.', status: status);
    }
    if (status == 429) {
      throw ServerFailure(
        message ?? 'Too many attempts. Please wait a moment and try again.',
        status: status,
      );
    }
    throw ServerFailure(message ?? 'Sign-in is unavailable right now.', status: status);
  }
}
