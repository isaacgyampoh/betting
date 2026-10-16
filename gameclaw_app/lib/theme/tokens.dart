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

import 'palette.dart';

/// The dark palette's values, kept as constants.
///
/// Only for the few places that genuinely cannot read a BuildContext - a CustomPainter's default,
/// a test fixture. Everything that can should use `gc(context)`, which follows the appearance.
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

/// The system bars, matched to the appearance.
///
/// Icons have to contrast with the canvas behind them: light icons on the dark theme, dark icons
/// on the light one. Getting this wrong leaves an invisible clock.
SystemUiOverlayStyle gcSystemBarsFor(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final palette = dark ? GcPalette.dark : GcPalette.light;
  return SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: dark ? Brightness.light : Brightness.dark,
    statusBarBrightness: dark ? Brightness.dark : Brightness.light,
    systemNavigationBarColor: palette.canvas,
    systemNavigationBarIconBrightness: dark ? Brightness.light : Brightness.dark,
    systemNavigationBarDividerColor: Colors.transparent,
  );
}

ThemeData gcTheme({Brightness brightness = Brightness.dark}) {
  final dark = brightness == Brightness.dark;
  final p = dark ? GcPalette.dark : GcPalette.light;

  final scheme = ColorScheme(
    brightness: brightness,
    primary: p.accent,
    onPrimary: p.onAccent,
    secondary: p.accent,
    onSecondary: p.onAccent,
    surface: p.surface,
    onSurface: p.ink,
    surfaceContainerHighest: p.surfaceRaised,
    outline: p.border,
    error: p.loss,
    onError: dark ? p.ink : Colors.white,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    extensions: [p],
    colorScheme: scheme,
    scaffoldBackgroundColor: p.canvas,
    canvasColor: p.canvas,
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
    ).apply(bodyColor: p.ink, displayColor: p.ink),
    dividerTheme: DividerThemeData(color: p.border, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: p.canvas,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
      centerTitle: false,
      systemOverlayStyle: gcSystemBarsFor(brightness),
      titleTextStyle: GcType.title.copyWith(color: p.ink),
      iconTheme: IconThemeData(color: p.ink, size: 22),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: p.surface,
      surfaceTintColor: Colors.transparent,
      modalBackgroundColor: p.surface,
      showDragHandle: true,
      dragHandleColor: p.borderStrong,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(GcRadius.xl)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.surfaceRaised,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: GcType.heading.copyWith(color: p.ink),
      contentTextStyle: GcType.body.copyWith(color: p.inkMuted),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(GcRadius.lg)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.surfaceOverlay,
      contentTextStyle: GcType.label.copyWith(color: p.ink),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(GcRadius.md)),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: p.accentInk,
      linearTrackColor: p.border,
      circularTrackColor: Colors.transparent,
    ),
    sliderTheme: SliderThemeData(activeTrackColor: GcColors.accent, thumbColor: GcColors.accent),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? p.onAccent : p.inkMuted,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? p.accent : p.surfaceRaised,
      ),
      trackOutlineColor: WidgetStatePropertyAll(p.border),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? p.accent : Colors.transparent,
      ),
      checkColor: WidgetStatePropertyAll(p.onAccent),
      side: BorderSide(color: p.borderStrong, width: 1.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(GcRadius.xs)),
    ),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: p.accentInk,
      selectionColor: p.accent.withValues(alpha: 0.33),
      selectionHandleColor: p.accentInk,
    ),
  );
}
