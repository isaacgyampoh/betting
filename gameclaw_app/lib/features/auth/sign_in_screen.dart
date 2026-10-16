import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../theme/tokens.dart';
import '../../ui/section.dart';

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
  bool _busy = false;
  bool _showPassword = false;
  String? _error;
  String? _notice;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate() || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });

    final email = _email.text.trim();
    final password = _password.text;

    try {
      if (_creating) {
        final signedIn = await ref.read(sessionProvider.notifier).signUp(email: email, password: password);
        if (!mounted) return;
        if (!signedIn) {
          // The project requires email confirmation. Saying so is the whole message - there is
          // nothing else for the user to do here and no session to send them on with.
          setState(() {
            _busy = false;
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
      setState(() {
        _busy = false;
        _error = failure.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final configured = ref.watch(supabaseConfigProvider).isConfigured;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
        ),
        title: Text(_creating ? 'Create account' : 'Sign in'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(GcSpace.lg),
        children: [
          if (!configured) ...[
            const GcNote(
              'This build has no sign-in configured. It was built without the Supabase flags, so '
              'the form below cannot work.',
            ),
            const SizedBox(height: GcSpace.lg),
          ],
          Text(
            _creating
                ? 'An account keeps your slips and your conversation with Claw across devices.'
                : 'Scores and the published record are open to everyone. Signing in is for '
                    'building slips.',
            style: GcType.body,
          ),
          const SizedBox(height: GcSpace.xl),
          Form(
            key: _form,
            child: Column(
              children: [
                TextFormField(
                  controller: _email,
                  enabled: !_busy,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.next,
                  style: GcType.body,
                  decoration: _decoration('Email'),
                  validator: (value) {
                    final text = value?.trim() ?? '';
                    // Deliberately loose. The server is the authority on whether an address
                    // exists; this only catches the obvious slip before a round trip.
                    if (text.isEmpty) return 'Enter your email';
                    if (!text.contains('@') || !text.contains('.')) return "That doesn't look like an email";
                    return null;
                  },
                ),
                const SizedBox(height: GcSpace.md),
                TextFormField(
                  controller: _password,
                  enabled: !_busy,
                  obscureText: !_showPassword,
                  autofillHints: [_creating ? AutofillHints.newPassword : AutofillHints.password],
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _submit(),
                  style: GcType.body,
                  decoration: _decoration('Password').copyWith(
                    suffixIcon: IconButton(
                      onPressed: () => setState(() => _showPassword = !_showPassword),
                      icon: Icon(
                        _showPassword ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                        size: 20,
                        color: GcColors.inkMuted,
                      ),
                    ),
                  ),
                  validator: (value) {
                    if ((value ?? '').isEmpty) return 'Enter your password';
                    // Only on sign-up: an existing account may have been made under an older rule,
                    // and refusing to let someone sign in because their password is short is both
                    // useless and infuriating.
                    if (_creating && value!.length < 8) return 'Use at least 8 characters';
                    return null;
                  },
                ),
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: GcSpace.md),
            Text(_error!, style: GcType.caption.copyWith(color: GcColors.loss)),
          ],
          if (_notice != null) ...[
            const SizedBox(height: GcSpace.md),
            GcNote(_notice!),
          ],
          const SizedBox(height: GcSpace.xl),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: GcColors.onAccent),
                  )
                : Text(_creating ? 'Create account' : 'Sign in'),
          ),
          const SizedBox(height: GcSpace.md),
          TextButton(
            onPressed: _busy
                ? null
                : () => setState(() {
                      _creating = !_creating;
                      _error = null;
                      _notice = null;
                    }),
            child: Text(
              _creating ? 'I already have an account' : 'Create an account',
              style: GcType.label.copyWith(color: GcColors.accent),
            ),
          ),
          const SizedBox(height: GcSpace.xl),
          const Text(
            'You must be 18 or older to use GameClaw.',
            style: GcType.caption,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  InputDecoration _decoration(String label) => InputDecoration(
        labelText: label,
        labelStyle: GcType.body.copyWith(color: GcColors.inkMuted),
        filled: true,
        fillColor: GcColors.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(GcRadius.md),
          borderSide: const BorderSide(color: GcColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(GcRadius.md),
          borderSide: const BorderSide(color: GcColors.border),
        ),
      );
}
