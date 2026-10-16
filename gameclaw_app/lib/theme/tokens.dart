/// The design system's primitives. Nothing in the app hard-codes a colour, a gap, a radius or a
/// duration: they come from here, so a change lands everywhere at once and two screens cannot
/// quietly drift apart.
///
/// The direction is a dark, dense, information-first product read on a phone, often outdoors and
/// often one-handed. That drives everything below: near-black surfaces so a bright field never
/// washes out a score, one electric accent spent only on what is live or actionable, hairlines
/// instead of cards so thirty fixtures fit on a screen without thirty boxes around them, and
/// figures that line up in columns because a list of numbers that does not is a list nobody scans.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class GcColors {
  const GcColors._();

  // Surfaces, darkest to lightest. Depth comes from these and from hairlines, not from shadows:
  // a shadow on a near-black surface is invisible, and every one costs a saved layer.
  static const canvas = Color(0xFF09090B);
  static const surface = Color(0xFF121216);
  static const surfaceRaised = Color(0xFF1A1A20);
  static const surfaceOverlay = Color(0xFF202027);

  /// Hairline. Deliberately low contrast: it should separate, not draw.
  static const border = Color(0xFF26262E);
  static const borderStrong = Color(0xFF34343E);

  static const ink = Color(0xFFF4F4F5);
  static const inkMuted = Color(0xFF9B9BA6);
  static const inkFaint = Color(0xFF61616B);

  /// Electric lime. The only accent, and spent sparingly - a primary action, a live match, the
  /// current tab. The moment it decorates something it stops meaning anything.
  static const accent = Color(0xFFCCFF2E);
  static const accentDim = Color(0xFF8BA81F);
  static const onAccent = Color(0xFF09090B);

  /// Outcomes. Only ever for an actual outcome, never for emphasis.
  static const win = Color(0xFF5EE08A);
  static const loss = Color(0xFFFF5A5F);
  static const warn = Color(0xFFFFB340);

  /// A live match. The same lime as the accent, because live is the one state the eye should find
  /// first on a screen full of fixtures.
  static const live = accent;
}

/// A 4pt scale. Everything is a multiple, so vertical rhythm holds without anyone measuring.
class GcSpace {
  const GcSpace._();
  static const xxs = 2.0;
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
  static const xxxl = 48.0;

  /// The side gutter. One value, used by every screen, so nothing is ever a few pixels out from
  /// the thing above it.
  static const gutter = 16.0;
}

class GcRadius {
  const GcRadius._();
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const pill = 999.0;
}

/// Fixed heights, so a row is the same height on every screen and a list scrolls without jitter.
class GcSize {
  const GcSize._();

  /// The smallest comfortable target. Anything less is a miss on a moving bus.
  static const touch = 48.0;
  static const buttonSm = 36.0;
  static const buttonMd = 44.0;
  static const buttonLg = 52.0;
  static const crestSm = 18.0;
  static const crestMd = 24.0;
  static const crestLg = 44.0;
  static const navBar = 62.0;
  static const fixtureRow = 64.0;
}

/// Motion. Short and few: an app that animates everything feels slower than one that does not.
class GcMotion {
  const GcMotion._();
  static const quick = Duration(milliseconds: 140);
  static const base = Duration(milliseconds: 220);
  static const slow = Duration(milliseconds: 320);

  /// Decelerating, which reads as a thing arriving rather than a thing being thrown.
  static const curve = Curves.easeOutCubic;
  static const emphasis = Curves.easeOutQuart;
}

/// The type scale.
///
/// Figures are tabular everywhere a number appears. A score, a minute, a price and a points column
/// all sit in columns that must line up, and proportional digits make a list of them look ragged.
/// Tight letter-spacing on the large sizes and slightly open spacing on the small ones is what
/// keeps a dense screen readable rather than merely small.
class GcType {
  const GcType._();

  static const _figures = <FontFeature>[FontFeature.tabularFigures()];

  static const hero = TextStyle(
    fontSize: 34,
    height: 1.05,
    fontWeight: FontWeight.w800,
    letterSpacing: -1.0,
  );
  static const display = TextStyle(
    fontSize: 26,
    height: 1.12,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.6,
  );
  static const title = TextStyle(
    fontSize: 20,
    height: 1.2,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.4,
  );
  static const heading = TextStyle(
    fontSize: 16,
    height: 1.25,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
  );
  static const body = TextStyle(fontSize: 15, height: 1.45, fontWeight: FontWeight.w400);
  static const bodyStrong = TextStyle(
    fontSize: 15,
    height: 1.45,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.1,
  );
  static const label = TextStyle(
    fontSize: 13.5,
    height: 1.3,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.1,
  );
  static const caption = TextStyle(
    fontSize: 12.5,
    height: 1.35,
    fontWeight: FontWeight.w400,
    color: GcColors.inkMuted,
  );

