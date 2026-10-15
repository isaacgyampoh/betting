import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/repository.dart';
import '../../domain/models.dart';
import '../../theme/tokens.dart';
import '../../ui/section.dart';
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
    _composer.clear();
    await ref.read(chatProvider.notifier).send(text);
    _toBottom();
  }

  /// After a frame, so the new turn has been laid out and its height is known.
  void _toBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Claw'),
        actions: [
          if (chat.turns.isNotEmpty)
            IconButton(
              tooltip: 'New conversation',
              onPressed: () => ref.read(chatProvider.notifier).clear(),
              icon: const Icon(Icons.add_comment_outlined),
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: chat.turns.isEmpty
                ? const _Intro()
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.symmetric(vertical: GcSpace.lg),
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
              padding: const EdgeInsets.fromLTRB(GcSpace.lg, 0, GcSpace.lg, GcSpace.sm),
              child: Text(chat.error!.message, style: GcType.caption.copyWith(color: GcColors.loss)),
            ),
          if (chat.quickReplies.isNotEmpty && !chat.sending)
            _QuickReplies(replies: chat.quickReplies, onTap: _send),
          _Composer(
            controller: _composer,
            enabled: !chat.sending,
            onSubmit: _send,
            allowance: chat.allowance,
          ),
        ],
      ),
    );
  }
}

class _Intro extends StatelessWidget {
  const _Intro();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(GcSpace.lg),
      children: [
        const SizedBox(height: GcSpace.xxl),
        Text('Ask for a slip', style: GcType.title),
        const SizedBox(height: GcSpace.sm),
        const Text(
          'Describe what you want and Claw builds it from real fixtures and real prices, '
          'with the reason for every pick. It will tell you when it cannot find one.',
          style: GcType.body,
        ),
        const SizedBox(height: GcSpace.xl),
        for (final example in const [
          'Build me a 5 odds slip for tonight',
          'Three games from the Premier League, nothing riskier than 1.60',
          'Convert this booking code to another bookmaker',
        ])
          Padding(
            padding: const EdgeInsets.only(bottom: GcSpace.sm),
            child: Text('· $example', style: GcType.caption),
          ),
        const SizedBox(height: GcSpace.xl),
        const GcNote(
          'Estimated chances, not certainties. Prices move, and a slip that was available a minute '
          'ago may not be now.',
        ),
      ],
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
          margin: const EdgeInsets.fromLTRB(48, GcSpace.xs, GcSpace.lg, GcSpace.xs),
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.sm),
          decoration: BoxDecoration(
            color: turn.failed ? GcColors.surface : GcColors.accent,
            borderRadius: BorderRadius.circular(GcRadius.lg),
            border: turn.failed ? Border.all(color: GcColors.loss) : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                turn.text,
                style: GcType.body.copyWith(color: turn.failed ? GcColors.ink : GcColors.onAccent),
              ),
              if (turn.failed) ...[
                const SizedBox(height: GcSpace.xs),
                GestureDetector(
                  onTap: onRetry,
                  child: Text(
                    'Not sent · tap to retry',
                    style: GcType.caption.copyWith(color: GcColors.loss),
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
        Padding(
          padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.sm, 48, GcSpace.sm),
          child: Text(turn.text, style: GcType.body),
        ),
        for (final slip in turn.slips)
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.lg, 0, GcSpace.lg, GcSpace.md),
            child: GcSlipCard(slip: slip),
          ),
      ],
    );
  }
}

/// A built slip, with its booking code.
class GcSlipCard extends StatelessWidget {
  const GcSlipCard({super.key, required this.slip});

  final Slip slip;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: GcColors.surface,
        borderRadius: BorderRadius.circular(GcRadius.lg),
        border: Border.all(color: GcColors.border),
      ),
      padding: const EdgeInsets.all(GcSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(slip.bookmakerName, style: GcType.heading)),
              if (slip.totalOdds != null)
                Text(slip.totalOdds!.toStringAsFixed(2), style: GcType.figure.copyWith(fontSize: 16)),
            ],
          ),
          const SizedBox(height: GcSpace.sm),

          // A sample-adapter code looks exactly like a real one, so it has to be labelled. Letting
          // someone take it to a betting shop would be the worst thing this screen could do.
          if (slip.demo)
            const Padding(
              padding: EdgeInsets.only(bottom: GcSpace.sm),
              child: GcNote('Sample data: this code will not work on the bookmaker’s site.'),
            ),

          if (slip.code != null)
            _Code(code: slip.code!)
          else
            Text(
              'Built, not booked. No code was issued for this slip.',
              style: GcType.caption,
            ),

          const SizedBox(height: GcSpace.sm),
          for (final selection in slip.selections) _SelectionRow(selection: selection),

          for (final warning in slip.warnings)
            Padding(
              padding: const EdgeInsets.only(top: GcSpace.sm),
              child: Text(warning.message, style: GcType.caption.copyWith(color: GcColors.warn)),
            ),
        ],
      ),
    );
  }
}

