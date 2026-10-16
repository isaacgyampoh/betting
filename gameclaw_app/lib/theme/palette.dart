import 'package:flutter/material.dart';

/// Every colour the app uses, in both appearances.
///
/// A ThemeExtension rather than a set of constants, because the same token has to mean different
/// things in light and dark and a widget must not know which it is in. Read it as `gc(context)`.
///
/// The two palettes are not inversions of each other. Inverting a dark theme gives grey text on
/// grey and an accent nobody can read; each value here was chosen for its own background.
@immutable
class GcPalette extends ThemeExtension<GcPalette> {
  const GcPalette({
    required this.canvas,
    required this.surface,
    required this.surfaceRaised,
    required this.surfaceOverlay,
    required this.border,
    required this.borderStrong,
    required this.ink,
    required this.inkMuted,
    required this.inkFaint,
    required this.accent,
    required this.accentInk,
    required this.accentDim,
    required this.onAccent,
    required this.win,
    required this.loss,
    required this.warn,
  });

  /// The page behind everything.
  final Color canvas;

  /// A panel sitting on the canvas.
  final Color surface;
  final Color surfaceRaised;
  final Color surfaceOverlay;

  /// Hairline. Separates without drawing attention.
  final Color border;
  final Color borderStrong;

  final Color ink;
  final Color inkMuted;
  final Color inkFaint;

  /// The accent as a **fill**: lime in both themes, because it is the brand and it survives on
  /// either background as a block of colour.
  final Color accent;

  /// The accent as **text or an icon on the canvas**.
  ///
  /// This is why the two are separate. Lime on near-black reads beautifully; the same lime on
  /// white is about 1.3:1 and effectively invisible. In light mode this is a deep olive-lime that
  /// is recognisably the same hue and actually legible.
  final Color accentInk;

  /// A muted accent, for a border on something selected but not active.
  final Color accentDim;

  /// Text on top of [accent].
  final Color onAccent;

  /// Outcomes. Only ever for an actual outcome, never for emphasis.
  final Color win;
  final Color loss;
  final Color warn;

  /// A live match. The accent, as text, so it is legible in both themes.
  Color get live => accentInk;

  static const dark = GcPalette(
    canvas: Color(0xFF09090B),
    surface: Color(0xFF121216),
    surfaceRaised: Color(0xFF1A1A20),
    surfaceOverlay: Color(0xFF202027),
    border: Color(0xFF26262E),
    borderStrong: Color(0xFF34343E),
    ink: Color(0xFFF4F4F5),
    inkMuted: Color(0xFF9B9BA6),
    inkFaint: Color(0xFF61616B),
    accent: Color(0xFFCCFF2E),
    accentInk: Color(0xFFCCFF2E),
    accentDim: Color(0xFF8BA81F),
    onAccent: Color(0xFF09090B),
    win: Color(0xFF5EE08A),
    loss: Color(0xFFFF5A5F),
    warn: Color(0xFFFFB340),
  );

  /// Light.
  ///
  /// Off-white rather than pure white: a dense list of hairlines on #FFFFFF glares, and the
  /// panels need somewhere to sit. The outcome colours are darkened because the dark-theme greens
  /// and reds are far too pale to read on a light background.
  static const light = GcPalette(
    canvas: Color(0xFFFBFBFC),
    surface: Color(0xFFF2F2F4),
    surfaceRaised: Color(0xFFE9E9ED),
    surfaceOverlay: Color(0xFFFFFFFF),
    border: Color(0xFFE2E2E8),
    borderStrong: Color(0xFFC9C9D2),
    ink: Color(0xFF111114),
    inkMuted: Color(0xFF5B5B66),
    inkFaint: Color(0xFF8A8A95),
    // The fill stays lime: it is the brand, and black text on lime is highly legible.
    accent: Color(0xFFCCFF2E),
    // Text and icons use a deep olive-lime instead - same hue, actually readable on white.
    accentInk: Color(0xFF4A6B00),
    accentDim: Color(0xFFA8CC3A),
    onAccent: Color(0xFF14180A),
    win: Color(0xFF1E8E4A),
    loss: Color(0xFFC62B30),
    warn: Color(0xFF9A6400),
  );

  @override
  GcPalette copyWith({
    Color? canvas,
    Color? surface,
    Color? surfaceRaised,
    Color? surfaceOverlay,
    Color? border,
    Color? borderStrong,
    Color? ink,
    Color? inkMuted,
    Color? inkFaint,
    Color? accent,
    Color? accentInk,
    Color? accentDim,
    Color? onAccent,
    Color? win,
    Color? loss,
    Color? warn,
  }) => GcPalette(
    canvas: canvas ?? this.canvas,
    surface: surface ?? this.surface,
    surfaceRaised: surfaceRaised ?? this.surfaceRaised,
    surfaceOverlay: surfaceOverlay ?? this.surfaceOverlay,
    border: border ?? this.border,
    borderStrong: borderStrong ?? this.borderStrong,
    ink: ink ?? this.ink,
    inkMuted: inkMuted ?? this.inkMuted,
    inkFaint: inkFaint ?? this.inkFaint,
    accent: accent ?? this.accent,
    accentInk: accentInk ?? this.accentInk,
    accentDim: accentDim ?? this.accentDim,
    onAccent: onAccent ?? this.onAccent,
    win: win ?? this.win,
    loss: loss ?? this.loss,
    warn: warn ?? this.warn,
  );

  /// Lerped so a theme change animates rather than snapping, which is what makes switching the
  /// system appearance while the app is open look deliberate instead of like a glitch.
  @override
  GcPalette lerp(GcPalette? other, double t) {
    if (other == null) return this;
    Color c(Color a, Color b) => Color.lerp(a, b, t)!;
    return GcPalette(
      canvas: c(canvas, other.canvas),
      surface: c(surface, other.surface),
      surfaceRaised: c(surfaceRaised, other.surfaceRaised),
      surfaceOverlay: c(surfaceOverlay, other.surfaceOverlay),
      border: c(border, other.border),
      borderStrong: c(borderStrong, other.borderStrong),
      ink: c(ink, other.ink),
      inkMuted: c(inkMuted, other.inkMuted),
      inkFaint: c(inkFaint, other.inkFaint),
      accent: c(accent, other.accent),
      accentInk: c(accentInk, other.accentInk),
      accentDim: c(accentDim, other.accentDim),
      onAccent: c(onAccent, other.onAccent),
      win: c(win, other.win),
      loss: c(loss, other.loss),
      warn: c(warn, other.warn),
    );
  }
}

/// The palette for the current appearance.
///
/// Every widget reads colour through this. Falls back to dark rather than throwing: a widget
/// built outside a GameClaw theme (a test harness, a Flutter inspector preview) should render,
/// not crash.
GcPalette gc(BuildContext context) => Theme.of(context).extension<GcPalette>() ?? GcPalette.dark;
