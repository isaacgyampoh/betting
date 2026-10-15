import 'package:flutter/material.dart';

/// The design tokens every screen draws from. Nothing in the app hard-codes a colour, a radius or
/// a gap: they come from here, so a change lands everywhere at once and two screens cannot drift.
///
/// The palette is near-black with one accent, chosen because this is a dense-information product
/// read on a phone, often outdoors: high contrast, no large bright fields, and colour reserved for
/// the few things that carry meaning - a win, a loss, a live match.
class GcColors {
  const GcColors._();

  // Surfaces, darkest to lightest. Depth comes from these rather than from shadows, which read
  // badly on dark backgrounds and cost a repaint.
  static const canvas = Color(0xFF0B0B0D);
  static const surface = Color(0xFF131316);
  static const surfaceRaised = Color(0xFF1A1A1F);
  static const border = Color(0xFF26262C);

  static const ink = Color(0xFFF5F5F7);
  static const inkMuted = Color(0xFF9B9BA4);
  static const inkFaint = Color(0xFF6B6B74);

  /// One accent, used for the primary action and nothing decorative.
  static const accent = Color(0xFF4C7DF0);
  static const onAccent = Color(0xFFFFFFFF);

  /// Outcome colours. Only ever for an actual outcome - never for emphasis.
  static const win = Color(0xFF3FB27F);
  static const loss = Color(0xFFE5484D);
  static const live = Color(0xFFE5484D);
  static const warn = Color(0xFFE2A336);
}

/// A 4pt scale. Everything is a multiple, so vertical rhythm holds without anyone measuring.
class GcSpace {
  const GcSpace._();
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
}

class GcRadius {
  const GcRadius._();
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const pill = 999.0;
}

/// Type scale.
///
/// Figures are tabular throughout. A score, a minute and a price sit in columns that must line up,
/// and proportional digits make a list of them look ragged and harder to scan.
class GcType {
  const GcType._();

  static const _figures = <FontFeature>[FontFeature.tabularFigures()];

  static const display = TextStyle(fontSize: 28, height: 1.15, fontWeight: FontWeight.w700, letterSpacing: -0.5);
  static const title = TextStyle(fontSize: 20, height: 1.2, fontWeight: FontWeight.w600, letterSpacing: -0.3);
  static const heading = TextStyle(fontSize: 16, height: 1.25, fontWeight: FontWeight.w600);
  static const body = TextStyle(fontSize: 15, height: 1.4);
  static const label = TextStyle(fontSize: 13, height: 1.3, fontWeight: FontWeight.w500);
  static const caption = TextStyle(fontSize: 12, height: 1.3, color: GcColors.inkMuted);

  /// A score line: large, tabular, and never wrapping.
  static const score = TextStyle(fontSize: 18, fontWeight: FontWeight.w700, fontFeatures: _figures, letterSpacing: -0.2);

  /// Any other number shown as a number - a minute, a price, a count.
  static const figure = TextStyle(fontSize: 14, fontWeight: FontWeight.w600, fontFeatures: _figures);
}

ThemeData gcTheme() {
  const scheme = ColorScheme.dark(
    primary: GcColors.accent,
    onPrimary: GcColors.onAccent,
    surface: GcColors.surface,
    onSurface: GcColors.ink,
    error: GcColors.loss,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: GcColors.canvas,
    splashFactory: InkSparkle.splashFactory,
    textTheme: const TextTheme(
      displaySmall: GcType.display,
      titleLarge: GcType.title,
      titleMedium: GcType.heading,
      bodyMedium: GcType.body,
      labelLarge: GcType.label,
      bodySmall: GcType.caption,
    ).apply(bodyColor: GcColors.ink, displayColor: GcColors.ink),
    dividerTheme: const DividerThemeData(color: GcColors.border, thickness: 1, space: 1),
    appBarTheme: const AppBarTheme(
      backgroundColor: GcColors.canvas,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: GcType.title,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: GcColors.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: GcColors.accent.withValues(alpha: 0.16),
      height: 64,
      labelTextStyle: WidgetStatePropertyAll(GcType.caption.copyWith(fontWeight: FontWeight.w500)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        // 48 is the smallest comfortable target; anything less is a miss on a moving bus.
        minimumSize: const Size(0, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(GcRadius.md)),
        textStyle: GcType.label.copyWith(fontSize: 15),
      ),
    ),
  );
}
