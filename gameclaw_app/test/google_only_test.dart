import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/auth_client.dart';

/// Google is the only way in, and now that is literally true.
///
/// This file used to argue the opposite way round: it asserted that a build *without* a Web client
/// id was still `isConfigured`, so the email-and-password form it fell back to "can actually work".
/// Neither half survives. The form was removed with the Supabase client - its endpoints,
/// `/token?grant_type=password` and `/signup`, are Supabase's and answer 404 on GameClaw's API -
/// and `isConfigured` no longer has a Supabase project to be configured against.
///
/// So what is pinned here is the current contract: Google needs two things, and a build missing
/// either says so instead of offering a button.
void main() {
  const web = 'web-client-id.apps.googleusercontent.com';
  const api = 'https://gameclaw-api.onrender.com/api/v1';

  AuthConfig config({String googleClientId = web, String authBase = api}) =>
      AuthConfig(authBase: authBase, googleServerClientId: googleClientId);

  test('a build with an API host and a Web client id can offer Google', () {
    expect(config().hasGoogle, isTrue);
    expect(config().isConfigured, isTrue);
  });

  test('a build without a Web client id cannot offer Google', () {
    final without = config(googleClientId: '');
    expect(without.hasGoogle, isFalse);
    // Still a configured build: the API host is there, so the screen explains the missing OAuth
    // client rather than the missing backend. Those are different messages and send whoever reads
    // them to different places.
    expect(without.isConfigured, isTrue);
  });

  // The case that used to fall back to Supabase. There is nothing to fall back to, so it must be
  // unconfigured outright - that is what makes the failure a configuration error the screen names.
  test('a build without GC_AUTH_BASE is unconfigured, not quietly pointed elsewhere', () {
    const noBackend = AuthConfig(authBase: '', googleServerClientId: web);
    expect(noBackend.isConfigured, isFalse);
    expect(noBackend.hasGoogle, isFalse, reason: 'no backend to exchange the token with');
  });

  // The flag is read from the build, so switching it on is a flag at build time and nothing else.
  test('hasGoogle is the single switch the screen reads', () {
    expect(config(googleClientId: ' ').hasGoogle, isTrue, reason: 'non-empty is configured');
    expect(config(googleClientId: '').hasGoogle, isFalse);
  });
}
