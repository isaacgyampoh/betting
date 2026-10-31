import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/auth_client.dart';

/// Whether the sign-in screen offers "Continue with Google" at all.
///
/// On iOS this is not a cosmetic question. google_sign_in_ios takes its client id from the value
/// passed in, falling back to CLIENT_ID in GoogleService-Info.plist. With neither, it builds no
/// GIDConfiguration and the Google SDK raises an uncaught Objective-C exception on the first
/// sign-in attempt - which terminates the app. Observed on an iPhone 12 Pro Max: the button
/// returned the user to the home screen with the process gone. Offering a button that does that
/// is worse than offering none.
void main() {
  bool available({
    bool configured = true,
    String server = 'web-client-id.apps.googleusercontent.com',
    String ios = '',
    required bool isIOS,
  }) => AuthConfig.googleAvailable(
    configured: configured,
    serverClientId: server,
    iosClientId: ios,
    isIOS: isIOS,
  );

  group('on iOS', () {
    test('a build without an iOS client id does not offer Google', () {
      expect(available(isIOS: true), isFalse);
    });

    test('a build with one does', () {
      expect(available(ios: '400646694915-x.apps.googleusercontent.com', isIOS: true), isTrue);
    });

    test('the Web client id alone is not enough, however valid it looks', () {
      expect(available(server: 'web.apps.googleusercontent.com', ios: '', isIOS: true), isFalse);
    });
  });

  group('on Android', () {
    // Android names no client in the build at all - its client is matched by package name and
    // signing fingerprint - so requiring an iOS id there would switch off a working sign-in.
    test('an absent iOS client id is irrelevant', () {
      expect(available(ios: '', isIOS: false), isTrue);
    });

    test('an iOS client id being present changes nothing', () {
      expect(available(ios: 'something.apps.googleusercontent.com', isIOS: false), isTrue);
    });
  });

  group('what both platforms still require', () {
    test('an unconfigured build offers nothing', () {
      expect(available(configured: false, isIOS: false), isFalse);
      expect(available(configured: false, ios: 'x', isIOS: true), isFalse);
    });

    test('no Web client id means no Google, on either platform', () {
      expect(available(server: '', isIOS: false), isFalse);
      expect(available(server: '', ios: 'x', isIOS: true), isFalse);
    });
  });
}
