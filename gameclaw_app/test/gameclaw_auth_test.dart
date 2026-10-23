import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/auth_client.dart';
import 'package:gameclaw_app/data/api_client.dart';

/// Signing in against GameClaw's own API rather than Supabase.
///
/// The two backends differ in three ways that are easy to get wrong and silent when wrong: the
/// path, the response envelope, and which token a sign-out revokes.
SupabaseConfig gameclaw() => const SupabaseConfig.gameclaw(
  authBase: 'https://api.test/api/v1',
  googleServerClientId: '400646694915-web.apps.googleusercontent.com',
);

/// Records what was sent, and replies with whatever the test wants.
class _Recorder extends Interceptor {
  final List<RequestOptions> sent = [];
  final Map<String, (int, Object)> replies = {};

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    sent.add(options);
    final reply = replies[options.path] ?? (200, <String, dynamic>{});
    handler.resolve(
      Response(requestOptions: options, statusCode: reply.$1, data: reply.$2),
      true,
    );
  }
}

(AuthClient, _Recorder) clientWith(Map<String, (int, Object)> replies) {
  final rec = _Recorder()..replies.addAll(replies);
  final dio = Dio(BaseOptions(baseUrl: 'https://api.test/api/v1/auth'))..interceptors.add(rec);
  return (AuthClient(config: gameclaw(), dio: dio), rec);
}

const _session = {
  'data': {
    'access_token': 'the-access-token',
    'refresh_token': 'the-refresh-token',
    'expires_in': 3600,
    'token_type': 'bearer',
  },
};

void main() {
  test('a build with GC_AUTH_BASE set uses GameClaw, not Supabase', () {
    final config = gameclaw();
    expect(config.isGameClaw, isTrue);
    expect(config.isConfigured, isTrue);
    expect(config.hasGoogle, isTrue);
    // No Supabase project is involved at all, so there is nothing to misconfigure.
    expect(config.url, isEmpty);
    expect(config.anonKey, isEmpty);
  });

  test('Google sign-in posts the id token to /google', () async {
    final (client, rec) = clientWith({'/google': (200, _session)});
    final session = await client.signInWithGoogle(source: (_, __) async => 'an-id-token');

    expect(rec.sent.single.path, '/google');
    expect(jsonDecode(rec.sent.single.data as String), {'id_token': 'an-id-token'});
    expect(session.accessToken, 'the-access-token');
    expect(session.refreshToken, 'the-refresh-token');
  });

  test('the {"data": …} envelope is unwrapped', () async {
    // Supabase returns the token object bare; GameClaw wraps it. Reading the wrapper as the
    // session would produce a null access token and a "no session came back" error.
    final (client, _) = clientWith({'/google': (200, _session)});
    final session = await client.signInWithGoogle(source: (_, __) async => 'an-id-token');
    expect(session.accessToken, 'the-access-token');
  });

  test('refresh posts to /refresh', () async {
    final (client, rec) = clientWith({'/refresh': (200, _session)});
    await client.refresh('an-old-refresh-token');
    expect(rec.sent.single.path, '/refresh');
    expect(jsonDecode(rec.sent.single.data as String), {
      'refresh_token': 'an-old-refresh-token',
    });
  });

  test('sign-out revokes the refresh token, not the access token', () async {
    // The access token expires within the hour on its own. The refresh token is the one that
    // would let the session be resumed after the user signed out.
    final (client, rec) = clientWith({'/logout': (200, {'data': {'signed_out': true}})});
    await client.signOut('the-access-token', refreshToken: 'the-refresh-token');
    expect(rec.sent.single.path, '/logout');
    expect(jsonDecode(rec.sent.single.data as String), {
      'refresh_token': 'the-refresh-token',
    });
    expect(rec.sent.single.headers['authorization'], isNull);
  });

  test('sign-out with no refresh token sends nothing rather than a bad request', () async {
    final (client, rec) = clientWith({});
    await client.signOut('the-access-token');
    expect(rec.sent, isEmpty);
  });

  test("the server's own wording survives an error", () async {
    final (client, _) = clientWith({
      '/google': (401, {
        'error': {'code': 'UNAUTHORIZED', 'message': 'That Google sign-in could not be verified.'},
      }),
    });
    await expectLater(
      client.signInWithGoogle(source: (_, __) async => 'a-bad-token'),
      throwsA(
        isA<ServerFailure>().having(
          (e) => e.message,
          'message',
          'That Google sign-in could not be verified.',
        ),
      ),
    );
  });
}
