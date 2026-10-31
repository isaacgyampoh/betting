import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/brand/gc_claw.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_states.dart';

/// Sign in. One way in, and it is the account already on the phone.
///
/// This screen carried an email-and-password form until the Supabase client was removed. The form
/// posted to `/token?grant_type=password` and `/signup`, which are Supabase's endpoints: GameClaw's
/// API has no password sign-in and answers 404 to both. It was already unreachable here, rendered
/// only `if (!google)` and guarded by a comment saying it existed solely because deleting it while
/// Google was unavailable would have left no way in at all - and that "the moment a Web client id
/// reaches this build, this disappears on its own". Every build passes one, so it has.
///
/// No password field is a feature rather than a reduction: there is no password to phish, to
/// forget, or to reset over email.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  bool _busy = false;
  String? _error;

  /// Signs in with the Google account on the phone.
  ///
  /// Backing out of the account chooser is not an error and leaves the screen as it was.
  Future<void> _google() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _error = null;
      _busy = true;
    });
    try {
      await ref.read(sessionProvider.notifier).signInWithGoogle();
      if (!mounted) return;
      // Straight to the 18+ gate. The API refuses every football endpoint until it is given, so
      // landing on a tab full of refusals would be a worse first impression than one question.
      context.pushReplacement('/age');
    } on CancelledFailure {
      if (mounted) setState(() => _busy = false);
    } on ApiFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _error = failure.message;
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(authConfigProvider);
    final configured = config.isConfigured;
    final google = config.hasGoogle;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: GcIconButton(
                icon: Icons.close_rounded,
                colour: gc(context).ink,
                tooltip: 'Close',
                onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  GcSpace.gutter,
                  GcSpace.sm,
                  GcSpace.gutter,
                  GcSpace.xl,
                ),
                children: [
                  Row(
                    children: [
                      GcClawMark(size: 15, colour: gc(context).accentInk),
                      const SizedBox(width: GcSpace.sm),
                      Text(
                        'GAMECLAW',
                        style: GcType.overline.copyWith(color: gc(context).accentInk),
                      ),
                    ],
                  ),
                  const SizedBox(height: GcSpace.sm),
                  Text('Sign in', style: GcType.hero),
                  const SizedBox(height: GcSpace.md),
                  Text(
                    'Live scores and the published record are open to everyone. Signing in is for '
                    'Claw and for moving a slip between bookmakers.',
                    style: GcType.body.copyWith(color: gc(context).inkMuted),
                  ),
                  if (!configured) ...[
                    const SizedBox(height: GcSpace.lg),
                    // Names the flag that is actually missing. Whoever meets this message is
                    // building by hand rather than through build-release.sh - likely the first iOS
                    // build from Xcode - and the one thing it owes them is the right name. It used
                    // to say "the Supabase flags", which sent people looking for credentials to a
                    // project that no longer exists.
                    const GcNote(
                      'This build has no sign-in configured. It was built without GC_AUTH_BASE, '
                      'so there is nothing to sign in against. Use ./build-release.sh, which '
                      'passes it.',
                      icon: Icons.warning_amber_rounded,
                    ),
                  ],
                  if (configured && !google) ...[
                    const SizedBox(height: GcSpace.lg),
                    GcNote(
                      // Named per platform, because the missing piece differs and a message that
                      // sends someone hunting for an Android fingerprint on an iPhone is worse
                      // than none at all.
                      Platform.isIOS
                          ? 'Continue with Google is not available in this build. It needs an iOS '
                                'OAuth client id passed as GC_GOOGLE_IOS_CLIENT_ID, and the '
                                'matching reversed client id as a CFBundleURLTypes entry.'
                          : 'Continue with Google is not available in this build. It needs a Web '
                                'OAuth client id, and an Android OAuth client registered against '
                                'this app\'s package name and signing fingerprint.',
                      icon: Icons.info_outline_rounded,
                    ),
                  ],
                  const SizedBox(height: GcSpace.xxl),
                  if (google)
                    GcButton(
                      label: 'Continue with Google',
                      icon: Icons.account_circle_outlined,
                      size: GcButtonSize.large,
                      kind: GcButtonKind.secondary,
                      onPressed: _busy ? null : _google,
                    ),
                  // Shown whatever the sign-in path, and that placement was a fix rather than a
                  // choice. It was once nested inside the email branch, which meant a Google
                  // sign-in that failed could not say so: the flow ran, Google Play Services
                  // logged "Flow failed. [16] Account reauth failed", and the screen rendered
                  // nothing at all. An error only one path can display is an error the other
                  // silently swallows.
                  if (_error != null) ...[
                    const SizedBox(height: GcSpace.md),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.error_outline_rounded, size: 15, color: gc(context).loss),
                        const SizedBox(width: GcSpace.sm),
                        Expanded(
                          child: Text(
                            _error!,
                            style: GcType.caption.copyWith(color: gc(context).loss),
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: GcSpace.xl),
                  Text(
                    'You must be 18 or older to use GameClaw.',
                    style: GcType.caption.copyWith(color: gc(context).inkFaint),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
