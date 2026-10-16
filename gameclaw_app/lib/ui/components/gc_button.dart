import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// The button hierarchy, in the order a screen should reach for them.
///
/// There is exactly one [GcButtonKind.primary] on a screen. It is the lime one, and lime is the
/// thing the eye finds first - two of them on a screen means neither is the primary action.
enum GcButtonKind { primary, secondary, ghost, destructive }

enum GcButtonSize { small, medium, large }

/// A button that cannot be double-submitted.
///
/// [onPressed] may be async. While it is running the button shows a spinner and refuses further
/// taps, which is the only reliable guard: a user on a slow connection taps a dead-looking button
/// again, and without this that is two slips built, two conversions, two of whatever it was.
class GcButton extends StatefulWidget {
  const GcButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.kind = GcButtonKind.primary,
    this.size = GcButtonSize.medium,
    this.icon,
    this.expand = true,
    this.haptic = true,
  });

  final String label;

  /// Null disables the button. A Future keeps it busy until it settles.
  final FutureOr<void> Function()? onPressed;
  final GcButtonKind kind;
  final GcButtonSize size;
  final IconData? icon;
  final bool expand;

  /// A light tick on press. On by default for a button, because a button is a commitment; off for
  /// anything that fires repeatedly.
  final bool haptic;

  @override
  State<GcButton> createState() => _GcButtonState();
}

class _GcButtonState extends State<GcButton> {
  bool _busy = false;

  Future<void> _run() async {
    final action = widget.onPressed;
    if (action == null || _busy) return;
    if (widget.haptic) HapticFeedback.selectionClick();
    final result = action();
    if (result is! Future) return;
    setState(() => _busy = true);
    try {
      await result;
    } finally {
      // The button may have been disposed by whatever it navigated to.
      if (mounted) setState(() => _busy = false);
    }
  }

  double get _height => switch (widget.size) {
    GcButtonSize.small => GcSize.buttonSm,
    GcButtonSize.medium => GcSize.buttonMd,
    GcButtonSize.large => GcSize.buttonLg,
  };

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null && !_busy;

    final (bg, fg, border) = switch (widget.kind) {
      // Disabled is its own appearance rather than a faded accent: lime at 40% is an olive that
      // still reads as a button someone should be able to press.
      GcButtonKind.primary when !enabled && !_busy => (
        gc(context).surface,
        gc(context).inkFaint,
        gc(context).border,
      ),
      GcButtonKind.primary => (gc(context).accent, gc(context).onAccent, null),
      // borderStrong, not border: a secondary button has to read as pressable, and in light
      // mode a hairline border on a near-white fill is invisible.
      GcButtonKind.secondary => (
        gc(context).surfaceRaised,
        gc(context).ink,
        gc(context).borderStrong,
      ),
      GcButtonKind.ghost => (Colors.transparent, gc(context).inkMuted, null),
      GcButtonKind.destructive => (Colors.transparent, gc(context).loss, gc(context).loss),
    };

    final content = _busy
        ? SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2, color: fg),
          )
        : Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (widget.icon != null) ...[
                Icon(widget.icon, size: widget.size == GcButtonSize.small ? 15 : 17, color: fg),
                const SizedBox(width: GcSpace.sm),
              ],
              Flexible(
                child: Text(
                  widget.label,
                  style: GcType.label.copyWith(
                    color: fg,
                    fontSize: widget.size == GcButtonSize.large ? 15 : 13.5,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          );

    return Opacity(
      // The disabled primary already has its own colours, so it needs no dimming on top.
      opacity: enabled || _busy || widget.kind == GcButtonKind.primary ? 1 : 0.45,
      child: Material(
        color: bg,
        borderRadius: BorderRadius.circular(GcRadius.md),
        child: InkWell(
          onTap: enabled ? _run : null,
          borderRadius: BorderRadius.circular(GcRadius.md),
          child: Container(
            height: _height,
            width: widget.expand ? double.infinity : null,
            padding: EdgeInsets.symmetric(horizontal: widget.expand ? GcSpace.lg : GcSpace.md),
            decoration: border == null
                ? null
                : BoxDecoration(
                    borderRadius: BorderRadius.circular(GcRadius.md),
                    border: Border.all(color: border),
                  ),
            alignment: Alignment.center,
            child: content,
          ),
        ),
      ),
    );
  }
}

/// A square icon button sized to a real finger.
class GcIconButton extends StatelessWidget {
  const GcIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    this.tooltip,
    this.colour,
    this.badge = false,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final Color? colour;

  /// A lime dot, for a control carrying state the user should notice.
  final bool badge;

  @override
  Widget build(BuildContext context) {
    final button = InkResponse(
      onTap: onPressed == null
          ? null
          : () {
              HapticFeedback.selectionClick();
              onPressed!();
            },
      radius: 24,
      child: SizedBox(
        width: GcSize.touch,
        height: GcSize.touch,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Icon(icon, size: 21, color: colour ?? gc(context).inkMuted),
            if (badge)
              Positioned(
                top: 12,
                right: 12,
                child: Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(color: gc(context).accent, shape: BoxShape.circle),
                ),
              ),
          ],
        ),
      ),
    );
    return tooltip == null ? button : Tooltip(message: tooltip!, child: button);
  }
}
