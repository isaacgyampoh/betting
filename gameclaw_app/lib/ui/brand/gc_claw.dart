import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../motion.dart';

/// The GameClaw mark: three tapered slashes.
///
/// Drawn rather than shipped as an image, which is what lets it be any size, any colour, and the
/// same shape in the launcher icon, the tab bar, the Claw screen and the launch animation. Three
/// PNG densities of the same glyph would be three chances for them to drift apart, and a glyph
/// that cannot take the ink colour cannot follow light and dark.
///
/// It replaces a sparkle. A sparkle is the house style of every AI feature shipped since 2023 and
/// says nothing about football or about this product; the claw is in the name, and was already in
/// the launcher icon, just in somebody else's blue.
///
/// Each slash is a circular arc swept between two radii, with the gap between them tapering to a
/// point at both ends - the shape a claw actually leaves, heavy through the middle and sharp where
/// it enters and leaves. [progress] draws them in, used once on launch and nowhere else.
class GcClawMark extends StatelessWidget {
  const GcClawMark({super.key, this.size = 24, this.colour, this.progress = 1});

  final double size;
  final Color? colour;

  /// 0 draws nothing, 1 draws the whole mark. The slashes arrive in sequence, not together.
  final double progress;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _ClawPainter(
          colour: colour ?? IconTheme.of(context).color ?? const Color(0xFFD7FF3E),
          progress: progress.clamp(0, 1),
        ),
      ),
    );
  }
}

class _ClawPainter extends CustomPainter {
  _ClawPainter({required this.colour, required this.progress});

  final Color colour;
  final double progress;

  /// Struck from off the bottom-left, so the arcs lean the way a swipe does. The radii are
  /// chosen so the middle arc passes through the centre of the box: from this origin the centre
  /// lies at -45 degrees, 1.202 box-widths away.
  static const _origin = Offset(-0.35, 1.35);

  /// Where each slash sits across the sweep, and how thick it is at its widest.
  ///
  /// The middle slash is the longest and heaviest, the outer two shorter and lighter, which is
  /// what stops three parallel curves reading as a logo for a telecoms company. These numbers
  /// were worked out and rasterised before being written here, rather than guessed at.
  static const _slashes = <({double radius, double from, double to, double weight})>[
    (radius: 1.032, from: -1.181, to: -0.463, weight: 0.070),
    (radius: 1.202, from: -1.245, to: -0.390, weight: 0.086),
    (radius: 1.372, from: -1.181, to: -0.463, weight: 0.070),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0) return;
    final s = size.shortestSide;
    final origin = Offset(s * _origin.dx, s * _origin.dy);
    final paint = Paint()
      ..color = colour
      ..isAntiAlias = true
      ..style = PaintingStyle.fill;

    for (final (i, slash) in _slashes.indexed) {
      // Staggered: each slash starts a third of the way after the one before, so the mark is
      // struck rather than faded in. The last third of the animation finishes all three.
      final start = i * 0.18;
      final t = ((progress - start) / (1 - start)).clamp(0.0, 1.0);
      if (t <= 0) continue;
      canvas.drawPath(_slashPath(origin, s, slash, t), paint);
    }
  }

  /// One tapered crescent, sampled along its arc.
  ///
  /// Sampling rather than fitting beziers by hand: the taper is a sine, so the outline is two
  /// offset curves that no single cubic describes well, and 28 points is already smooth at any
  /// size this is drawn.
  Path _slashPath(
    Offset origin,
    double s,
    ({double radius, double from, double to, double weight}) slash,
    double t,
  ) {
    const steps = 28;
    final radius = slash.radius * s;
    final half = slash.weight * s * 0.5;
    // Growing: the slash extends as it is drawn, rather than appearing at full length.
    final to = slash.from + (slash.to - slash.from) * t;

    final outer = <Offset>[];
    final inner = <Offset>[];
    for (var i = 0; i <= steps; i++) {
      final f = i / steps;
      final angle = slash.from + (to - slash.from) * f;
      // Taper to a point at both ends. Against the full sweep, not the drawn part, so the leading
      // tip stays sharp while the slash grows instead of blooming and then narrowing again.
      final fullSpan = (slash.to - slash.from).abs();
      final along = ((angle - slash.from) / fullSpan).clamp(0.0, 1.0);
      var w = half * math.sin(math.pi * along);
      // While it is still being struck, taper the leading tip to a point as well. Without this
      // the growing end is a flat cut, which reads as a bar being extruded rather than a claw.
      if (t < 1) w *= math.min(1.0, (1 - f) / 0.22);
      final dir = Offset(math.cos(angle), math.sin(angle));
      outer.add(origin + dir * (radius + w));
      inner.add(origin + dir * (radius - w));
    }

    final path = Path()..moveTo(outer.first.dx, outer.first.dy);
    for (final p in outer.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    for (final p in inner.reversed) {
      path.lineTo(p.dx, p.dy);
    }
    return path..close();
  }

  @override
  bool shouldRepaint(_ClawPainter old) => old.colour != colour || old.progress != progress;
}

/// The mark drawing itself in, once, on launch.
///
/// Short on purpose. A splash screen is a cost paid by somebody who wants to see today's scores,
/// so this is over in well under a second and never blocks: the app is already behind it, and the
/// animation is decoration on a frame that would otherwise be empty anyway.
class GcLaunchMark extends StatefulWidget {
  const GcLaunchMark({super.key, this.size = 72, this.colour, this.onDone});

  final double size;
  final Color? colour;
  final VoidCallback? onDone;

  @override
  State<GcLaunchMark> createState() => _GcLaunchMarkState();
}

class _GcLaunchMarkState extends State<GcLaunchMark> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 620),
  );

  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (gcMotionAllowed(context)) {
      _controller.forward().whenComplete(() => widget.onDone?.call());
    } else {
      // Drawn, not animated. The mark still appears; it simply does not get struck.
      _controller.value = 1;
      WidgetsBinding.instance.addPostFrameCallback((_) => widget.onDone?.call());
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => GcClawMark(
        size: widget.size,
        colour: widget.colour,
        // Decelerating: fast at the strike, settling at the end.
        progress: Curves.easeOutCubic.transform(_controller.value),
      ),
    );
  }
}
