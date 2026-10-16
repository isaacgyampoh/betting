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

    test("a sign-up that returns no session is Supabase asking for email confirmation", () {
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
    AuthClient clientFor(int status, Map<String, dynamic> body) => AuthClient(
      config: const SupabaseConfig(url: 'https://p.supabase.co', anonKey: 'anon'),
      dio: Dio(BaseOptions(baseUrl: 'https://p.supabase.co/auth/v1', validateStatus: (_) => true))
        ..httpClientAdapter = _Canned(status, body),
    );

    test("Supabase's own wording for a bad password reaches the user", () async {
      // "Invalid login credentials" is better than anything we would write, and it is what the
      // user will find if they search for it.
      await expectLater(
        clientFor(400, {
          'error_code': 'invalid_credentials',
          'msg': 'Invalid login credentials',
        }).signIn(email: 'a@b.c', password: 'wrong'),
        throwsA(
          isA<ServerFailure>().having((e) => e.message, 'message', 'Invalid login credentials'),
        ),
      );
    });

    test('a build with no auth flags says so instead of failing obscurely', () async {
      final unconfigured = AuthClient(
        config: const SupabaseConfig(url: '', anonKey: ''),
        dio: Dio()..httpClientAdapter = _Canned(200, const {}),
      );
      expect(const SupabaseConfig(url: '', anonKey: '').isConfigured, isFalse);
      await expectLater(
        unconfigured.signIn(email: 'a@b.c', password: 'x'),
        throwsA(isA<UnknownFailure>()),
      );
    });

    test('a refused refresh token is an ended session, not a transport error', () async {
      await expectLater(
        clientFor(400, {'msg': 'Invalid Refresh Token'}).refresh('stale'),
        throwsA(isA<ServerFailure>()),
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
