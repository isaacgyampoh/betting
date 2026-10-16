import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// A filter. Selected is a lime fill; unselected is a hairline, not a grey fill - a row of grey
/// fills reads as eight buttons rather than as one choice among eight.
class GcFilterChip extends StatelessWidget {
  const GcFilterChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
    this.count,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  /// Shown after the label when there is a number worth knowing before tapping.
  final int? count;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? gc(context).accent : Colors.transparent,
        borderRadius: BorderRadius.circular(GcRadius.pill),
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onTap();
          },
          borderRadius: BorderRadius.circular(GcRadius.pill),
          child: AnimatedContainer(
            duration: GcMotion.quick,
            curve: GcMotion.curve,
            height: GcSize.buttonSm,
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.md),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(GcRadius.pill),
              border: Border.all(color: selected ? gc(context).accent : gc(context).border),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[
                  Icon(
                    icon,
                    size: 14,
                    color: selected ? gc(context).onAccent : gc(context).inkMuted,
                  ),
                  const SizedBox(width: GcSpace.xs + 2),
                ],
                Text(
                  label,
                  style: GcType.label.copyWith(
                    fontSize: 13,
                    color: selected ? gc(context).onAccent : gc(context).inkMuted,
                  ),
                ),
                if (count != null) ...[
                  const SizedBox(width: GcSpace.xs + 2),
                  Text(
                    '$count',
                    style: GcType.figureSm.copyWith(
                      color: selected
                          ? gc(context).onAccent.withValues(alpha: 0.7)
                          : gc(context).inkFaint,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A state, not a control: WON, LOST, LIVE, FT. Never tappable.
class GcStatusChip extends StatelessWidget {
  const GcStatusChip({super.key, required this.label, required this.colour, this.filled = false});

  final String label;
  final Color colour;

  /// A solid fill for the one state that should carry across a crowded screen.
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.sm, vertical: 3),
      decoration: BoxDecoration(
        color: filled ? colour : colour.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(GcRadius.xs),
      ),
      child: Text(
        label,
        style: GcType.overline.copyWith(
          fontSize: 10,
          color: filled ? gc(context).onAccent : colour,
        ),
      ),
    );
  }
}
