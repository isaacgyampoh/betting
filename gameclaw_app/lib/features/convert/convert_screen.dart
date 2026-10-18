import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/providers.dart';
import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_input.dart';
import '../../ui/components/gc_sheet.dart';
import '../../ui/components/gc_slip_card.dart';
import '../../ui/components/gc_states.dart';
import 'convert_controller.dart';
import '../share/share_button.dart';

/// Import a booking code from one bookmaker and convert it to another.
///
/// The one rule this screen exists to keep: a conversion is only ever reported as successful when
/// the destination bookmaker actually issued a code. Everything else - a slip that was built but
/// not booked, selections the destination could not price, a market that does not exist there - is
/// shown as what it is. A converted slip is not "the same slip" and is never described as one.
class ConvertScreen extends ConsumerStatefulWidget {
  const ConvertScreen({super.key});

  @override
  ConsumerState<ConvertScreen> createState() => _ConvertScreenState();
}

class _ConvertScreenState extends ConsumerState<ConvertScreen> {
  final _code = TextEditingController();

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim();
    if (text == null || text.isEmpty) return;
    _code.text = text;
    HapticFeedback.selectionClick();
  }

  Future<void> _pickDestination(List<Bookmaker> all, String sourceSlug) async {
    // Only bookmakers that can actually issue a code, and never the one it came from. Offering a
    // destination that cannot book ends in a slip that was built and never booked.
    final targets = [
      for (final b in all)
        if (b.canBook && b.slug != sourceSlug) b,
    ];

    if (targets.isEmpty) {
      if (!mounted) return;
      await showGcSheet<void>(
        context: context,
        title: 'No destination available',
        child: const Padding(
          padding: EdgeInsets.all(GcSpace.gutter),
          child: GcNote(
            'No other connected bookmaker can issue a booking code right now, so there is nowhere '
            'to convert this slip to.',
            icon: Icons.info_outline_rounded,
          ),
        ),
      );
      return;
    }

    final chosen = await showGcSheet<String>(
      context: context,
      title: 'Convert to',
      subtitle: 'Only bookmakers that can issue a booking code',
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: GcSpace.sm),
        children: [
          for (final b in targets)
            InkWell(
              onTap: () => Navigator.of(context).pop(b.slug),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: GcSpace.gutter,
                  vertical: GcSpace.md,
                ),
                child: Row(
                  children: [
                    Expanded(child: Text(b.name, style: GcType.bodyStrong)),
                    Icon(Icons.arrow_forward_rounded, size: 17, color: gc(context).inkFaint),
                  ],
                ),
              ),
            ),
        ],
      ),
    );

    if (chosen != null && mounted) await ref.read(convertProvider.notifier).convert(chosen);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(convertProvider);
    final bookmakers = ref.watch(bookmakersProvider);

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
                  Expanded(child: Text('Convert', style: GcType.display)),
                  if (state.stage != ConvertStage.entry)
                    GcIconButton(
                      icon: Icons.close_rounded,
                      tooltip: 'Start again',
                      onPressed: () {
                        _code.clear();
                        ref.read(convertProvider.notifier).reset();
                      },
                    ),
                ],
              ),
            ),
            Expanded(
              child: switch (state.stage) {
                ConvertStage.entry => _Entry(
                  controller: _code,
                  busy: state.busy,
                  error: state.error,
                  bookmakers: bookmakers,
                  onPaste: _paste,
                  onSubmit: () => ref.read(convertProvider.notifier).load(_code.text),
                  candidates: state.candidates,
                  onPickBookmaker: (slug) =>
                      ref.read(convertProvider.notifier).load(_code.text, bookmaker: slug),
                ),
                ConvertStage.loaded => _Loaded(
                  slip: state.source!,
                  busy: state.busy,
                  error: state.error,
                  onConvert: () => bookmakers.whenData(
                    (all) => _pickDestination(all, state.source!.bookmakerSlug),
                  ),
                ),
                ConvertStage.converted => _Result(
                  source: state.source!,
                  result: state.result!,
                  busy: state.busy,
                  error: state.error,
                  onTryAnother: () => ref.read(convertProvider.notifier).tryAnother(),
                  onBook: () => ref.read(convertProvider.notifier).book(),
                  onRemove: (position) =>
                      ref.read(convertProvider.notifier).removeSelection(position),
                ),
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _Entry extends StatelessWidget {
  const _Entry({
    required this.controller,
    required this.busy,
    required this.error,
    required this.candidates,
    required this.bookmakers,
    required this.onPaste,
    required this.onSubmit,
    required this.onPickBookmaker,
  });

  final TextEditingController controller;
  final bool busy;
  final Object? error;
  final AsyncValue<List<Bookmaker>> bookmakers;
  final VoidCallback onPaste;
  final VoidCallback onSubmit;

  /// Answers "which bookmaker is this code from?" by re-reading it with one named.
  final ValueChanged<String> onPickBookmaker;

  /// The bookmakers the server named as possible sources. Empty unless it asked.
  final List<Bookmaker> candidates;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.sm, GcSpace.gutter, GcSpace.xl),
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
            child: Icon(Icons.swap_horiz_rounded, size: 22, color: gc(context).accentInk),
          ),
        ),
        const SizedBox(height: GcSpace.lg),
        Text('Move a slip between bookmakers', style: GcType.title),
        const SizedBox(height: GcSpace.sm),
        Text(
          'Paste a booking code. We read the original slip, then try to find the same games and '
          'markets on another bookmaker.',
          style: GcType.body.copyWith(color: gc(context).inkMuted),
        ),
        const SizedBox(height: GcSpace.xl),
        GcTextField(
          controller: controller,
          label: 'Booking code',
          icon: Icons.confirmation_number_outlined,
          textInputAction: TextInputAction.go,
          onSubmitted: (_) => onSubmit(),
          enabled: !busy,
        ),
        const SizedBox(height: GcSpace.sm),
        Row(
          children: [
            Expanded(
              child: GcButton(
                label: 'Paste',
                kind: GcButtonKind.secondary,
                icon: Icons.content_paste_rounded,
                onPressed: busy ? null : onPaste,
              ),
            ),
            const SizedBox(width: GcSpace.sm),
            Expanded(
              child: GcButton(label: 'Read slip', onPressed: busy ? null : onSubmit),
            ),
          ],
        ),
        if (error != null) ...[
          const SizedBox(height: GcSpace.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.error_outline_rounded, size: 15, color: gc(context).loss),
              const SizedBox(width: GcSpace.sm),
              Expanded(
                child: Text('$error', style: GcType.caption.copyWith(color: gc(context).loss)),
              ),
            ],
          ),
          // SportyBet and Football.com share a coupon namespace, so a code valid on both comes
          // back as a question. Asking it without offering the answer is worse than not asking:
          // the user has no way to say which bookmaker theirs came from.
          if (candidates.isNotEmpty) ...[
            const SizedBox(height: GcSpace.md),
            Wrap(
              spacing: GcSpace.sm,
              runSpacing: GcSpace.sm,
              children: [
                for (final b in candidates)
                  GcButton(
                    label: b.name,
                    kind: GcButtonKind.secondary,
                    size: GcButtonSize.small,
                    expand: false,
                    onPressed: busy ? null : () => onPickBookmaker(b.slug),
                  ),
              ],
            ),
          ],
        ],
        const SizedBox(height: GcSpace.xl),
        // What is genuinely connected, read from the server rather than listed hopefully. A
        // bookmaker with no authorised integration is named as unsupported instead of being left
        // off, so a user who has a code for one knows why it will not work.
        bookmakers.when(
          loading: () => const SizedBox.shrink(),
          error: (e, _) => GcNote('$e'),
          data: (all) => _Support(all: all),
        ),
      ],
    );
  }
}

