import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

/// A placeholder in the shape of the thing that is loading.
///
/// A spinner in the middle of an empty screen tells the user nothing about what is coming, and
/// every screen that uses one looks identical while it waits. A skeleton in the real layout tells
/// them it is a list of matches, how many roughly, and where to look when it arrives - and the
/// transition is then a fill rather than a jump.
class GcSkeleton extends StatefulWidget {
  const GcSkeleton({
    super.key,
    required this.width,
    required this.height,
    this.radius = GcRadius.xs,
  });

  final double width;
  final double height;
  final double radius;

  @override
  State<GcSkeleton> createState() => _GcSkeletonState();
}

class _GcSkeletonState extends State<GcSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      // A gentle breathe rather than a sweeping shimmer: a shimmer across twenty rows at once is
      // a lot of motion for something that is meant to be the absence of content.
      opacity: Tween<double>(
        begin: 0.45,
        end: 0.9,
      ).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
      child: Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          color: GcColors.surfaceRaised,
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

/// A list of fixtures, in outline. Matches the real row's geometry so nothing moves when the data
/// lands.
class GcFixtureSkeleton extends StatelessWidget {
  const GcFixtureSkeleton({super.key, this.rows = 6});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.only(top: GcSpace.sm),
      itemCount: rows,
      itemBuilder: (context, i) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.md),
        child: Row(
          children: [
            const GcSkeleton(width: 34, height: 11),
            const SizedBox(width: GcSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  GcSkeleton(width: 120.0 + (i % 3) * 34, height: 12),
                  const SizedBox(height: GcSpace.sm + 2),
                  GcSkeleton(width: 96.0 + (i % 2) * 48, height: 12),
                ],
              ),
            ),
            const SizedBox(width: GcSpace.md),
            const GcSkeleton(width: 14, height: 30),
          ],
        ),
      ),
    );
  }
}
