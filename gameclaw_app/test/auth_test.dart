import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/api_client.dart';
import 'package:gameclaw_app/data/auth_client.dart';

void main() {
  group('the three refusals the server makes', () {
    // All three arrive as a 4xx and all three mean something different. Telling a signed-in user
    // who has not confirmed their age to "please sign in" sends them round a loop: they sign in
    // again, nothing changes, and they are back here.
    Future<Object> failureFrom(int status, Map<String, dynamic> body) async {
      final client = ApiClient(
        config: const ApiConfig(baseUrl: 'https://example.invalid/api/v1'),
        dio: Dio(
          BaseOptions(baseUrl: 'https://example.invalid/api/v1', validateStatus: (_) => true),
        )..httpClientAdapter = _Canned(status, body),
      );
      try {
        await client.get<Map<String, dynamic>>('/matches');
        fail('expected a failure');
      } on ApiFailure catch (failure) {
        return failure;
      }
    }

    test('401 means sign in', () async {
      expect(
        await failureFrom(401, {
          'error': {'code': 'UNAUTHORIZED', 'message': 'Please sign in to continue.'},
        }),
        isA<UnauthorizedFailure>(),
      );
    });

    test('403 with AGE_NOT_CONFIRMED means confirm your age, not sign in again', () async {
      final failure = await failureFrom(403, {
        'error': {
          'code': 'AGE_NOT_CONFIRMED',
          'message': 'Please confirm you are 18 or older to continue.',
        },
      });
      expect(failure, isA<AgeNotConfirmedFailure>());
      expect(failure, isNot(isA<UnauthorizedFailure>()));
    });

    test('403 for a self-exclusion keeps the server wording, which says until when', () async {
      final failure = await failureFrom(403, {
        'error': {'code': 'FORBIDDEN', 'message': "You're taking a break until 2026-12-01."},
      });
      expect(failure, isA<ForbiddenFailure>());
      expect((failure as ApiFailure).message, contains('2026-12-01'));
    });
  });

  group('AuthSession', () {
    AuthSession at(Duration fromNow) => AuthSession(
      accessToken: 'a',
      refreshToken: 'r',
      expiresAtUtc: DateTime.now().toUtc().add(fromNow),
      email: 'x@y.z',
    );

    test('a token about to expire counts as expired', () {
      // A token that expires while the request is in flight was already too old to send.
      expect(at(const Duration(seconds: 30)).isExpired, isTrue);
      expect(at(const Duration(minutes: 10)).isExpired, isFalse);
    });

    test('survives a round trip through storage', () {
      final original = at(const Duration(hours: 1));
      final restored = AuthSession.fromJson(
        jsonDecode(jsonEncode(original.toJson())) as Map<String, dynamic>,
      )!;
      expect(restored.accessToken, original.accessToken);
      expect(restored.refreshToken, original.refreshToken);
      expect(restored.email, original.email);
      expect(restored.expiresAtUtc.isUtc, isTrue);
    });

    test('a half-written session is no session, rather than a crash on launch', () {
      expect(AuthSession.fromJson({'accessToken': 'a'}), isNull);
      expect(AuthSession.fromJson(const {}), isNull);
    });

    // A response with no tokens in it is not a session, whatever else it contains. This covered
    // Supabase's "go and confirm your email" reply; it still guards the general case, which is a
    // 2xx whose body is not what was expected.
    test('a response carrying no tokens is not a session', () {
      expect(
        AuthSession.fromAuthResponse(const {
          'user': {'email': 'x@y.z'},
        }),
        isNull,
      );
      expect(
        AuthSession.fromAuthResponse(const {
          'access_token': 'a',
          'refresh_token': 'r',
          'expires_in': 3600,
          'user': {'email': 'x@y.z'},
        }),
        isNotNull,
      );
    });
  });

  group('AuthClient', () {
    // There were email-and-password cases here, exercising Supabase's `/token?grant_type=password`
    // and its `{error_code, msg}` refusals. Both are gone: GameClaw's API has no password sign-in
    // and answers 404 to that path, and its refusals arrive as `{error: {code, message}}`.
    const api = 'https://api.test/api/v1';

    AuthClient clientFor(int status, Map<String, dynamic> body) => AuthClient(
      config: const AuthConfig(authBase: api, googleServerClientId: 'web.apps.googleusercontent.com'),
      dio: Dio(BaseOptions(baseUrl: '$api/auth', validateStatus: (_) => true))
        ..httpClientAdapter = _Canned(status, body),
    );

    test("the server's own wording reaches the user", () async {
      // The API words its refusals better than anything generic this could substitute, and its
      // wording is what the user will find if they search for it.
      await expectLater(
        clientFor(401, {
          'error': {'code': 'UNAUTHORIZED', 'message': 'That refresh token is no longer valid.'},
        }).refresh('stale'),
        throwsA(
          isA<ServerFailure>().having(
            (e) => e.message,
            'message',
            'That refresh token is no longer valid.',
          ),
        ),
      );
    });

    test('a build with no auth flags says which flag, instead of failing obscurely', () async {
      const unconfiguredConfig = AuthConfig(authBase: '', googleServerClientId: '');
      expect(unconfiguredConfig.isConfigured, isFalse);

      final unconfigured = AuthClient(
        config: unconfiguredConfig,
        dio: Dio()..httpClientAdapter = _Canned(200, const {}),
      );
      await expectLater(
        unconfigured.refresh('anything'),
        throwsA(
          isA<UnknownFailure>().having((e) => e.message, 'message', contains('GC_AUTH_BASE')),
        ),
      );
    });

    test('a refused refresh token is an ended session, not a transport error', () async {
      await expectLater(
        clientFor(400, {
          'error': {'code': 'BAD_REQUEST', 'message': 'Invalid refresh token.'},
        }).refresh('stale'),
        throwsA(isA<ServerFailure>()),
      );
    });

    test('a 2xx with no tokens is reported rather than returned as a session', () async {
      await expectLater(
        clientFor(200, const {'data': <String, dynamic>{}}).refresh('a-token'),
        throwsA(isA<UnauthorizedFailure>()),
      );
    });
  });
}

class _Canned implements HttpClientAdapter {
  _Canned(this.status, this.body);

  final int status;
  final Map<String, dynamic> body;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
