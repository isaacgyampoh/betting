import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/tokens.dart';

/// The bottom navigation, and the Android back button.
///
/// Back goes to the previous tab's stack rather than closing the app: Android's default here
/// exits from anywhere, which loses a user's place with no warning.
class GcShell extends StatelessWidget {
  const GcShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  void _go(int index) => shell.goBranch(index, initialLocation: index == shell.currentIndex);

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        // Inside a tab, walk its stack. At the root of a tab, fall back to Home before leaving.
        final router = GoRouter.of(context);
        if (router.canPop()) {
          router.pop();
        } else if (shell.currentIndex != 0) {
          _go(0);
        }
      },
      child: Scaffold(
        body: shell,
        bottomNavigationBar: NavigationBar(
          selectedIndex: shell.currentIndex,
          onDestinationSelected: _go,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
            NavigationDestination(icon: Icon(Icons.sports_soccer_outlined), selectedIcon: Icon(Icons.sports_soccer), label: 'Scores'),
            NavigationDestination(icon: Icon(Icons.explore_outlined), selectedIcon: Icon(Icons.explore), label: 'Discover'),
            NavigationDestination(icon: Icon(Icons.bolt_outlined), selectedIcon: Icon(Icons.bolt), label: 'Claw'),
            NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
          ],
        ),
      ),
    );
  }
}

/// A screen that has nothing to show yet, and says so rather than pretending.
///
/// Every one of these is wired to the real navigation and will be replaced by the real screen as
/// its data path lands. None of them displays invented fixtures, scores or prices.
class GcPlaceholder extends StatelessWidget {
  const GcPlaceholder({super.key, required this.title, required this.note});

  final String title;
  final String note;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(title, style: GcType.title, textAlign: TextAlign.center),
              const SizedBox(height: GcSpace.sm),
              Text(note, style: GcType.caption, textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}
