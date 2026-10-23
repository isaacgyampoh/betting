import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/providers.dart';
import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../data/repository.dart';
import 'analyst_controller.dart';

/// Ask about the match you are looking at, without leaving it.
///
/// A sheet rather than a screen, and deliberately: the question is almost always about something
/// on the page behind it - a scoreline, a run of form, a statistic - and pushing a route puts the
/// thing being discussed out of sight. It opens at two thirds and can be dragged to full height.
///
/// The starter questions are built from what this particular fixture actually carries. Offering
/// "what do the stats say" on a competition that reports no statistics teaches people the feature
/// is broken, and that is a worse first impression than a shorter list.
Future<void> showMatchAnalyst(BuildContext context, MatchDetail detail) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    // The keyboard must push the composer, not cover it.
    useSafeArea: true,
    builder: (_) => _AnalystSheet(detail: detail),
  );
}

/// The starter questions this particular fixture can actually answer.
///
/// Public so it can be tested directly: offering "what do the match statistics show" on a
/// competition that reports none teaches people the feature is broken, and that is a worse first
/// impression than a shorter list.
List<String> matchAnalystStarters(MatchDetail detail) {
  final finished = detail.fixture.status == MatchStatus.finished;
  final played = finished || detail.fixture.status == MatchStatus.live;
  return [
    'How have both teams been playing?',
    // The one the data newly supports, and the one that decides most leans.
    'Compare the home side at home with the away side away.',
    if (detail.statistics.length >= 2) 'What do the match statistics show?',
    if (played && detail.events.isNotEmpty) 'What changed after half-time?',
    if (detail.headToHead.isNotEmpty) 'What does their head-to-head suggest?',
    if (!played) 'What are the main risks either way?',
    'What is missing from this picture?',
  ];
}

class _AnalystSheet extends ConsumerStatefulWidget {
  const _AnalystSheet({required this.detail});

  final MatchDetail detail;

  @override
  ConsumerState<_AnalystSheet> createState() => _AnalystSheetState();
}

class _AnalystSheetState extends ConsumerState<_AnalystSheet> {
  final _input = TextEditingController();
  final _scroll = ScrollController();

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _send(String text) {
    final question = text.trim();
    if (question.isEmpty) return;
    _input.clear();
    ref.read(matchAnalystProvider(widget.detail.fixture.id).notifier).ask(question);
    // After the frame the new turn is laid out, so the offset is the real one.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: GcMotion.quick,
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final fixture = widget.detail.fixture;
    final state = ref.watch(matchAnalystProvider(fixture.id));
    final colours = gc(context);

    return DraggableScrollableSheet(
      initialChildSize: 0.72,
      minChildSize: 0.45,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, controller) => Container(
        decoration: BoxDecoration(
          color: colours.canvas,
          border: Border(top: BorderSide(color: colours.border)),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(GcRadius.xl)),
        ),
        child: Column(
          children: [
            _Handle(),
            _Header(fixture: fixture),
            const Divider(height: 1),
            Expanded(
              child: state.turns.isEmpty
                  ? _Starters(detail: widget.detail, onPick: _send, scroll: controller)
                  : ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.symmetric(vertical: GcSpace.sm),
                      itemCount: state.turns.length + (state.sending ? 1 : 0),
                      itemBuilder: (context, i) {
                        if (i == state.turns.length) return const _Thinking();
                        return _Bubble(
                          turn: state.turns[i],
                          onRetry: () =>
                              ref.read(matchAnalystProvider(fixture.id).notifier).retry(),
                        );
                      },
                    ),
            ),
            if (state.error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.sm),
                child: Text(
                  state.error!.message,
                  style: GcType.caption.copyWith(color: colours.loss),
                ),
              ),
            _Composer(
              controller: _input,
              sending: state.sending,
              onSend: () => _send(_input.text),
            ),
          ],
        ),
      ),
    );
  }
}

class _Handle extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: GcSpace.sm, bottom: GcSpace.xs),
    child: Container(
      width: 36,
      height: 4,
      decoration: BoxDecoration(
        color: gc(context).borderStrong,
        borderRadius: BorderRadius.circular(GcRadius.xs),
      ),
    ),
  );
}

/// The sheet's own header, including the follow control for this fixture.
///
/// The control is here because asking about a game and deciding to keep an eye on it are the same
/// moment, and until now that meant closing the sheet to reach the bell behind it.
///
/// It reads and writes the same providers the Following screen does, so there is one source of
/// truth: the state cannot drift between the two, a match cannot be followed twice, and unfollow
/// is the same control pressed again. The write goes to the device first and is pushed to the
/// server after, which is what makes it work with no signal - see `toggleFollowedMatchProvider`.
class _Header extends ConsumerWidget {
  const _Header({required this.fixture});

  final Fixture fixture;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colours = gc(context);
    final following = (ref.watch(followedMatchIdsProvider).value ?? const <int>{}).contains(fixture.id);

    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.xs, GcSpace.sm, GcSpace.md),
      child: Row(
        children: [
          Icon(Icons.insights_rounded, size: 18, color: colours.accent),
          const SizedBox(width: GcSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Match analyst', style: GcType.bodyStrong),
                const SizedBox(height: 1),
                Text(
                  '${fixture.home.name} v ${fixture.away.name}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GcType.caption.copyWith(color: colours.inkMuted),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => ref.read(toggleFollowedMatchProvider)(fixture),
            icon: Icon(
              following ? Icons.notifications_active_rounded : Icons.notifications_none_rounded,
              size: 20,
              color: following ? colours.accent : colours.inkMuted,
            ),
            tooltip: following ? 'Following this match' : 'Follow this match',
          ),
        ],
      ),
    );
  }
}

