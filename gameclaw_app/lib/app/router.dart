import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/claw/claw_screen.dart';
import '../features/discover/discover_screen.dart';
import '../features/home/home_screen.dart';
import '../features/match/match_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/scores/scores_screen.dart';
import 'shell.dart';

/// Navigation.
///
/// A StatefulShellRoute, so each tab keeps its own stack: opening a match from Scores and then
/// switching to Claw and back returns to that match, not to the top of Scores. Anything else is
/// the thing people notice immediately and cannot name.
///
/// The match screen is a child route of both Home and Scores rather than a shared top-level one.
/// That is what keeps it inside the tab it was opened from - a match opened from Home belongs to
/// Home's stack, and backing out of it should land on Home.
final routerProvider = Provider<GoRouter>((ref) {
  // A relative path: as a child of /home it resolves to /home/match/42, and as a child of
  // /scores to /scores/match/42.
  GoRoute matchRoute() => GoRoute(
        path: 'match/:id',
        builder: (context, state) {
          final id = int.tryParse(state.pathParameters['id'] ?? '');
          if (id == null) return const _BadRoute();
          return MatchScreen(fixtureId: id);
        },
      );

  return GoRouter(
    initialLocation: '/home',
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => GcShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/home', builder: (_, __) => const HomeScreen(), routes: [matchRoute()]),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/scores', builder: (_, __) => const ScoresScreen(), routes: [matchRoute()]),
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
    errorBuilder: (context, state) => const _BadRoute(),
  );
});

class _BadRoute extends StatelessWidget {
  const _BadRoute();

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(),
        body: const Center(child: Text("That screen doesn't exist.")),
      );
}
