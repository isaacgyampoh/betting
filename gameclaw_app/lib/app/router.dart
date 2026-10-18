import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/providers.dart';
import '../features/auth/age_gate_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/claw/claw_screen.dart';
import '../features/competition/competition_screen.dart';
import '../features/competition/competitions_screen.dart';
import '../features/convert/convert_screen.dart';
import '../features/record/record_screen.dart';
import '../features/favourites/favourites_screen.dart';
import '../features/home/live_centre.dart';
import '../features/match/match_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/team/team_screen.dart';
import '../theme/tokens.dart';
import 'shell.dart';
import '../features/merge/merge_screen.dart';

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
  // Relative paths: as children of /home these resolve to /home/match/42 and so on, which keeps
  // each screen inside the tab it was opened from. A match opened from Following belongs to
  // Following's stack, and backing out of it lands there.
  GoRoute byId(String prefix, Widget Function(int) build) => GoRoute(
    path: '$prefix/:id',
    builder: (context, state) {
      final id = int.tryParse(state.pathParameters['id'] ?? '');
      return id == null ? const _BadRoute() : build(id);
    },
  );

  /// Like [byId], but keeps the `?date=` hint the caller attached. It is only ever a hint: a
  /// deep link that arrives without one still opens the match, just by the slower route.
  GoRoute byIdWithDate(String prefix, Widget Function(MatchRef) build) => GoRoute(
    path: '$prefix/:id',
    builder: (context, state) {
      final id = int.tryParse(state.pathParameters['id'] ?? '');
      if (id == null) return const _BadRoute();
      return build(MatchRef(id, state.uri.queryParameters['date']));
    },
  );

  List<RouteBase> footballRoutes() => [
    byIdWithDate('match', (at) => MatchScreen(match: at)),
    byId('team', (id) => TeamScreen(teamId: id)),
    byId('competition', (id) => CompetitionScreen(competitionId: id)),
    GoRoute(path: 'competitions', builder: (_, __) => const CompetitionsScreen()),
  ];

  final router = GoRouter(
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
                routes: footballRoutes(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/following',
                builder: (_, __) => const FavouritesScreen(),
                routes: footballRoutes(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/claw', builder: (_, __) => const ClawScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/convert',
                builder: (_, __) => const ConvertScreen(),
                routes: [
                  GoRoute(path: 'merge', builder: (_, __) => const MergeScreen()),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (_, __) => const ProfileScreen(),
                // Pushed rather than a tab: a published record is something you check now and
                // then, and the fifth tab is better spent on something you do.
                routes: [GoRoute(path: 'record', builder: (_, __) => const RecordScreen())],
              ),
            ],
          ),
        ],
      ),
    ],
    errorBuilder: (context, state) => const _BadRoute(),
  );

  // A notification tap can arrive before the first frame - the app may have been launched by it -
  // so the route is held until there is somewhere to send it. Cleared after use, or a hot restart
  // would navigate again on its own.
  final push = ref.read(pushServiceProvider);
  void follow() {
    final route = push.pendingRoute.value;
    if (route == null) return;
    push.pendingRoute.value = null;
    router.go(route);
  }

  push.pendingRoute.addListener(follow);
  ref.onDispose(() => push.pendingRoute.removeListener(follow));
  // One that arrived during startup, before this listener existed.
  WidgetsBinding.instance.addPostFrameCallback((_) => follow());

  return router;
});

class _BadRoute extends StatelessWidget {
  const _BadRoute();

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(),
    body: const Center(child: Text("That screen doesn't exist.", style: GcType.body)),
  );
}
