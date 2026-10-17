import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/auth_client.dart';

/// Google is meant to be the only way in. What stops the email form being deleted outright is
/// that deleting it today would leave no way to sign in at all, and take Claw and slip conversion
/// with it - Google has no OAuth clients registered yet. So the form is conditional on Google
/// being unavailable, and disappears on its own the moment a Web client id reaches the build.
void main() {
  const web = 'web-client-id.apps.googleusercontent.com';

  SupabaseConfig config({String googleClientId = web}) => SupabaseConfig.withGoogle(
    url: 'https://p.supabase.co',
    anonKey: 'anon',
    googleServerClientId: googleClientId,
  );

  test('a build with a Web client id can offer Google', () {
    expect(config().hasGoogle, isTrue);
  });

  test('a build without one cannot, and must keep a way in', () {
    final without = config(googleClientId: '');
    expect(without.hasGoogle, isFalse);
    // Still configured for Supabase, so the email form it falls back to can actually work.
    expect(without.isConfigured, isTrue);
  });

  test('Google needs Supabase as well as a client id', () {
    const noSupabase = SupabaseConfig.withGoogle(url: '', anonKey: '', googleServerClientId: web);
    expect(noSupabase.hasGoogle, isFalse);
  });

  // The flag is read from the build, so switching it on is a flag at build time and nothing else.
  test('hasGoogle is the single switch the screen reads', () {
    expect(config(googleClientId: ' ').hasGoogle, isTrue, reason: 'non-empty is configured');
    expect(config(googleClientId: '').hasGoogle, isFalse);
  });
}
