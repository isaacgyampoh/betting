import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/age_gate_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/claw/claw_screen.dart';
import '../features/record/record_screen.dart';
import '../features/favourites/favourites_screen.dart';
import '../features/home/live_centre.dart';
import '../features/match/match_screen.dart';
import '../features/profile/profile_screen.dart';
import '../theme/tokens.dart';
import 'shell.dart';

/// Navigation.
///
/// A StatefulShellRoute, so each tab keeps its own stack: opening a match from Live and then
/// switching to Claw and back returns to that match, not to the top of Live. Anything else is the
/// thing people notice immediately and cannot name.
///
/// The match screen is a child route of the tabs that can open one, rather than a shared top-level
/// route. That is what keeps it inside the tab it was opened from.
final _rootKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  // A relative path: as a child of /home it resolves to /home/match/42.
  GoRoute matchRoute() => GoRoute(
    path: 'match/:id',
    builder: (context, state) {
      final id = int.tryParse(state.pathParameters['id'] ?? '');
      if (id == null) return const _BadRoute();
      return MatchScreen(fixtureId: id);
    },
  );

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/home',
    routes: [
      // Above the shell: neither should cover the bottom bar with a form the user can wander out
      // of halfway through, and neither belongs to a tab's stack.
      GoRoute(
        path: '/signin',
        parentNavigatorKey: _rootKey,
        builder: (_, __) => const SignInScreen(),
      ),
      GoRoute(
        path: '/age',
        parentNavigatorKey: _rootKey,
        builder: (_, __) => const AgeGateScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => GcShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (_, __) => const LiveCentreScreen(),
                routes: [matchRoute()],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/following',
                builder: (_, __) => const FavouritesScreen(),
                routes: [matchRoute()],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/claw', builder: (_, __) => const ClawScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/record', builder: (_, __) => const RecordScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen())],
          ),
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
    body: const Center(child: Text("That screen doesn't exist.", style: GcType.body)),
  );
}
