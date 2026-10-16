import 'package:flutter/material.dart';

import '../../theme/palette.dart';

/// The live indicator: a lime dot that breathes, beside the provider's own clock.
///
/// The pulse is the one piece of ambient motion in the app, and it earns its place - it is the
/// difference between a score that is settled and a score that is still moving, read without
/// looking at anything else on the row.
class GcLiveDot extends StatefulWidget {
  const GcLiveDot({super.key, this.size = 6});

  final double size;

  @override
  State<GcLiveDot> createState() => _GcLiveDotState();
}

class _GcLiveDotState extends State<GcLiveDot> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: FadeTransition(
        opacity: Tween<double>(
          begin: 0.35,
          end: 1,
        ).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
        child: Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(color: gc(context).live, shape: BoxShape.circle),
        ),
      ),
    );
  }
}
