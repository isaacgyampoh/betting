import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Which appearance the user has chosen.
///
/// Stored in shared preferences rather than the keystore or the drift cache: it is a display
/// preference, not a secret, and it must survive a sign-out - which clears the cache.
///
/// The default is [ThemeMode.system], so a new install follows the phone. Flutter rebuilds on a
/// platform brightness change by itself, so "follow the phone" needs no listener here: with
/// themeMode set to system, MaterialApp picks the matching theme on the next frame and the
/// ThemeExtension lerps between them.
class AppearanceController extends AsyncNotifier<ThemeMode> {
  static const _key = 'gc.themeMode';

  @override
  Future<ThemeMode> build() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return _parse(prefs.getString(_key));
    } on Exception {
      // A preferences store that cannot be read is not a reason to fail launch.
      return ThemeMode.system;
    }
  }

  Future<void> set(ThemeMode mode) async {
    state = AsyncData(mode);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, mode.name);
    } on Exception {
      // The choice holds for this run; it simply will not be remembered.
    }
  }

  static ThemeMode _parse(String? raw) => switch (raw) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };
}

final appearanceProvider = AsyncNotifierProvider<AppearanceController, ThemeMode>(
  AppearanceController.new,
);

extension ThemeModeLabel on ThemeMode {
  String get label => switch (this) {
    ThemeMode.system => 'System',
    ThemeMode.light => 'Light',
    ThemeMode.dark => 'Dark',
  };
}