class _Code extends StatelessWidget {
  const _Code({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        Clipboard.setData(ClipboardData(text: code));
        ScaffoldMessenger.of(context)
          ..clearSnackBars()
          ..showSnackBar(const SnackBar(content: Text('Booking code copied')));
      },
      borderRadius: BorderRadius.circular(GcRadius.md),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.sm),
        decoration: BoxDecoration(
          color: GcColors.surfaceRaised,
          borderRadius: BorderRadius.circular(GcRadius.md),
          border: Border.all(color: GcColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(code, style: GcType.figure.copyWith(fontSize: 16, letterSpacing: 1.2)),
            ),
            const Icon(Icons.copy_rounded, size: 16, color: GcColors.inkMuted),
          ],
        ),
      ),
    );
  }
}

class _SelectionRow extends StatelessWidget {
  const _SelectionRow({required this.selection});

  final Selection selection;

  @override
  Widget build(BuildContext context) {
    final ok = selection.status.isOk;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: GcSpace.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${selection.home} v ${selection.away}',
                  style: GcType.label.copyWith(color: ok ? GcColors.ink : GcColors.inkMuted),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(
                // An unpriced pick has no price. Never a zero, which would read as odds.
                selection.odds?.toStringAsFixed(2) ?? '–',
                style: GcType.figure.copyWith(fontSize: 13, color: GcColors.inkMuted),
              ),
            ],
          ),
          Text(
            '${selection.marketLabel}: ${selection.pickLabel}',
            style: GcType.caption.copyWith(color: ok ? GcColors.inkMuted : GcColors.inkFaint),
          ),
          if (!ok)
            Text(selection.status.reason, style: GcType.caption.copyWith(color: GcColors.warn)),
          if (selection.reason != null && selection.reason!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(selection.reason!, style: GcType.caption),
            ),
        ],
      ),
    );
  }
}

class _Thinking extends StatelessWidget {
  const _Thinking();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.fromLTRB(GcSpace.lg, 0, GcSpace.lg, GcSpace.sm),
      child: Row(
        children: [
          SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 1.5)),
          SizedBox(width: GcSpace.sm),
          Text('Researching…', style: GcType.caption),
        ],
      ),
    );
  }
}

class _QuickReplies extends StatelessWidget {
  const _QuickReplies({required this.replies, required this.onTap});

  final List<QuickReply> replies;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.lg),
        itemCount: replies.length,
        separatorBuilder: (_, __) => const SizedBox(width: GcSpace.sm),
        itemBuilder: (context, i) => ActionChip(
          label: Text(replies[i].label, style: GcType.caption),
          backgroundColor: GcColors.surface,
          side: const BorderSide(color: GcColors.border),
          onPressed: () => onTap(replies[i].message),
        ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.enabled,
    required this.onSubmit,
    required this.allowance,
  });

  final TextEditingController controller;
  final bool enabled;
  final ValueChanged<String> onSubmit;
  final AiAllowance? allowance;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Column(
        children: [
          if (allowance != null)
            Padding(
              padding: const EdgeInsets.only(bottom: GcSpace.xs),
              child: Text(
                allowance!.kind == 'trial'
                    ? '${allowance!.remaining} free messages left'
                    : '${allowance!.remaining} messages left today',
                style: GcType.caption.copyWith(color: GcColors.inkFaint),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.lg, 0, GcSpace.lg, GcSpace.sm),
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
                    style: GcType.body,
                    decoration: InputDecoration(
                      hintText: 'Ask for a slip…',
                      hintStyle: GcType.body.copyWith(color: GcColors.inkFaint),
                      filled: true,
                      fillColor: GcColors.surface,
                      contentPadding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.md),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(GcRadius.lg),
                        borderSide: const BorderSide(color: GcColors.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(GcRadius.lg),
                        borderSide: const BorderSide(color: GcColors.border),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: GcSpace.sm),
                IconButton.filled(
                  onPressed: enabled ? () => onSubmit(controller.text) : null,
                  icon: const Icon(Icons.arrow_upward_rounded),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
