import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';

/// The 18+ confirmation.
///
/// Not decoration and not a dark pattern: the API refuses every football endpoint until this is
/// given, so a user who skips it meets a wall of refusals with no way to understand them. One
/// screen, both boxes ticked deliberately, and the button stays dead until they are.
class AgeGateScreen extends ConsumerStatefulWidget {
  const AgeGateScreen({super.key});

  @override
  ConsumerState<AgeGateScreen> createState() => _AgeGateScreenState();
}

class _AgeGateScreenState extends ConsumerState<AgeGateScreen> {
  bool _over18 = false;
  bool _terms = false;
  String? _error;

  bool get _ready => _over18 && _terms;

  Future<void> _confirm() async {
    if (!_ready) return;
    setState(() => _error = null);
    try {
      await ref.read(confirmAgeProvider)();
      if (!mounted) return;
      context.go('/home');
    } on ApiFailure catch (failure) {
      if (!mounted) return;
      setState(() => _error = failure.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  GcSpace.gutter,
                  GcSpace.xxl,
                  GcSpace.gutter,
                  GcSpace.xl,
                ),
                children: [
                  // Aligned, not bare: a ListView stretches its children across the cross axis,
                  // which overrides the Container's own width and spreads the badge full-bleed.
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: 52,
                      height: 52,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: GcColors.accent.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(GcRadius.lg),
                      ),
                      child: const Icon(Icons.shield_outlined, size: 24, color: GcColors.accent),
                    ),
                  ),
                  const SizedBox(height: GcSpace.xl),
                  Text('Before you start', style: GcType.hero),
                  const SizedBox(height: GcSpace.lg),
                  Text(
                    'GameClaw suggests bets. That makes two things true, and we would rather say '
                    'them here than bury them.',
                    style: GcType.body.copyWith(color: GcColors.inkMuted),
                  ),
                  const SizedBox(height: GcSpace.md),
                  Text(
                    'Every chance this app shows is an estimate from past results. No slip is '
                    'certain, and betting costs money over time. Decide what you are willing to '
                    'lose before you stake it.',
                    style: GcType.body.copyWith(color: GcColors.inkMuted),
                  ),
                  const SizedBox(height: GcSpace.xxl),
                  _Check(
                    value: _over18,
                    onChanged: (v) => setState(() => _over18 = v),
                    label: 'I am 18 years of age or older.',
                  ),
                  const SizedBox(height: GcSpace.sm),
                  _Check(
                    value: _terms,
                    onChanged: (v) => setState(() => _terms = v),
                    label: 'I accept the terms and understand nothing here is a guaranteed win.',
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: GcSpace.lg),
                    Text(_error!, style: GcType.caption.copyWith(color: GcColors.loss)),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.lg),
              child: Column(
                children: [
                  GcButton(
                    label: 'Continue',
                    size: GcButtonSize.large,
                    onPressed: _ready ? _confirm : null,
                  ),
                  const SizedBox(height: GcSpace.sm),
                  GcButton(
                    label: 'Not now',
                    kind: GcButtonKind.ghost,
                    onPressed: () async {
                      // Leaving means signing out. Staying signed in but unconfirmed is the state
                      // that produces a wall of refusals, so there is no door to it.
                      await ref.read(signOutProvider)();
                      if (context.mounted) context.go('/home');
                    },
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

/// A checkbox whose whole row is the tap target.
class _Check extends StatelessWidget {
  const _Check({required this.value, required this.onChanged, required this.label});

  final bool value;
  final ValueChanged<bool> onChanged;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      checked: value,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        onTap: () => onChanged(!value),
        borderRadius: BorderRadius.circular(GcRadius.md),
        child: AnimatedContainer(
          duration: GcMotion.quick,
          padding: const EdgeInsets.all(GcSpace.md),
          decoration: BoxDecoration(
            color: value ? GcColors.accent.withValues(alpha: 0.07) : GcColors.surface,
            borderRadius: BorderRadius.circular(GcRadius.md),
            border: Border.all(color: value ? GcColors.accentDim : GcColors.border),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // shrinkWrap, because the whole row is already the tap target: left at its default
              // the checkbox reserves 48px and centres its graphic inside, which on a top-aligned
              // row drops the box well below the line of text it belongs to.
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: Checkbox(
                    value: value,
                    onChanged: (v) => onChanged(v ?? false),
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              ),
              const SizedBox(width: GcSpace.md),
              Expanded(child: Text(label, style: GcType.body)),
            ],
          ),
        ),
      ),
    );
  }
}
