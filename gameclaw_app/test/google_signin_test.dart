import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/api_client.dart';
import 'package:gameclaw_app/data/auth_client.dart';

/// Native Google sign-in: Google hands back an ID token and Supabase exchanges it for a session.
/// Nothing opens a web view and nothing returns through a deep link, which removes the part of
/// OAuth that most often breaks on Android - but it adds a configuration requirement that is easy
/// to get wrong, so the failures have to be legible.
void main() {
  SupabaseConfig configured({String google = 'web-client-id.apps.googleusercontent.com'}) =>
      SupabaseConfig.withGoogle(
        url: 'https://p.supabase.co',
        anonKey: 'anon',
        googleServerClientId: google,
      );

  group('what the build is able to offer', () {
    test('a build given no Web client id does not claim to support Google', () {
      expect(configured(google: '').hasGoogle, isFalse);
      expect(configured().hasGoogle, isTrue);
    });

    test('Google needs Supabase too, not just a client id', () {
      const noSupabase = SupabaseConfig.withGoogle(
        url: '',
        anonKey: '',
        googleServerClientId: 'web-client-id.apps.googleusercontent.com',
      );
      expect(noSupabase.hasGoogle, isFalse);
    });

    test('the plain constructor leaves Google off, so existing builds are unchanged', () {
      const plain = SupabaseConfig(url: 'https://p.supabase.co', anonKey: 'anon');
      expect(plain.isConfigured, isTrue);
      expect(plain.hasGoogle, isFalse);
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

  group('the exchange with Supabase', () {
    late List<RequestOptions> sent;

    AuthClient clientReturning(int status, Map<String, dynamic> body, {String? idToken}) {
      sent = [];
      final dio = Dio(
        BaseOptions(baseUrl: 'https://p.supabase.co/auth/v1', validateStatus: (_) => true),
      )..httpClientAdapter = _Spy(sent, status, jsonEncode(body));
      return AuthClient(config: configured(), dio: dio);
    }

    test('posts the id token to the id_token grant, naming google as the provider', () async {
      final client = clientReturning(200, {
        'access_token': 'at',
        'refresh_token': 'rt',
        'expires_in': 3600,
        'user': {'email': 'someone@gmail.com'},
      });

      final session = await client.signInWithGoogle(source: (_) async => 'google-id-token');

      expect(session.accessToken, 'at');
      expect(session.email, 'someone@gmail.com');
      expect(sent.single.path, '/token?grant_type=id_token');
      expect(jsonDecode(sent.single.data as String), {
        'provider': 'google',
        'id_token': 'google-id-token',
      });
    });

    // The Web client id, not the Android one: it is the audience Google stamps on the token and
    // the one both Google and Supabase check. Passing the Android id here is the classic mistake
    // and produces a token Supabase rejects.
    test('hands the Web client id to Google, not the Android one', () async {
      final client = clientReturning(200, {
        'access_token': 'at',
        'refresh_token': 'rt',
        'expires_in': 3600,
        'user': {'email': 'someone@gmail.com'},
      });
      String? seen;
      await client.signInWithGoogle(
        source: (id) async {
          seen = id;
          return 'tok';
        },
      );
      expect(seen, 'web-client-id.apps.googleusercontent.com');
    });

    // Google authenticated the person but gave nothing Supabase can verify. In practice that
    // means the Web client id is wrong, and "something went wrong" would send someone hunting
    // in the wrong place entirely.
    test('says which piece is wrong when Google returns no id token', () async {
      final client = clientReturning(200, {});
      await expectLater(
        client.signInWithGoogle(source: (_) async => null),
        throwsA(
          isA<UnknownFailure>().having((e) => e.message, 'message', contains('Web client id')),
        ),
      );
    });

    test('a refusal from Supabase keeps Supabase\'s own wording', () async {
      final client = clientReturning(400, {
        'error_code': 'validation_failed',
        'msg': 'Unacceptable audience in id_token',
      });
      await expectLater(
        client.signInWithGoogle(source: (_) async => 'x'),
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
