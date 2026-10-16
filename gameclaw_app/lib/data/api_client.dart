import 'package:dio/dio.dart';

/// Where the app talks to its backend.
///
/// Supplied at build time (`--dart-define=GC_API_BASE=...`) and never hard-coded, because the
/// production host is a deployment decision rather than a source-code one, and because the same
/// binary has to be pointable at a local server during development.
///
/// Nothing privileged lives in here. The app holds a user's session token and nothing else: the
/// bookmaker credentials, the football provider key and the database all stay behind this
/// boundary, on the server, where a decompiled APK cannot reach them.
class ApiConfig {
  const ApiConfig({required this.baseUrl});

  /// Set at build time with `--dart-define=GC_API_BASE=...`. The default keeps a fresh checkout
  /// running without a flag; `10.0.2.2` is how an Android emulator reaches the host machine.
  static const _fromEnv = String.fromEnvironment(
    'GC_API_BASE',
    defaultValue: 'http://10.0.2.2:3000/api/v1',
  );

  factory ApiConfig.fromEnvironment() => const ApiConfig(baseUrl: _fromEnv);

  final String baseUrl;
}

/// What went wrong, in terms a screen can act on.
///
/// Every failure becomes one of these, so no widget ever has to catch a DioException or know that
/// Dio exists. The distinction that matters to a user is offline (worth retrying now) versus the
/// server said no (retrying will not help).
sealed class ApiFailure implements Exception {
  const ApiFailure(this.message);
  final String message;

  @override
  String toString() => message;
}

/// No usable connection. The only failure where an immediate retry is worth offering.
class OfflineFailure extends ApiFailure {
  const OfflineFailure() : super("You're offline. Check your connection and try again.");
}

class TimeoutFailure extends ApiFailure {
  const TimeoutFailure() : super('That took too long. Try again in a moment.');
}

/// The session is gone or was never there; the caller should send the user to sign in.
/// The person backed out of something they started, such as the Google account chooser.
///
/// Separate from the other failures because it is not one: nothing went wrong, and a screen that
/// shows a red message here is blaming someone for changing their mind.
class CancelledFailure extends ApiFailure {
  const CancelledFailure() : super('Cancelled.');
}

class UnauthorizedFailure extends ApiFailure {
  const UnauthorizedFailure() : super('Please sign in to continue.');
}

/// Signed in, but the 18+ confirmation has not been given.
///
/// Kept apart from [UnauthorizedFailure] because both arrive as a 4xx and the wrong one sends a
/// signed-in user to the sign-in screen, where signing in again changes nothing and lands them
/// right back here. The server distinguishes them by code; so do we.
class AgeNotConfirmedFailure extends ApiFailure {
  const AgeNotConfirmedFailure(super.message);
}

/// Signed in and confirmed, but not allowed - most often a self-exclusion the user set themselves.
/// The server's message says until when, and it is shown as given.
class ForbiddenFailure extends ApiFailure {
  const ForbiddenFailure(super.message);
}

/// The server answered with a refusal and its own message, which is better than anything
/// invented here - it knows why.
class ServerFailure extends ApiFailure {
  const ServerFailure(super.message, {required this.status, this.code});
  final int status;
  final String? code;
}

class UnknownFailure extends ApiFailure {
  const UnknownFailure([super.message = 'Something went wrong.']);
}

/// Supplies the bearer token, if there is one. Kept as a function so the client never holds a
/// stale copy: the token is read at the moment of the request, after any refresh.
typedef TokenReader = Future<String?> Function();

/// How long an ordinary read may take to answer.
///
/// Short on purpose: these endpoints answer from cache or from one upstream call, and a screen
/// that hangs for a minute on a dead connection is worse than one that says so. The Claw
/// conversation is the documented exception and passes its own, longer budget per request.
const Duration kGcReceiveTimeout = Duration(seconds: 20);

class ApiClient {
  ApiClient({required ApiConfig config, TokenReader? token, Dio? dio})
    : _token = token,
      _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: config.baseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: kGcReceiveTimeout,
              // Non-2xx is handled below rather than thrown as a transport error, so a refusal
              // the server explained keeps its explanation.
              validateStatus: (_) => true,
              headers: const {'accept': 'application/json'},
            ),
          ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final value = await _token?.call();
          if (value != null && value.isNotEmpty) {
            options.headers['authorization'] = 'Bearer $value';
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;
  final TokenReader? _token;

  /// A GET returning the `data` envelope every endpoint uses.
  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? query,
    CancelToken? cancel,
    Duration? receiveTimeout,
  }) => _send<T>(
    () => _dio.get<dynamic>(
      path,
      queryParameters: query,
      cancelToken: cancel,
      options: _withTimeout(receiveTimeout),
    ),
  );

  Future<T> post<T>(String path, {Object? body, CancelToken? cancel, Duration? receiveTimeout}) =>
      _send<T>(
        () => _dio.post<dynamic>(
          path,
          data: body,
          cancelToken: cancel,
          options: _withTimeout(receiveTimeout),
        ),
      );

  /// The default twenty seconds suits a football endpoint answering from cache. It is the wrong
  /// budget for an endpoint that thinks: the server declares `maxDuration = 60` for the Claw
  /// conversation, and a real reply measured 20.07 seconds against production - sixty-nine
  /// milliseconds past the client's patience. The answer was complete and correct, and the app
  /// threw it away and showed "that took too long". A per-request override is the fix; raising
  /// the global timeout instead would make every ordinary screen hang for a minute on a dead
  /// connection.
  Options? _withTimeout(Duration? receiveTimeout) =>
      receiveTimeout == null ? null : Options(receiveTimeout: receiveTimeout);

  /// DELETE with a body, which is unusual but is what unregistering a device takes: the token
  /// identifies the row and does not belong in a URL, where it would end up in access logs.
  Future<T> delete<T>(String path, {Object? body, CancelToken? cancel}) =>
      _send<T>(() => _dio.delete<dynamic>(path, data: body, cancelToken: cancel));

  Future<T> _send<T>(Future<Response<dynamic>> Function() run) async {
    final Response<dynamic> response;
    try {
      response = await run();
    } on DioException catch (error) {
      throw switch (error.type) {
        DioExceptionType.connectionTimeout ||
        DioExceptionType.receiveTimeout ||
        DioExceptionType.sendTimeout => const TimeoutFailure(),
        DioExceptionType.connectionError => const OfflineFailure(),
        DioExceptionType.cancel => const UnknownFailure('Cancelled.'),
        _ => const UnknownFailure(),
      };
    }

    final status = response.statusCode ?? 0;
    final body = response.data;

    // The API answers every failure as { error: { code, message } }. Its code is what tells the
    // three 4xx refusals apart, and its wording beats anything invented here - it knows why.
    final error = body is Map<String, dynamic> ? body['error'] as Map<String, dynamic>? : null;
    final code = error?['code'] as String?;
    final message = error?['message'] as String?;

    if (status == 401) throw const UnauthorizedFailure();
    if (status == 403) {
      throw code == 'AGE_NOT_CONFIRMED'
          ? AgeNotConfirmedFailure(message ?? 'Please confirm you are 18 or older to continue.')
          : ForbiddenFailure(message ?? 'You do not have access to that.');
    }

    if (status < 200 || status >= 300) {
      throw ServerFailure(
        message ?? 'The server could not complete that request.',
        status: status,
        code: code,
      );
    }

    if (body is! Map<String, dynamic>) {
      throw const UnknownFailure('Unexpected response from the server.');
    }
    final data = body['data'];
    if (data is! T) throw const UnknownFailure('Unexpected response from the server.');
    return data;
  }
}
