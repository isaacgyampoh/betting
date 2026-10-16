import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/tokens.dart';

/// A segmented control: two to four mutually exclusive views of the same thing.
///
/// The selected segment is a lime pill that slides, rather than a colour swap. The slide is what
/// makes the relationship between the segments legible - it is one control with a position, not
/// three buttons that happen to sit together.
class GcSegmented extends StatelessWidget {
  const GcSegmented({
    super.key,
    required this.segments,
    required this.index,
    required this.onChanged,
  });

  final List<String> segments;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 38,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: GcColors.surface,
        borderRadius: BorderRadius.circular(GcRadius.pill),
        border: Border.all(color: GcColors.border),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth / segments.length;
          return Stack(
            children: [
              AnimatedPositioned(
                duration: GcMotion.base,
                curve: GcMotion.emphasis,
                left: width * index,
                top: 0,
                bottom: 0,
                width: width,
                child: Container(
                  decoration: BoxDecoration(
                    color: GcColors.accent,
                    borderRadius: BorderRadius.circular(GcRadius.pill),
                  ),
                ),
              ),
              Row(
                children: [
                  for (final (i, segment) in segments.indexed)
                    Expanded(
                      child: Semantics(
                        button: true,
                        selected: i == index,
                        child: GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: () {
                            if (i == index) return;
                            HapticFeedback.selectionClick();
                            onChanged(i);
                          },
                          child: Center(
                            child: AnimatedDefaultTextStyle(
                              duration: GcMotion.quick,
                              style: GcType.label.copyWith(
                                fontSize: 13,
                                color: i == index ? GcColors.onAccent : GcColors.inkMuted,
                              ),
                              child: Text(segment),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Underlined tabs, for more sections than a segmented control can hold - a match centre's
/// Overview, Timeline, Statistics, Table. Scrolls horizontally when it has to.
class GcTabBar extends StatelessWidget {
  const GcTabBar({super.key, required this.tabs, required this.index, required this.onChanged});

  final List<String> tabs;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
        itemCount: tabs.length,
        itemBuilder: (context, i) {
          final selected = i == index;
          return Semantics(
            button: true,
            selected: selected,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () {
                if (selected) return;
                HapticFeedback.selectionClick();
                onChanged(i);
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: GcSpace.md),
                alignment: Alignment.center,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Spacer(),
                    Text(
                      tabs[i],
                      style: GcType.label.copyWith(
                        color: selected ? GcColors.ink : GcColors.inkFaint,
                      ),
                    ),
                    const SizedBox(height: GcSpace.sm),
                    // The rule is always there, so the row does not jump by 2px on selection.
                    AnimatedContainer(
                      duration: GcMotion.quick,
                      height: 2,
                      width: selected ? 20 : 0,
                      decoration: BoxDecoration(
                        color: GcColors.accent,
                        borderRadius: BorderRadius.circular(GcRadius.pill),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
