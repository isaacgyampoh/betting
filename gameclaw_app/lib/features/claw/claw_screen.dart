import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/repository.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/brand/gc_claw.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_chip.dart';
import '../../ui/components/gc_slip_card.dart';
import '../../ui/components/gc_states.dart';
import 'claw_controller.dart';

/// Ask for a slip in words, get one back with the reasoning attached.
class ClawScreen extends ConsumerStatefulWidget {
  const ClawScreen({super.key});

  @override
  ConsumerState<ClawScreen> createState() => _ClawScreenState();
}

class _ClawScreenState extends ConsumerState<ClawScreen> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();

  @override
  void dispose() {
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send(String text) async {
    if (text.trim().isEmpty) return;
    _composer.clear();
    FocusScope.of(context).unfocus();
    await ref.read(chatProvider.notifier).send(text);
    _toBottom();
  }

  /// After a frame, so the new turn has been laid out and its height is known.
  void _toBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: GcMotion.base,
        curve: GcMotion.curve,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatProvider);

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                GcSpace.gutter,
                GcSpace.md,
                GcSpace.sm,
                GcSpace.sm,
              ),
              child: Row(
                children: [
                  Expanded(child: Text('Claw', style: GcType.display)),
                  if (chat.allowance != null)
                    Padding(
                      padding: const EdgeInsets.only(right: GcSpace.sm),
                      child: Text(
                        chat.allowance!.kind == 'trial'
                            ? '${chat.allowance!.remaining} free left'
                            : '${chat.allowance!.remaining} left today',
                        style: GcType.caption.copyWith(fontSize: 11.5, color: gc(context).inkFaint),
                      ),
                    ),
                  if (chat.turns.isNotEmpty)
                    GcIconButton(
                      icon: Icons.edit_note_rounded,
                      tooltip: 'New conversation',
                      onPressed: () => ref.read(chatProvider.notifier).clear(),
                    ),
                ],
              ),
            ),
            Expanded(
              child: chat.turns.isEmpty
                  ? _Intro(onPick: _send)
                  : ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.only(top: GcSpace.sm, bottom: GcSpace.lg),
                      itemCount: chat.turns.length,
                      itemBuilder: (context, i) => _Turn(
                        turn: chat.turns[i],
                        onRetry: () => ref.read(chatProvider.notifier).retry(),
                      ),
                    ),
            ),
            if (chat.sending) const _Thinking(),
            if (chat.error != null && !chat.sending)
              Padding(
                padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.sm),
                child: Row(
                  children: [
                    Icon(Icons.error_outline_rounded, size: 14, color: gc(context).loss),
                    const SizedBox(width: GcSpace.sm),
                    Expanded(
                      child: Text(
                        chat.error!.message,
                        style: GcType.caption.copyWith(color: gc(context).loss),
                      ),
                    ),
                  ],
                ),
              ),
            if (chat.quickReplies.isNotEmpty && !chat.sending)
              SizedBox(
                height: 36 + GcSpace.sm,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.sm),
                  itemCount: chat.quickReplies.length,
                  separatorBuilder: (_, __) => const SizedBox(width: GcSpace.sm),
                  itemBuilder: (context, i) => GcFilterChip(
                    label: chat.quickReplies[i].label,
                    selected: false,
                    onTap: () => _send(chat.quickReplies[i].message),
                  ),
                ),
              ),
            _Composer(controller: _composer, enabled: !chat.sending, onSubmit: _send),
          ],
        ),
      ),
    );
  }
}

class _Intro extends StatelessWidget {
  const _Intro({required this.onPick});

  final ValueChanged<String> onPick;

  static const _examples = [
    'Build me a 5 odds slip for tonight',
    'Three games from the Premier League, nothing riskier than 1.60',
    'What do the numbers say about the games in my slip?',
  ];

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.xl, GcSpace.gutter, GcSpace.lg),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: gc(context).accent.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(GcRadius.lg),
            ),
            child: GcClawMark(size: 24, colour: gc(context).accentInk),
          ),
        ),
        const SizedBox(height: GcSpace.lg),
        Text('Ask for a slip', style: GcType.title),
        const SizedBox(height: GcSpace.sm),
        Text(
          'Describe what you want and Claw builds it from real fixtures and real prices, with the '
          'reason for every pick. It will tell you when it cannot find one.',
          style: GcType.body.copyWith(color: gc(context).inkMuted),
        ),
        const SizedBox(height: GcSpace.xl),
        for (final example in _examples)
          Padding(
            padding: const EdgeInsets.only(bottom: GcSpace.sm),
            child: _Example(text: example, onTap: () => onPick(example)),
          ),
        const SizedBox(height: GcSpace.lg),
        const GcNote(
          'Estimated chances, not certainties. Prices move, and a slip that was available a '
          'minute ago may not be now.',
          icon: Icons.info_outline_rounded,
        ),
      ],
    );
  }
}

