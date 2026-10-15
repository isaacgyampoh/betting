import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/claw/claw_screen.dart';
import '../features/discover/discover_screen.dart';
import '../features/home/home_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/scores/scores_screen.dart';
import 'shell.dart';

/// Navigation.
///
/// A StatefulShellRoute, so each tab keeps its own stack: opening a match from Scores and then
/// switching to Claw and back returns to that match, not to the top of Scores. Anything else is
/// the thing people notice immediately and cannot name.
final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/home',
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => GcShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/home', builder: (_, __) => const HomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/scores', builder: (_, __) => const ScoresScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/discover', builder: (_, __) => const DiscoverScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/claw', builder: (_, __) => const ClawScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen()),
          ]),
        ],
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(child: Text('No screen for ${state.uri.path}')),
    ),
  );
});
