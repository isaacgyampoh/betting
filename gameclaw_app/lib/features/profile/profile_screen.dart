import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api_client.dart';
import '../../data/auth_client.dart';
import '../../data/providers.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_states.dart';

/// Account, and the few things that are genuinely settings.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final favourites = ref.watch(favouriteTeamsProvider).value?.length ?? 0;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.md, GcSpace.gutter, GcSpace.lg),
              child: Text('Profile', style: GcType.display),
            ),
            session.when(
              loading: () => const Padding(
                padding: EdgeInsets.all(GcSpace.xl),
                child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
              ),
              error: (error, _) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
                child: GcNote('$error'),
              ),
              data: (current) => current == null
                  ? _SignedOut(onSignIn: () => context.push('/signin'))
                  : _SignedIn(
                      session: current,
                      favourites: favourites,
                      onSignOut: () => ref.read(signOutProvider)(),
                    ),
            ),
            const GcSectionHeader(title: 'Notifications'),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter),
              child: _Notifications(),
            ),
            const GcSectionHeader(title: 'Our record'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
              child: GcButton(
                label: 'Every slip we have published',
                kind: GcButtonKind.secondary,
                icon: Icons.insights_outlined,
                onPressed: () => context.push('/profile/record'),
              ),
            ),
            const GcSectionHeader(title: 'Staying in control'),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Not buried in a settings page. A product that suggests bets carries this on a
                  // screen people actually open.
                  Text(
                    'Betting costs money over time. Decide what you are willing to lose before you '
                    'stake it, and stop when you reach it.',
                    style: GcType.body,
                  ),
                  SizedBox(height: GcSpace.md),
                  Text(
                    'Every chance shown in this app is an estimate from past results. No slip is '
                    'certain, and a long price is long for a reason.',
                    style: GcType.body,
                  ),
                ],
              ),
            ),
            const GcSectionHeader(title: 'About'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text('GameClaw', style: GcType.label),
                      const Spacer(),
                      Text(
                        // The host this build talks to. A tester needs to know which backend a
                        // given APK points at, and no screenshot otherwise says.
                        ApiConfig.fromEnvironment().baseUrl,
                        style: GcType.caption.copyWith(fontSize: 11, color: GcColors.inkFaint),
                      ),
                    ],
                  ),
                  if (!ref.watch(supabaseConfigProvider).isConfigured) ...[
                    const SizedBox(height: GcSpace.md),
                    const GcNote(
                      'This build has no sign-in configured.',
                      icon: Icons.info_outline_rounded,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SignedOut extends StatelessWidget {
  const _SignedOut({required this.onSignIn});

  final VoidCallback onSignIn;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const GcNote(
            'Not signed in. Scores and the published record are open to everyone; '
            'building a slip needs an account.',
            icon: Icons.lock_outline_rounded,
          ),
          const SizedBox(height: GcSpace.md),
          GcButton(label: 'Sign in', onPressed: onSignIn, icon: Icons.login_rounded),
        ],
      ),
    );
  }
}

class _SignedIn extends StatelessWidget {
  const _SignedIn({required this.session, required this.favourites, required this.onSignOut});

  final AuthSession session;
  final int favourites;
  final Future<void> Function() onSignOut;

  @override
  Widget build(BuildContext context) {
    final email = session.email ?? 'Signed in on this device';
    final initial = email.trim().isEmpty ? '?' : email.trim().characters.first.toUpperCase();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(GcSpace.md),
            decoration: BoxDecoration(
              color: GcColors.surface,
              borderRadius: BorderRadius.circular(GcRadius.lg),
              border: Border.all(color: GcColors.border),
            ),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: GcColors.accent,
                    borderRadius: BorderRadius.circular(GcRadius.md),
                  ),
                  child: Text(initial, style: GcType.heading.copyWith(color: GcColors.onAccent)),
                ),
                const SizedBox(width: GcSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        email,
                        style: GcType.bodyStrong,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: GcSpace.xxs),
                      Text(
                        favourites == 0
                            ? 'No teams followed'
                            : '$favourites ${favourites == 1 ? 'team' : 'teams'} followed',
                        style: GcType.caption,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: GcSpace.md),
          GcButton(
            label: 'Sign out',
            onPressed: onSignOut,
            kind: GcButtonKind.secondary,
            icon: Icons.logout_rounded,
          ),
          const SizedBox(height: GcSpace.sm),
          Text(
            // Said because it is a real consequence and a surprise otherwise.
            'Signing out clears everything saved on this device. Followed teams are kept.',
            style: GcType.caption.copyWith(fontSize: 11.5, color: GcColors.inkFaint),
          ),
        ],
      ),
    );
  }
}

/// Whether this device receives alerts.
///
/// The permission is asked for here, at the moment the user turns alerts on, rather than at
/// launch: a prompt on first open - before anything has been explained - is the one most people
/// refuse for ever, and Android gives no second chance without a trip to Settings.
class _Notifications extends ConsumerStatefulWidget {
  const _Notifications();

  @override
  ConsumerState<_Notifications> createState() => _NotificationsState();
}

class _NotificationsState extends ConsumerState<_Notifications> {
  bool? _on;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final on = await ref.read(pushServiceProvider).hasPermission();
    if (mounted) setState(() => _on = on);
  }

  Future<void> _toggle(bool want) async {
    setState(() => _busy = true);
    final push = ref.read(pushServiceProvider);
    if (want) {
      final granted = await push.requestPermission();
      if (granted) await push.register();
      if (mounted) setState(() => _on = granted);
    } else {
      await push.unregister();
      if (mounted) setState(() => _on = false);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final push = ref.watch(pushServiceProvider);
    final signedIn = ref.watch(isSignedInProvider);

    if (!push.available) {
      return const GcNote(
        'This build has no notification support configured.',
        icon: Icons.notifications_off_outlined,
      );
    }
    if (!signedIn) {
      return const GcNote(
        'Sign in to get alerts about the teams you follow.',
        icon: Icons.notifications_none_rounded,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Match alerts', style: GcType.bodyStrong),
                  const SizedBox(height: GcSpace.xxs),
                  Text(
                    'Kick-off, goals and full time for the teams you follow.',
                    style: GcType.caption,
                  ),
                ],
              ),
            ),
            const SizedBox(width: GcSpace.md),
            Switch(value: _on ?? false, onChanged: _busy || _on == null ? null : _toggle),
          ],
        ),
        if (_on == false) ...[
          const SizedBox(height: GcSpace.sm),
          Text(
            // Android will not prompt twice. Saying so is the difference between a user who fixes
            // it and one who taps a dead switch.
            'If the switch does nothing, Android has already been told no. '
            'Turn notifications on for GameClaw in Android Settings.',
            style: GcType.caption.copyWith(fontSize: 11.5, color: GcColors.inkFaint),
          ),
        ],
      ],
    );
  }
}