class _Example extends StatelessWidget {
  const _Example({required this.text, required this.onTap});

  final String text;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(GcRadius.md),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.md),
        decoration: BoxDecoration(
          color: gc(context).surface,
          borderRadius: BorderRadius.circular(GcRadius.md),
          border: Border.all(color: gc(context).border),
        ),
        child: Row(
          children: [
            Expanded(child: Text(text, style: GcType.body.copyWith(fontSize: 14))),
            const SizedBox(width: GcSpace.sm),
            Icon(Icons.arrow_outward_rounded, size: 15, color: gc(context).inkFaint),
          ],
        ),
      ),
    );
  }
}

class _Turn extends StatelessWidget {
  const _Turn({required this.turn, required this.onRetry});

  final ChatTurn turn;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (turn.isUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.fromLTRB(52, GcSpace.sm, GcSpace.gutter, GcSpace.sm),
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.sm + 2),
          decoration: BoxDecoration(
            color: turn.failed ? gc(context).surface : gc(context).accent,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(GcRadius.lg),
              topRight: Radius.circular(GcRadius.lg),
              bottomLeft: Radius.circular(GcRadius.lg),
              bottomRight: Radius.circular(GcRadius.xs),
            ),
            border: turn.failed ? Border.all(color: gc(context).loss) : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                turn.text,
                style: GcType.body.copyWith(
                  fontSize: 14.5,
                  color: turn.failed ? gc(context).ink : gc(context).onAccent,
                ),
              ),
              if (turn.failed) ...[
                const SizedBox(height: GcSpace.xs),
                GestureDetector(
                  onTap: onRetry,
                  child: Text(
                    'Not sent · tap to retry',
                    style: GcType.caption.copyWith(color: gc(context).loss, fontSize: 11.5),
                  ),
                ),
              ],
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (turn.text.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.sm, 52, GcSpace.sm),
            child: Text(turn.text, style: GcType.body),
          ),
        for (final slip in turn.slips)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              GcSpace.gutter,
              GcSpace.xs,
              GcSpace.gutter,
              GcSpace.md,
            ),
            child: GcSlipCard(slip: slip),
          ),
      ],
    );
  }
}

class _Thinking extends StatelessWidget {
  const _Thinking();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.sm),
      child: Row(
        children: [
          SizedBox(
            width: 13,
            height: 13,
            child: CircularProgressIndicator(strokeWidth: 1.6, color: gc(context).accent),
          ),
          const SizedBox(width: GcSpace.sm),
          Text('Researching…', style: GcType.caption),
        ],
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({required this.controller, required this.enabled, required this.onSubmit});

  final TextEditingController controller;
  final bool enabled;
  final ValueChanged<String> onSubmit;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.sm, GcSpace.gutter, GcSpace.sm),
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: gc(context).border)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                enabled: enabled,
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.send,
                onSubmitted: onSubmit,
                style: GcType.body.copyWith(fontSize: 14.5),
                cursorColor: gc(context).accent,
                decoration: InputDecoration(
                  isDense: true,
                  hintText: 'Ask for a slip…',
                  hintStyle: GcType.body.copyWith(fontSize: 14.5, color: gc(context).inkFaint),
                  filled: true,
                  fillColor: gc(context).surface,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: GcSpace.md,
                    vertical: GcSpace.md,
                  ),
                  border: _border(gc(context).border),
                  enabledBorder: _border(gc(context).border),
                  focusedBorder: _border(gc(context).borderStrong),
                ),
              ),
            ),
            const SizedBox(width: GcSpace.sm),
            _Send(enabled: enabled, onTap: () => onSubmit(controller.text)),
          ],
        ),
      ),
    );
  }

  OutlineInputBorder _border(Color colour) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(GcRadius.lg),
    borderSide: BorderSide(color: colour),
  );
}

class _Send extends StatelessWidget {
  const _Send({required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Send',
      child: Material(
        color: enabled ? gc(context).accent : gc(context).surfaceRaised,
        borderRadius: BorderRadius.circular(GcRadius.lg),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(GcRadius.lg),
          child: SizedBox(
            width: 46,
            height: 46,
            child: Icon(
              Icons.arrow_upward_rounded,
              size: 20,
              color: enabled ? gc(context).onAccent : gc(context).inkFaint,
            ),
          ),
        ),
      ),
    );
  }
}
