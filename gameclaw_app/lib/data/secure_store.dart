import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'auth_client.dart';

/// Where the session lives.
///
/// The OS keystore, not shared preferences: the value is encrypted with a Keystore-held key, so
/// the tokens are not readable by pulling the app's data directory off a rooted device or out of
/// an adb backup.
///
/// Only the user's own session goes in here. There is no API key, no bookmaker credential and no
/// database password anywhere in the binary - those stay on the server, because anything shipped
/// in an APK is public the moment one person unzips it.
class SecureStore {
  SecureStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _session = 'gc.session';

  Future<AuthSession?> readSession() async {
    try {
      final raw = await _storage.read(key: _session);
      if (raw == null) return null;
      return AuthSession.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } on Exception {
      // A keystore entry that cannot be opened - a restored backup on new hardware, a reinstall,
      // a cleared app - means no session, not a crash on launch.
      //
      // And it has to be thrown away, not merely ignored. Returning null left the unreadable
      // blob in place, so every launch decrypted it again and failed again:
      //
      //   E FlutterSecureStorage: Could not decrypt key. decryption failed
      //
      // Seen on this device after a reinstall. Worse than the noise, a broken entry can make the
      // next write fail too, which is a user signed out on every single launch with nothing on
      // screen explaining why. Deleting it lets the next write start from a fresh key.
      await clear();
      return null;
    }
  }

  Future<void> writeSession(AuthSession session) async {
    try {
      await _storage.write(key: _session, value: jsonEncode(session.toJson()));
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
