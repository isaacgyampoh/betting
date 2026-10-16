import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme/tokens.dart';

/// The bottom navigation, and the Android back button.
///
/// Back walks the current tab's stack and then falls back to the first tab, rather than closing
/// the app from wherever the user happens to be - which is Android's default and loses their place
/// with no warning.
class GcShell extends StatelessWidget {
  const GcShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  static const _destinations = <(IconData, IconData, String)>[
    (Icons.bolt_outlined, Icons.bolt, 'Live'),
    (Icons.star_outline_rounded, Icons.star_rounded, 'Following'),
    (Icons.auto_awesome_outlined, Icons.auto_awesome, 'Claw'),
    (Icons.insights_outlined, Icons.insights, 'Record'),
    (Icons.person_outline_rounded, Icons.person_rounded, 'Profile'),
  ];

  void _go(int index) {
    HapticFeedback.selectionClick();
    shell.goBranch(index, initialLocation: index == shell.currentIndex);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        final router = GoRouter.of(context);
        if (router.canPop()) {
          router.pop();
        } else if (shell.currentIndex != 0) {
          _go(0);
        }
        // At the root of the first tab, nothing happens. Leaving the app is the system back
        // gesture's job from there, and closing it on a stray swipe is how people lose their place.
      },
      child: Scaffold(
        body: shell,
        bottomNavigationBar: _NavBar(
          index: shell.currentIndex,
          onSelect: _go,
          destinations: _destinations,
        ),
      ),
    );
  }
}

/// A custom bar rather than NavigationBar: the Material one carries a pill indicator, its own
/// elevation tint and a 24px label gutter that cannot be removed, none of which belong here.
class _NavBar extends StatelessWidget {
  const _NavBar({required this.index, required this.onSelect, required this.destinations});

  final int index;
  final ValueChanged<int> onSelect;
  final List<(IconData, IconData, String)> destinations;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: GcColors.canvas,
        border: Border(top: BorderSide(color: GcColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: GcSize.navBar,
          child: Row(
            children: [
              for (final (i, destination) in destinations.indexed)
                Expanded(
                  child: Semantics(
                    button: true,
                    selected: i == index,
                    label: destination.$3,
                    child: InkResponse(
                      onTap: () => onSelect(i),
                      radius: 32,
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          AnimatedScale(
                            duration: GcMotion.quick,
                            curve: GcMotion.emphasis,
                            scale: i == index ? 1.0 : 0.94,
                            child: Icon(
                              i == index ? destination.$2 : destination.$1,
                              size: 22,
                              color: i == index ? GcColors.accent : GcColors.inkFaint,
                            ),
                          ),
                          const SizedBox(height: GcSpace.xs),
                          Text(
                            destination.$3,
                            style: GcType.overline.copyWith(
                              fontSize: 9.5,
                              letterSpacing: 0.3,
                              color: i == index ? GcColors.accent : GcColors.inkFaint,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
