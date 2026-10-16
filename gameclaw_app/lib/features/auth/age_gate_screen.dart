import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../theme/tokens.dart';

/// The 18+ confirmation.
///
/// Not decoration and not a dark pattern: the API refuses every football endpoint until this is
/// given, so a user who skips it sees a wall of refusals with no way to understand them. One
/// screen, both boxes ticked deliberately, and the button stays dead until they are.
class AgeGateScreen extends ConsumerStatefulWidget {
  const AgeGateScreen({super.key});

  @override
  ConsumerState<AgeGateScreen> createState() => _AgeGateScreenState();
}

class _AgeGateScreenState extends ConsumerState<AgeGateScreen> {
  bool _over18 = false;
  bool _terms = false;
  bool _busy = false;
  String? _error;

  bool get _ready => _over18 && _terms && !_busy;

  Future<void> _confirm() async {
    if (!_ready) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(confirmAgeProvider)();
      if (!mounted) return;
      context.go('/home');
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
    return Scaffold(
      appBar: AppBar(title: const Text('Before you start')),
      body: ListView(
        padding: const EdgeInsets.all(GcSpace.lg),
        children: [
          const Text(
            'GameClaw suggests bets. That makes two things true, and we would rather say them '
            'here than bury them.',
            style: GcType.body,
          ),
          const SizedBox(height: GcSpace.lg),
          const Text(
            'Every chance this app shows is an estimate from past results. No slip is certain, '
            'and betting costs money over time. Decide what you are willing to lose before you '
            'stake it.',
            style: GcType.body,
          ),
          const SizedBox(height: GcSpace.xl),
          _Check(
            value: _over18,
            onChanged: _busy ? null : (v) => setState(() => _over18 = v),
            label: 'I am 18 years of age or older.',
          ),
          _Check(
            value: _terms,
            onChanged: _busy ? null : (v) => setState(() => _terms = v),
            label: 'I accept the terms and understand nothing here is a guaranteed win.',
          ),
          if (_error != null) ...[
            const SizedBox(height: GcSpace.md),
            Text(_error!, style: GcType.caption.copyWith(color: GcColors.loss)),
          ],
          const SizedBox(height: GcSpace.xl),
          FilledButton(
            onPressed: _ready ? _confirm : null,
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: GcColors.onAccent),
                  )
                : const Text('Continue'),
          ),
          const SizedBox(height: GcSpace.md),
          TextButton(
            onPressed: _busy
                ? null
                : () async {
                    // Leaving means signing out. Staying signed in but unconfirmed is the state
                    // that produces a wall of refusals, so there is no door to it.
                    await ref.read(signOutProvider)();
                    if (context.mounted) context.go('/home');
                  },
            child: Text('Not now', style: GcType.label.copyWith(color: GcColors.inkMuted)),
          ),
        ],
      ),
    );
  }
}

class _Check extends StatelessWidget {
  const _Check({required this.value, required this.onChanged, required this.label});

  final bool value;
  final ValueChanged<bool>? onChanged;
  final String label;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      // The whole row, not just the box: a 20px checkbox is a miss on a moving bus.
      onTap: onChanged == null ? null : () => onChanged!(!value),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: GcSpace.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // shrinkWrap, because the whole row is already the tap target: left at its default
            // the checkbox reserves 48px and centres its graphic inside, which on a top-aligned
            // row drops the box well below the line of text it belongs to.
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Checkbox(
                value: value,
                onChanged: onChanged == null ? null : (v) => onChanged!(v ?? false),
                side: const BorderSide(color: GcColors.inkFaint),
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
              ),
            ),
            const SizedBox(width: GcSpace.md),
            Expanded(child: Text(label, style: GcType.body)),
          ],
        ),
      ),
    );
  }
}
