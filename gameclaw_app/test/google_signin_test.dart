import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/api_client.dart';
import 'package:gameclaw_app/data/auth_client.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// Native Google sign-in: Google hands back an ID token and GameClaw's API exchanges it for a
/// session. Nothing opens a web view and nothing returns through a deep link, which removes the
/// part of OAuth that most often breaks on Android - but it adds a configuration requirement that
/// is easy to get wrong, so the failures have to be legible.
///
/// The exchange used to go to Supabase, on a different path, with a different request body and a
/// different error shape. That branch has been removed, so what is asserted below is the only path
/// there is.
void main() {
  const api = 'https://api.test/api/v1';

  AuthConfig configured({String google = 'web-client-id.apps.googleusercontent.com'}) =>
      AuthConfig(authBase: api, googleServerClientId: google);

  group('what the build is able to offer', () {
    test('a build given no Web client id does not claim to support Google', () {
      expect(configured(google: '').hasGoogle, isFalse);
      expect(configured().hasGoogle, isTrue);
    });

    test('Google needs a backend to exchange the token with, not just a client id', () {
      const noBackend = AuthConfig(
        authBase: '',
        googleServerClientId: 'web-client-id.apps.googleusercontent.com',
      );
      expect(noBackend.hasGoogle, isFalse);
      expect(noBackend.isConfigured, isFalse);
    });

    test('the iOS client id defaults to empty, which is what Android wants', () {
      // Android names no client in the build - its client is matched by package name and signing
      // fingerprint - so the default must not require one.
      expect(configured().googleIosClientId, isEmpty);
      expect(configured().hasGoogle, isTrue);
    });

    test('refuses to start a flow it cannot finish', () async {
      final client = AuthClient(config: configured(google: ''));
      await expectLater(
        client.signInWithGoogle(),
        throwsA(
          isA<UnknownFailure>().having((e) => e.message, 'message', contains('not configured')),
        ),
      );
    });
  });

  group('a cancellation and a failure are not the same thing', () {
    // On the Pixel, picking an account returned canceled with "[16] Account reauth failed." while
    // Google Play Services logged "Flow failed" and "Activity finished with error". The app showed
    // nothing, because it believed the user had changed their mind. Somebody who taps a button,
    // picks their account and lands back on the same screen in silence has been told nothing.
    test('a bare cancellation stays silent', () async {
      final client = AuthClient(config: configured());
      await expectLater(
        client.signInWithGoogle(
          source: (_, __) =>
              throw const GoogleSignInException(code: GoogleSignInExceptionCode.canceled),
        ),
        throwsA(isA<CancelledFailure>()),
      );
    });

    test('a cancellation carrying a reason is reported, with the reason', () async {
      final client = AuthClient(config: configured());
      await expectLater(
        client.signInWithGoogle(
          source: (_, __) => throw const GoogleSignInException(
            code: GoogleSignInExceptionCode.canceled,
            description: '[16] Account reauth failed.',
          ),
        ),
        throwsA(
          isA<UnknownFailure>()
              .having((e) => e.message, 'message', contains('Account reauth failed'))
              .having((e) => e.message, 'message', contains('not registered with Google'))
              // Google punctuates its own reasons, and the sentence after it supplies a stop of
              // its own, which met on the device as "failed.. This usually means".
              .having((e) => e.message, 'message', isNot(contains('..'))),
        ),
      );
    });

    test('whitespace is not a reason', () async {
      final client = AuthClient(config: configured());
      await expectLater(
        client.signInWithGoogle(
          source: (_, __) => throw const GoogleSignInException(
            code: GoogleSignInExceptionCode.canceled,
            description: '   ',
          ),
        ),
        throwsA(isA<CancelledFailure>()),
      );
    });
  });

  group('the exchange with the API', () {
    late List<RequestOptions> sent;

    // The API's own shape: every success wrapped in `data`, and no `user` object - the address is
    // in the token, and the profile endpoint is what the app asks for it.
    const session = {
      'data': {
        'access_token': 'at',
        'refresh_token': 'rt',
        'expires_in': 3600,
        'token_type': 'bearer',
        'is_new': false,
      },
    };

    AuthClient clientReturning(int status, Map<String, dynamic> body) {
      sent = [];
      final dio = Dio(BaseOptions(baseUrl: '$api/auth', validateStatus: (_) => true))
        ..httpClientAdapter = _Spy(sent, status, jsonEncode(body));
      return AuthClient(config: configured(), dio: dio);
    }

    test('posts the id token to /google', () async {
      final client = clientReturning(200, session);

      final result = await client.signInWithGoogle(source: (_, __) async => 'google-id-token');

      expect(result.accessToken, 'at');
      expect(result.refreshToken, 'rt');
      // Null because the API sends no user object. Asserted rather than left unstated, so that a
      // change to the response is a failing test rather than a surprise.
      expect(result.email, isNull);
      expect(sent.single.path, '/google');
      expect(jsonDecode(sent.single.data as String), {'id_token': 'google-id-token'});
    });

    test('reads an email when one is supplied', () async {
      final client = clientReturning(200, {
        'data': {
          'access_token': 'at',
          'refresh_token': 'rt',
          'expires_in': 3600,
          'user': {'email': 'someone@gmail.com'},
        },
      });
      final result = await client.signInWithGoogle(source: (_, __) async => 'tok');
      expect(result.email, 'someone@gmail.com');
    });

    // The Web client id, not the Android one: it is the audience Google stamps on the token and
    // the one both Google and the API check. Passing the Android id here is the classic mistake
    // and produces a token the API rejects.
    test('hands the Web client id to Google, not the Android one', () async {
      final client = clientReturning(200, session);
      String? seen;
      String? seenIos;
      await client.signInWithGoogle(
        source: (id, iosId) async {
          seen = id;
          seenIos = iosId;
          return 'tok';
        },
      );
      expect(seen, 'web-client-id.apps.googleusercontent.com');
      // Empty unless a build supplies GC_GOOGLE_IOS_CLIENT_ID; Android never does.
      expect(seenIos, '');
    });

    // Google authenticated the person but gave nothing the API can verify. In practice that means
    // the Web client id is wrong, and "something went wrong" would send someone hunting in the
    // wrong place entirely.
    test('says which piece is wrong when Google returns no id token', () async {
      final client = clientReturning(200, const {});
      await expectLater(
        client.signInWithGoogle(source: (_, __) async => null),
        throwsA(
          isA<UnknownFailure>().having((e) => e.message, 'message', contains('Web client id')),
        ),
      );
    });

    test("a refusal from the API keeps the API's own wording", () async {
      final client = clientReturning(400, {
        'error': {
          'code': 'BAD_REQUEST',
          'message': 'Unacceptable audience in id_token',
        },
      });
      await expectLater(
        client.signInWithGoogle(source: (_, __) async => 'x'),
        throwsA(
          isA<ServerFailure>().having(
            (e) => e.message,
            'message',
            'Unacceptable audience in id_token',
          ),
        ),
      );
    });
  });
}

class _Spy implements HttpClientAdapter {
  _Spy(this.sent, this.status, this.body);
  final List<RequestOptions> sent;
  final int status;
  final String body;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) async {
    sent.add(options);
    return ResponseBody.fromString(
      body,
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
