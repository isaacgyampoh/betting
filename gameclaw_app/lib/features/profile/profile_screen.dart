import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../theme/tokens.dart';
import '../../ui/section.dart';

/// Account, and the few settings that are genuinely settings.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.only(bottom: GcSpace.xxl),
        children: [
          session.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(GcSpace.xl),
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
            ),
            error: (error, _) => GcSection(title: 'Account', child: GcNote('$error')),
            data: (session) => session == null
                ? GcSection(
                    title: 'Account',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const GcNote(
                          'Not signed in. Scores and the published record are open to everyone; '
                          'building a slip needs an account.',
                        ),
                        const SizedBox(height: GcSpace.md),
                        FilledButton(
                          onPressed: () => context.push('/signin'),
                          child: const Text('Sign in'),
                        ),
                      ],
                    ),
                  )
                : GcSection(
                    title: 'Account',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        GcNote(session.email ?? 'Signed in on this device.'),
                        const SizedBox(height: GcSpace.md),
                        OutlinedButton(
                          onPressed: () => ref.read(signOutProvider)(),
                          child: const Text('Sign out'),
                        ),
                      ],
                    ),
                  ),
          ),

          const GcSection(
            title: 'Staying in control',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Not buried in a settings page. A product that suggests bets carries this on the
                // screen people actually open.
                Text(
                  'Betting costs money over time. Decide what you are willing to lose before you '
                  'stake it, and stop when you reach it.\n\n'
                  'Every chance shown in this app is an estimate from past results. '
                  'No slip is certain, and a long price is long for a reason.',
                  style: GcType.body,
                ),
              ],
            ),
          ),

          GcSection(
            title: 'About',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('GameClaw', style: GcType.label),
                const SizedBox(height: GcSpace.xs),
                Text(
                  // The host this build talks to, shown because a tester needs to know which
                  // backend a given APK is pointed at and no screenshot otherwise says.
                  ApiConfig.fromEnvironment().baseUrl,
                  style: GcType.caption.copyWith(color: GcColors.inkFaint),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