class _Support extends StatelessWidget {
  const _Support({required this.all});

  final List<Bookmaker> all;

  @override
  Widget build(BuildContext context) {
    final readable = all.where((b) => b.canLoad).toList();
    final bookable = all.where((b) => b.canBook).toList();
    // Grouped by what a user can actually expect, not by a boolean. "It does not work" covers
    // four situations and only one of them is ours to fix; lumping them together tells somebody
    // holding a perfectly valid code to go hunting for a problem at their end.
    final byStatus = <BookmakerStatus, List<Bookmaker>>{
      for (final s in BookmakerStatus.values)
        s: all.where((b) => b.status == s).toList(growable: false),
    };

    Widget line(String label, List<Bookmaker> list, String whenEmpty) => Padding(
      padding: const EdgeInsets.only(bottom: GcSpace.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(label, style: GcType.caption.copyWith(color: gc(context).inkFaint)),
          ),
          Expanded(
            child: Text(
              list.isEmpty ? whenEmpty : list.map((b) => b.name).join(', '),
              style: GcType.caption,
            ),
          ),
        ],
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('WHAT IS CONNECTED', style: GcType.overline.copyWith(color: gc(context).inkFaint)),
        const SizedBox(height: GcSpace.md),
        line('Can read', readable, 'none right now'),
        line('Can issue', bookable, 'none right now'),
        const SizedBox(height: GcSpace.md),
        for (final status in BookmakerStatus.values)
          if ((byStatus[status] ?? const []).isNotEmpty) ...[
            line(status.label, byStatus[status]!, ''),
          ],
        const SizedBox(height: GcSpace.sm),
        // Each state gets its own sentence. The differences matter to somebody holding a code
        // that works perfectly well at the bookmaker that issued it.
        for (final b in all.where((b) => b.statusNote != null)) ...[
          const SizedBox(height: GcSpace.xs),
          Text(
            '${b.name}: ${b.statusNote}',
            style: GcType.caption.copyWith(fontSize: 11.5, color: gc(context).inkFaint),
          ),
        ],
        if ((byStatus[BookmakerStatus.unsupported] ?? const []).isNotEmpty) ...[
          const SizedBox(height: GcSpace.xs),
          Text(
            'A bookmaker under "Not yet supported" has no authorised booking-code integration we '
            'have found, so a code from it cannot be read here.',
            style: GcType.caption.copyWith(fontSize: 11.5, color: gc(context).inkFaint),
          ),
        ],
      ],
    );
  }
}

