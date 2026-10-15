import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the session token lives.
///
/// The OS keystore, not shared preferences: the value is encrypted with a Keystore-held key, so
/// the token is not readable by pulling the app's data directory off a rooted device or out of an
/// adb backup.
///
/// Only the user's own session goes in here. There is no API key, no bookmaker credential and no
/// database password anywhere in the binary - those stay on the server, because anything shipped
/// in an APK is public the moment one person unzips it.
class SecureStore {
  SecureStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _session = 'gc.session';

  Future<String?> readSession() async {
    try {
      return await _storage.read(key: _session);
    } on Exception {
      // A keystore that cannot be opened - a restored backup on new hardware, a corrupt entry -
      // means no session, not a crash on launch. The user signs in again.
      return null;
    }
  }

  Future<void> writeSession(String token) async {
    try {
      await _storage.write(key: _session, value: token);
    } on Exception {
      // Nothing useful to do: the user is signed in for this run and will be asked again next time.
    }
  }

  Future<void> clear() async {
    try {
      await _storage.delete(key: _session);
    } on Exception {
      // Ignore.
    }
  }
}
