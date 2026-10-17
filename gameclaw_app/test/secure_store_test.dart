import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/auth_client.dart';
import 'package:gameclaw_app/data/secure_store.dart';

/// What happens when the device's keystore cannot open what we stored.
///
/// Seen on the Pixel after a reinstall:
///   E FlutterSecureStorage: Could not decrypt key. decryption failed
///
/// Answering "no session" is right. Leaving the unreadable entry in place is not: every launch
/// decrypts it again and fails again, and a broken entry can make the next write fail too, which
/// is a user signed out on every launch with nothing on screen to explain it.
///
/// Routed entirely through noSuchMethod rather than declared overrides: the plugin's option
/// types change between major versions, and a stub that names them stops compiling for reasons
/// that have nothing to do with what is being tested.
class _Storage implements FlutterSecureStorage {
  _Storage({this.readThrows = false});

  final bool readThrows;
  final Map<String, String> values = {};
  int deletes = 0;

  @override
  dynamic noSuchMethod(Invocation invocation) {
    final name = invocation.memberName;
    final key = invocation.namedArguments[#key] as String?;

    if (name == #read) {
      if (readThrows) {
        return Future<String?>.error(
          PlatformException(code: 'Exception', message: 'Could not decrypt key.'),
        );
      }
      return Future<String?>.value(values[key]);
    }
    if (name == #write) {
      final value = invocation.namedArguments[#value] as String?;
      if (key != null && value != null) values[key] = value;
      return Future<void>.value();
    }
    if (name == #delete) {
      deletes += 1;
      values.remove(key);
      return Future<void>.value();
    }
    return super.noSuchMethod(invocation);
  }
}

void main() {
  test('an unreadable entry is thrown away, not left to fail forever', () async {
    final storage = _Storage(readThrows: true);
    storage.values['gc.session'] = 'whatever-cannot-be-decrypted';

    final store = SecureStore(storage: storage);
    expect(await store.readSession(), isNull);

    // The point: the bad entry is gone, so the next write starts from a fresh key instead of
    // decrypting the same unreadable blob on every launch.
    expect(storage.deletes, 1);
    expect(storage.values.containsKey('gc.session'), isFalse);
  });

  test('a missing session is simply absent, with nothing deleted', () async {
    final storage = _Storage();
    final store = SecureStore(storage: storage);
    expect(await store.readSession(), isNull);
    // No entry, no problem, no pointless delete.
    expect(storage.deletes, 0);
  });

  test('a readable session comes back intact', () async {
    final storage = _Storage();
    final store = SecureStore(storage: storage);
    await store.writeSession(
      AuthSession(
        accessToken: 'a',
        refreshToken: 'r',
        expiresAtUtc: DateTime.utc(2030),
        email: 'someone@example.com',
      ),
    );
    final back = await store.readSession();
    expect(back?.accessToken, 'a');
    expect(back?.refreshToken, 'r');
    expect(storage.deletes, 0);
  });
}
