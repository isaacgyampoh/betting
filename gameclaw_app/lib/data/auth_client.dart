import 'dart:convert';

import 'package:dio/dio.dart';

import 'api_client.dart';

/// Where the app signs people in.
///
/// Supabase, which is also what the API verifies its bearer tokens against - the API accepts
/// `Authorization: Bearer <supabase access_token>` and checks the signature itself. So the app
/// talks to Supabase to get a token and to GameClaw for everything else.
///
/// Supplied at build time next to the API host. The anon key is designed to be public - it
/// identifies the project and grants nothing on its own, which is why the web client has always
/// shipped it in its bundle - so it is not a secret being leaked into an APK. The service key,
/// which does grant everything, is not here and never will be.
class SupabaseConfig {
  const SupabaseConfig({required this.url, required this.anonKey});

  static const _url = String.fromEnvironment('GC_SUPABASE_URL');
  static const _anonKey = String.fromEnvironment('GC_SUPABASE_ANON_KEY');

  factory SupabaseConfig.fromEnvironment() => const SupabaseConfig(url: _url, anonKey: _anonKey);

  final String url;
  final String anonKey;

  /// False in a build with no auth flags passed. The sign-in screen then says so plainly rather
  /// than offering a form that cannot work.
  bool get isConfigured => url.isNotEmpty && anonKey.isNotEmpty;
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

  /// What Supabase returns from a sign-in, a sign-up with a confirmed user, or a refresh.
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

/// What a sign-up produced.
///
/// Supabase returns a session when the project does not require email confirmation, and no session
/// when it does. The two are different outcomes for the user - straight in, or go and check your
/// email - and the screen has to say which.
class SignUpResult {
  const SignUpResult({required this.session, required this.needsEmailConfirmation});
  final AuthSession? session;
  final bool needsEmailConfirmation;
}

class AuthClient {
  AuthClient({required SupabaseConfig config, Dio? dio})
    : _config = config,
      _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: '${config.url}/auth/v1',
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 20),
              validateStatus: (_) => true,
              headers: {
                'apikey': config.anonKey,
                'authorization': 'Bearer ${config.anonKey}',
                'content-type': 'application/json',
              },
            ),
          );

  final SupabaseConfig _config;
  final Dio _dio;

  Future<AuthSession> signIn({required String email, required String password}) async {
    final body = await _post('/token?grant_type=password', {'email': email, 'password': password});
    final session = AuthSession.fromAuthResponse(body);
    if (session == null) throw const UnknownFailure('Signed in, but no session came back.');
    return session;
  }

  Future<SignUpResult> signUp({required String email, required String password}) async {
    final body = await _post('/signup', {'email': email, 'password': password});
    final session = AuthSession.fromAuthResponse(body);
    return SignUpResult(session: session, needsEmailConfirmation: session == null);
  }

  Future<AuthSession> refresh(String refreshToken) async {
    final body = await _post('/token?grant_type=refresh_token', {'refresh_token': refreshToken});
    final session = AuthSession.fromAuthResponse(body);
    if (session == null) throw const UnauthorizedFailure();
    return session;
  }

  /// Best effort. A sign-out that fails at Supabase still clears the session on this device, which
  /// is what the user asked for and the part that matters on a shared phone.
  Future<void> signOut(String accessToken) async {
    try {
      await _dio.post<dynamic>(
        '/logout',
        options: Options(headers: {'authorization': 'Bearer $accessToken'}),
      );
    } on DioException {
      // Ignore.
    }
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    if (!_config.isConfigured) {
      throw const UnknownFailure('This build has no sign-in configured.');
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

    if (status >= 200 && status < 300) return json;

    // Supabase words its own refusals well - "Invalid login credentials", "User already
    // registered" - and they are better than anything generic. Its newer shape is
    // { error_code, msg }; the older one is { error, error_description }.
    final message =
        json['msg'] as String? ??
        json['error_description'] as String? ??
        json['message'] as String? ??
        (json['error'] is String ? json['error'] as String : null);

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