  /// All caps, widely spaced: a section label that reads as furniture rather than as content.
  static const overline = TextStyle(
    fontSize: 11,
    height: 1.2,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.9,
  );

  /// A scoreline.
  static const scoreHero = TextStyle(
    fontSize: 40,
    height: 1.0,
    fontWeight: FontWeight.w800,
    fontFeatures: _figures,
    letterSpacing: -1.6,
  );
  static const score = TextStyle(
    fontSize: 17,
    height: 1.1,
    fontWeight: FontWeight.w700,
    fontFeatures: _figures,
    letterSpacing: -0.4,
  );

  /// Any other number shown as a number - a minute, a price, a count, a points column.
  static const figure = TextStyle(
    fontSize: 13.5,
    height: 1.2,
    fontWeight: FontWeight.w600,
    fontFeatures: _figures,
  );
  static const figureSm = TextStyle(
    fontSize: 11.5,
    height: 1.2,
    fontWeight: FontWeight.w700,
    fontFeatures: _figures,
  );
}

/// What the system bars should look like over our canvas.
const gcSystemBars = SystemUiOverlayStyle(
  statusBarColor: Colors.transparent,
  statusBarIconBrightness: Brightness.light,
  statusBarBrightness: Brightness.dark,
  systemNavigationBarColor: GcColors.canvas,
  systemNavigationBarIconBrightness: Brightness.light,
  systemNavigationBarDividerColor: Colors.transparent,
);

ThemeData gcTheme() {
  const scheme = ColorScheme.dark(
    primary: GcColors.accent,
    onPrimary: GcColors.onAccent,
    secondary: GcColors.accent,
    onSecondary: GcColors.onAccent,
    surface: GcColors.surface,
    onSurface: GcColors.ink,
    surfaceContainerHighest: GcColors.surfaceRaised,
    outline: GcColors.border,
    error: GcColors.loss,
    onError: GcColors.ink,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: GcColors.canvas,
    canvasColor: GcColors.canvas,
    // The default ink sparkle is a Material flourish that reads as someone else's product.
    splashFactory: InkRipple.splashFactory,
    highlightColor: Colors.transparent,
    textTheme: const TextTheme(
      displayLarge: GcType.hero,
      displaySmall: GcType.display,
      titleLarge: GcType.title,
      titleMedium: GcType.heading,
      bodyLarge: GcType.body,
      bodyMedium: GcType.body,
      labelLarge: GcType.label,
      bodySmall: GcType.caption,
    ).apply(bodyColor: GcColors.ink, displayColor: GcColors.ink),
    dividerTheme: const DividerThemeData(color: GcColors.border, thickness: 1, space: 1),
    appBarTheme: const AppBarTheme(
      backgroundColor: GcColors.canvas,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
      centerTitle: false,
      systemOverlayStyle: gcSystemBars,
      titleTextStyle: GcType.title,
      iconTheme: IconThemeData(color: GcColors.ink, size: 22),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: GcColors.surface,
      surfaceTintColor: Colors.transparent,
      modalBackgroundColor: GcColors.surface,
      showDragHandle: true,
      dragHandleColor: GcColors.borderStrong,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(GcRadius.xl)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: GcColors.surfaceRaised,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: GcType.heading.copyWith(color: GcColors.ink),
      contentTextStyle: GcType.body.copyWith(color: GcColors.inkMuted),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(GcRadius.lg)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: GcColors.surfaceOverlay,
      contentTextStyle: GcType.label.copyWith(color: GcColors.ink),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(GcRadius.md)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: GcColors.accent,
      linearTrackColor: GcColors.border,
      circularTrackColor: Colors.transparent,
    ),
    sliderTheme: const SliderThemeData(
      activeTrackColor: GcColors.accent,
      thumbColor: GcColors.accent,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? GcColors.onAccent : GcColors.inkMuted,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? GcColors.accent : GcColors.surfaceRaised,
      ),
      trackOutlineColor: const WidgetStatePropertyAll(GcColors.border),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? GcColors.accent : Colors.transparent,
      ),
      checkColor: const WidgetStatePropertyAll(GcColors.onAccent),
      side: const BorderSide(color: GcColors.borderStrong, width: 1.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(GcRadius.xs)),
    ),
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: GcColors.accent,
      selectionColor: Color(0x33CCFF2E),
      selectionHandleColor: GcColors.accent,
    ),
  );
}
