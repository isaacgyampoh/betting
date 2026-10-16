import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_input.dart';
import '../../ui/components/gc_states.dart';

/// Sign in, or make an account. One screen for both, because they are the same two fields and a
/// user who picked the wrong one should not have to go anywhere to fix it.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _creating = false;
  String? _error;
  String? _notice;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_form.currentState!.validate()) return;
    setState(() {
      _error = null;
      _notice = null;
    });

    final email = _email.text.trim();
    final password = _password.text;

    try {
      if (_creating) {
        final signedIn = await ref
            .read(sessionProvider.notifier)
            .signUp(email: email, password: password);
        if (!mounted) return;
        if (!signedIn) {
          // The project requires email confirmation. That is the whole message: there is nothing
          // else for the user to do here and no session to send them on with.
          setState(() {
            _notice = 'Check $email for a confirmation link, then come back and sign in.';
            _creating = false;
          });
          return;
        }
      } else {
        await ref.read(sessionProvider.notifier).signIn(email: email, password: password);
      }
      if (!mounted) return;
      // Straight to the 18+ gate. The API refuses every football endpoint until it is given, so
      // landing on a tab full of refusals would be a worse first impression than one question.
      context.pushReplacement('/age');
    } on ApiFailure catch (failure) {
      if (!mounted) return;
      setState(() => _error = failure.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final configured = ref.watch(supabaseConfigProvider).isConfigured;

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
                  Text('GAMECLAW', style: GcType.overline.copyWith(color: gc(context).accentInk)),
                  const SizedBox(height: GcSpace.sm),
                  Text(_creating ? 'Create an account' : 'Welcome back', style: GcType.hero),
                  const SizedBox(height: GcSpace.md),
                  Text(
                    _creating
                        ? 'An account keeps your slips and your conversation with Claw across devices.'
                        : 'Live scores and the published record are open to everyone. '
                              'Signing in is for building slips.',
                    style: GcType.body.copyWith(color: gc(context).inkMuted),
                  ),
                  if (!configured) ...[
                    const SizedBox(height: GcSpace.lg),
                    const GcNote(
                      'This build has no sign-in configured. It was built without the Supabase '
                      'flags, so the form below cannot work.',
                      icon: Icons.warning_amber_rounded,
                    ),
                  ],
                  const SizedBox(height: GcSpace.xxl),
                  Form(
                    key: _form,
                    child: Column(
                      children: [
                        GcTextField(
                          controller: _email,
                          label: 'Email',
                          icon: Icons.alternate_email_rounded,
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.email],
                          textInputAction: TextInputAction.next,
                          validator: (value) {
                            final text = value?.trim() ?? '';
                            // Deliberately loose. The server is the authority on whether an
                            // address exists; this only catches the obvious slip before a round
                            // trip.
                            if (text.isEmpty) return 'Enter your email';
                            if (!text.contains('@') || !text.contains('.')) {
                              return "That doesn't look like an email";
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: GcSpace.md),
                        GcTextField(
                          controller: _password,
                          label: 'Password',
                          icon: Icons.lock_outline_rounded,
                          obscure: true,
                          autofillHints: [
                            _creating ? AutofillHints.newPassword : AutofillHints.password,
                          ],
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) => _submit(),
                          validator: (value) {
                            if ((value ?? '').isEmpty) return 'Enter your password';
                            // Only on sign-up. Refusing to let someone sign in because an existing
                            // password is short is both useless and infuriating.
                            if (_creating && value!.length < 8) return 'Use at least 8 characters';
                            return null;
                          },
                        ),
                      ],
                    ),
                  ),
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
                  if (_notice != null) ...[
                    const SizedBox(height: GcSpace.md),
                    GcNote(_notice!, icon: Icons.mark_email_unread_outlined),
                  ],
                  const SizedBox(height: GcSpace.xl),
                  GcButton(
                    label: _creating ? 'Create account' : 'Sign in',
                    size: GcButtonSize.large,
                    onPressed: _submit,
                  ),
                  const SizedBox(height: GcSpace.sm),
                  GcButton(
                    label: _creating ? 'I already have an account' : 'Create an account',
                    kind: GcButtonKind.ghost,
                    onPressed: () => setState(() {
                      _creating = !_creating;
                      _error = null;
                      _notice = null;
                    }),
                  ),
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