class _Starters extends StatelessWidget {
  const _Starters({required this.detail, required this.onPick, required this.scroll});

  final MatchDetail detail;
  final ValueChanged<String> onPick;
  final ScrollController scroll;

  @override
  Widget build(BuildContext context) {
    final colours = gc(context);
    return ListView(
      controller: scroll,
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.sm, GcSpace.gutter, GcSpace.lg),
      children: [
        Text(
          'Ask anything about this game. Answers come from the form, statistics and head-to-head '
          'on this page - never from anything invented.',
          style: GcType.caption.copyWith(color: colours.inkMuted, height: 1.5),
        ),
        const SizedBox(height: GcSpace.lg),
        for (final q in matchAnalystStarters(detail))
          Padding(
            padding: const EdgeInsets.only(bottom: GcSpace.sm),
            child: _StarterChip(label: q, onTap: () => onPick(q)),
          ),
      ],
    );
  }
}

class _StarterChip extends StatelessWidget {
  const _StarterChip({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colours = gc(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(GcRadius.md),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.md),
        decoration: BoxDecoration(
          color: colours.surface,
          border: Border.all(color: colours.border),
          borderRadius: BorderRadius.circular(GcRadius.md),
        ),
        child: Row(
          children: [
            Expanded(child: Text(label, style: GcType.body.copyWith(fontSize: 14.5))),
            const SizedBox(width: GcSpace.sm),
            Icon(Icons.arrow_forward_rounded, size: 16, color: colours.inkFaint),
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.turn, required this.onRetry});

  final ChatTurn turn;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colours = gc(context);
    if (turn.isUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.fromLTRB(52, GcSpace.sm, GcSpace.gutter, GcSpace.sm),
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.sm + 2),
          decoration: BoxDecoration(
            color: turn.failed ? colours.surface : colours.accent,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(GcRadius.lg),
              topRight: Radius.circular(GcRadius.lg),
              bottomLeft: Radius.circular(GcRadius.lg),
              bottomRight: Radius.circular(GcRadius.xs),
            ),
            border: turn.failed ? Border.all(color: colours.loss) : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                turn.text,
                style: GcType.body.copyWith(
                  fontSize: 14.5,
                  color: turn.failed ? colours.ink : colours.onAccent,
                ),
              ),
              if (turn.failed) ...[
                const SizedBox(height: GcSpace.xs),
                GestureDetector(
                  onTap: onRetry,
                  child: Text(
                    'Not sent · tap to retry',
                    style: GcType.caption.copyWith(color: colours.loss, fontSize: 11.5),
                  ),
                ),
              ],
            ],
          ),
        ),
      );
    }

    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.sm, 40, GcSpace.sm),
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.sm + 2),
        decoration: BoxDecoration(
          color: colours.surface,
          border: Border.all(color: colours.border),
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(GcRadius.lg),
            topRight: Radius.circular(GcRadius.lg),
            bottomLeft: Radius.circular(GcRadius.xs),
            bottomRight: Radius.circular(GcRadius.lg),
          ),
        ),
        child: SelectableText(
          turn.text,
          style: GcType.body.copyWith(fontSize: 14.5, height: 1.5),
        ),
      ),
    );
  }
}

class _Thinking extends StatelessWidget {
  const _Thinking();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.md, GcSpace.gutter, GcSpace.md),
    child: Row(
      children: [
        SizedBox(
          width: 13,
          height: 13,
          child: CircularProgressIndicator(strokeWidth: 2, color: gc(context).accent),
        ),
        const SizedBox(width: GcSpace.sm),
        Text(
          'Reading the numbers',
          style: GcType.caption.copyWith(color: gc(context).inkMuted),
        ),
      ],
    ),
  );
}

class _Composer extends StatelessWidget {
  const _Composer({required this.controller, required this.sending, required this.onSend});

  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final colours = gc(context);
    return Container(
      padding: EdgeInsets.fromLTRB(
        GcSpace.gutter,
        GcSpace.sm,
        GcSpace.sm,
        GcSpace.sm + MediaQuery.viewInsetsOf(context).bottom,
      ),
      decoration: BoxDecoration(
        color: colours.canvas,
        border: Border(top: BorderSide(color: colours.border)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              enabled: !sending,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => onSend(),
              style: GcType.body.copyWith(fontSize: 14.5),
              decoration: InputDecoration(
                hintText: 'Ask about this match',
                hintStyle: GcType.body.copyWith(fontSize: 14.5, color: colours.inkFaint),
                border: InputBorder.none,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: GcSpace.sm),
              ),
            ),
          ),
          IconButton(
            onPressed: sending ? null : onSend,
            icon: Icon(
              Icons.arrow_upward_rounded,
              color: sending ? colours.inkFaint : colours.accent,
            ),
            tooltip: 'Send',
          ),
        ],
      ),
    );
  }
}
