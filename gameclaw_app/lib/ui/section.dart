import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// A titled block of a screen.
///
/// Edge-to-edge on a phone with a hairline above it, rather than a card with a margin: on a narrow
/// screen a card wastes both side gutters and stacks rounded corners inside rounded corners. Rows
/// that are already padded pass `padded: false` so nothing is indented twice.
class GcSection extends StatelessWidget {
  const GcSection({super.key, required this.title, required this.child, this.padded = true, this.action});

  final String title;
  final Widget child;
  final bool padded;

  /// An optional control on the right of the heading.
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: GcSpace.xl),
        Padding(
          padding: const EdgeInsets.fromLTRB(GcSpace.lg, 0, GcSpace.lg, GcSpace.md),
          child: Row(
            children: [
              Expanded(child: Text(title, style: GcType.heading)),
              if (action != null) action!,
            ],
          ),
        ),
        if (padded) Padding(padding: const EdgeInsets.symmetric(horizontal: GcSpace.lg), child: child) else child,
      ],
    );
  }
}

/// A line of explanation where content would be. Used wherever something is genuinely absent, and
/// always says which kind of absent.
class GcNote extends StatelessWidget {
  const GcNote(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(GcSpace.md),
      decoration: BoxDecoration(
        color: GcColors.surface,
        borderRadius: BorderRadius.circular(GcRadius.md),
        border: Border.all(color: GcColors.border),
      ),
      child: Text(text, style: GcType.caption),
    );
  }
}
