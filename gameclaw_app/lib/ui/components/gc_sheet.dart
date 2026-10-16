import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import 'gc_button.dart';

/// A bottom sheet with a title and a close control.
///
/// Used instead of a dialog whenever the content is a list the user might scroll: a dialog that
/// scrolls on a phone is a dialog that should have been a sheet. Capped at 80% of the screen so
/// the thing behind it stays visible and the sheet reads as sitting over the screen rather than
/// replacing it.
Future<T?> showGcSheet<T>({
  required BuildContext context,
  required String title,
  required Widget child,
  String? subtitle,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    backgroundColor: GcColors.surface,
    constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
    builder: (context) => GcSheet(title: title, subtitle: subtitle, child: child),
  );
}

class GcSheet extends StatelessWidget {
  const GcSheet({super.key, required this.title, required this.child, this.subtitle});

  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.sm, GcSpace.sm, GcSpace.sm),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: GcType.heading),
                      if (subtitle != null) ...[
                        const SizedBox(height: GcSpace.xxs),
                        Text(subtitle!, style: GcType.caption),
                      ],
                    ],
                  ),
                ),
                GcIconButton(
                  icon: Icons.close_rounded,
                  tooltip: 'Close',
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Flexible(child: child),
        ],
      ),
    );
  }
}

/// A yes/no question that must be answered before anything else happens.
///
/// Returns true only on an explicit confirm. Used sparingly: a dialog in front of something the
/// user already decided is an obstacle, not a safeguard.
Future<bool> showGcConfirm({
  required BuildContext context,
  required String title,
  required String message,
  String confirmLabel = 'Confirm',
  bool destructive = false,
}) async {
  final answer = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title, style: GcType.heading),
      content: Text(message, style: GcType.body.copyWith(color: GcColors.inkMuted)),
      actionsPadding: const EdgeInsets.fromLTRB(GcSpace.md, 0, GcSpace.md, GcSpace.md),
      actions: [
        GcButton(
          label: 'Cancel',
          kind: GcButtonKind.ghost,
          size: GcButtonSize.small,
          expand: false,
          onPressed: () => Navigator.of(context).pop(false),
        ),
        GcButton(
          label: confirmLabel,
          kind: destructive ? GcButtonKind.destructive : GcButtonKind.primary,
          size: GcButtonSize.small,
          expand: false,
          onPressed: () => Navigator.of(context).pop(true),
        ),
      ],
    ),
  );
  return answer ?? false;
}