class _Loaded extends StatelessWidget {
  const _Loaded({
    required this.slip,
    required this.busy,
    required this.error,
    required this.onConvert,
  });

  final Slip slip;
  final bool busy;
  final Object? error;
  final VoidCallback onConvert;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.lg),
            children: [
              Text('SOURCE SLIP', style: GcType.overline.copyWith(color: gc(context).inkFaint)),
              const SizedBox(height: GcSpace.md),
              GcSlipCard(slip: slip, onShare: () => shareSlip(context, slip)),
              if (error != null) ...[
                const SizedBox(height: GcSpace.md),
                Text('$error', style: GcType.caption.copyWith(color: gc(context).loss)),
              ],
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.md),
            child: GcButton(
              label: 'Convert to another bookmaker',
              size: GcButtonSize.large,
              icon: Icons.swap_horiz_rounded,
              onPressed: busy ? null : onConvert,
            ),
          ),
        ),
      ],
    );
  }
}

/// The outcome, stated precisely.
class _Result extends StatelessWidget {
  const _Result({
    required this.source,
    required this.result,
    required this.busy,
    required this.error,
    required this.onTryAnother,
    required this.onBook,
    required this.onRemove,
  });

  final Slip source;
  final Slip result;
  final bool busy;
  final Object? error;
  final VoidCallback onTryAnother;
  final Future<void> Function() onBook;
  final Future<void> Function(int position) onRemove;

  @override
  Widget build(BuildContext context) {
    final booked = result.code != null;
    final carried = result.selections.where((s) => s.status.isOk).length;

    // Against what this slip still holds, not against the slip that was pasted. Subtracting from
    // the source counted a selection the user removed themselves as one the bookmaker could not
    // carry - "3 of 4 carried across, 1 could not be" after they had deliberately dropped the
    // fourth. Blaming the conversion for the user's own edit is both wrong and alarming.
    final lost = result.selections.length - carried;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.lg),
            children: [
              // The headline is the truth of it. A slip that was built but not booked is not a
              // successful conversion, and saying so here is the whole point of the screen.
              // Only once a booking has actually been attempted. A draft has not failed to get a
              // code - it has not asked for one yet, and the card below says so and offers the
              // button. Showing "the destination issued no booking code" over a draft reports a
              // failure that never happened.
              if (booked)
                Container(
                  padding: const EdgeInsets.all(GcSpace.md),
                  decoration: BoxDecoration(
                    color: (booked ? gc(context).win : gc(context).warn).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(GcRadius.md),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        booked ? Icons.check_circle_outline_rounded : Icons.error_outline_rounded,
                        size: 17,
                        color: booked ? gc(context).win : gc(context).warn,
                      ),
                      const SizedBox(width: GcSpace.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              booked
                                  ? 'Booked on ${result.bookmakerName}'
                                  : 'Not booked on ${result.bookmakerName}',
                              style: GcType.label.copyWith(
                                color: booked ? gc(context).win : gc(context).warn,
                              ),
                            ),
                            const SizedBox(height: GcSpace.xxs),
                            Text(
                              booked
                                  ? '$carried of ${result.selections.length} selections carried across.'
                                        '${lost > 0 ? ' $lost could not be.' : ''}'
                                  : 'The destination issued no booking code, so there is nothing to '
                                        'enter at the counter.',
                              style: GcType.caption,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              if (lost > 0) ...[
                const SizedBox(height: GcSpace.md),
                const GcNote(
                  'The odds and markets below are the destination bookmaker’s own. Where a '
                  'market differs, this is not the same slip.',
                  icon: Icons.info_outline_rounded,
                ),
              ],
              const SizedBox(height: GcSpace.lg),
              Text(
                'FROM ${source.bookmakerName.toUpperCase()}'
                '${source.code == null ? '' : ' · ${source.code}'}',
                style: GcType.overline.copyWith(color: gc(context).inkFaint),
              ),
              const SizedBox(height: GcSpace.md),
              // Editable only while it is still a draft. Once the bookmaker has issued a code,
              // the code is those selections - changing the list underneath it would make the
              // card describe something the code does not say.
              GcSlipCard(
                slip: result,
                busy: busy,
                onBook: result.code == null ? onBook : null,
                onRemove: result.code == null ? onRemove : null,
                onShare: () => shareSlip(context, result),
              ),
              if (error != null) ...[
                const SizedBox(height: GcSpace.md),
                Text('$error', style: GcType.caption.copyWith(color: gc(context).loss)),
              ],
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.md),
            child: GcButton(
              label: 'Try another bookmaker',
              kind: GcButtonKind.secondary,
              onPressed: onTryAnother,
            ),
          ),
        ),
      ],
    );
  }
}
