import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/providers.dart';
import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_input.dart';
import '../../ui/components/gc_slip_card.dart';
import '../../ui/components/gc_states.dart';
import '../share/share_button.dart';
import 'merge_controller.dart';

/// Building one slip out of several.
///
/// The screen is a list of source slips with their legs, then what the combination comes to. It
/// shows each source separately rather than pooling the legs immediately, because which bookmaker
/// a leg came from is the thing the user is reasoning about - pooling first would make them work
/// out again what they already knew when they pasted each code.
///
/// What it deliberately does not show is a total price for the combined legs before a destination
/// has priced them. The odds on a source slip belong to the bookmaker that issued it; multiplying
/// them together produces a number that looks authoritative and is not what anyone would be paid.
class MergeScreen extends ConsumerStatefulWidget {
  const MergeScreen({super.key});

  @override
  ConsumerState<MergeScreen> createState() => _MergeScreenState();
}

class _MergeScreenState extends ConsumerState<MergeScreen> {
  final _code = TextEditingController();

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final code = _code.text.trim();
    if (code.isEmpty) return;
    await ref.read(mergeProvider.notifier).addCode(code);
    if (mounted && ref.read(mergeProvider).error == null) _code.clear();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(mergeProvider);
    final bookmakers = ref.watch(bookmakersProvider).value ?? const <Bookmaker>[];
    final destinations = bookmakers.where((b) => b.canBook).toList(growable: false);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Merge slips'),
        actions: [
          if (state.sources.isNotEmpty)
            TextButton(
              onPressed: state.busy ? null : () => ref.read(mergeProvider.notifier).reset(),
              child: const Text('Clear'),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.md, GcSpace.gutter, GcSpace.xxxl),
        children: [
          _AddSlip(controller: _code, busy: state.busy, onAdd: _add),
          if (state.error != null) ...[
            const SizedBox(height: GcSpace.md),
            Text(
              state.error!.message,
              style: GcType.caption.copyWith(color: gc(context).loss),
            ),
            // One refusal is a question - a code valid at more than one bookmaker - and it comes
            // with the candidates. Showing them turns an error the user cannot act on into the
            // one tap that answers it.
            if (state.candidates.isNotEmpty) ...[
              const SizedBox(height: GcSpace.sm),
              for (final b in state.candidates)
                Padding(
                  padding: const EdgeInsets.only(bottom: GcSpace.sm),
                  child: GcButton(
                    label: b.name,
                    kind: GcButtonKind.secondary,
                    size: GcButtonSize.small,
                    onPressed: state.busy
                        ? null
                        : () => ref.read(mergeProvider.notifier).addFrom(b.slug),
                  ),
                ),
            ],
          ],

          if (state.sources.isEmpty) ...[
            const SizedBox(height: GcSpace.xl),
            const GcNote(
              'Paste a booking code from one bookmaker, then another from a different one. '
              'Pick the games you want from each and GameClaw books the combination at a '
              'bookmaker that can take it.',
              icon: Icons.merge_rounded,
            ),
          ],

          for (final slip in state.sources) ...[
            const SizedBox(height: GcSpace.lg),
            _SourceSlip(
              slip: slip,
              state: state,
              onToggle: (position) =>
                  ref.read(mergeProvider.notifier).toggle(slip.id, position),
              onRemove: () => ref.read(mergeProvider.notifier).removeSlip(slip.id),
            ),
          ],

          if (state.sources.isNotEmpty) ...[
            const SizedBox(height: GcSpace.xl),
            _Combined(state: state, destinations: destinations),
          ],

          if (state.duplicates.isNotEmpty) ...[
            const SizedBox(height: GcSpace.md),
            _Duplicates(duplicates: state.duplicates),
          ],

          if (state.result != null) ...[
            const SizedBox(height: GcSpace.lg),
            Text('MERGED SLIP', style: GcType.overline.copyWith(color: gc(context).inkFaint)),
            const SizedBox(height: GcSpace.md),
            GcSlipCard(
              slip: state.result!,
              busy: state.busy,
              onBook: state.result!.code == null
                  ? () => ref.read(mergeProvider.notifier).book()
                  : null,
              onShare: () => shareSlip(context, state.result!),
            ),
          ],
        ],
      ),
    );
  }
}

class _AddSlip extends StatelessWidget {
  const _AddSlip({required this.controller, required this.busy, required this.onAdd});

  final TextEditingController controller;
  final bool busy;
  final Future<void> Function() onAdd;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        GcTextField(
          controller: controller,
          label: 'Booking code',
          icon: Icons.confirmation_number_outlined,
          textInputAction: TextInputAction.go,
          onSubmitted: (_) => onAdd(),
          enabled: !busy,
        ),
        const SizedBox(height: GcSpace.sm),
        Row(
          children: [
            Expanded(
              child: GcButton(
                label: 'Paste',
                icon: Icons.content_paste_rounded,
                kind: GcButtonKind.secondary,
                onPressed: busy
                    ? null
                    : () async {
                        final data = await Clipboard.getData(Clipboard.kTextPlain);
                        final text = data?.text?.trim();
                        if (text != null && text.isNotEmpty) controller.text = text.toUpperCase();
                      },
              ),
            ),
            const SizedBox(width: GcSpace.sm),
            Expanded(
              child: GcButton(label: 'Add slip', onPressed: busy ? null : onAdd),
            ),
          ],
        ),
      ],
    );
  }
}

/// One source slip, with a tick against every leg.
class _SourceSlip extends StatelessWidget {
  const _SourceSlip({
    required this.slip,
    required this.state,
    required this.onToggle,
    required this.onRemove,
  });

  final Slip slip;
  final MergeState state;
  final void Function(int position) onToggle;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final chosen = slip.selections.where((s) => state.isPicked(slip.id, s.position)).length;

    return Container(
      decoration: BoxDecoration(
        color: gc(context).surface,
        borderRadius: BorderRadius.circular(GcRadius.lg),
        border: Border.all(color: gc(context).border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.md, GcSpace.md, GcSpace.xs, GcSpace.sm),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        slip.bookmakerName,
                        style: GcType.heading,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: GcSpace.xxs),
                      Text(
                        '${slip.code ?? "no code"} · $chosen of ${slip.selections.length} chosen',
                        style: GcType.caption.copyWith(fontSize: 11.5),
                      ),
                    ],
                  ),
                ),
                GcIconButton(
                  icon: Icons.close_rounded,
                  tooltip: 'Remove this slip',
                  onPressed: onRemove,
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          for (final (i, sel) in slip.selections.indexed) ...[
            if (i > 0) const Divider(height: 1, indent: GcSpace.md, endIndent: GcSpace.md),
            _Leg(
              selection: sel,
              picked: state.isPicked(slip.id, sel.position),
              // A leg the source bookmaker could not carry cannot be merged either: there is no
              // market behind it to find at a destination.
              onToggle: sel.status.isOk ? () => onToggle(sel.position) : null,
            ),
          ],
        ],
      ),
    );
  }
}

class _Leg extends StatelessWidget {
  const _Leg({required this.selection, required this.picked, this.onToggle});

  final Selection selection;
  final bool picked;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final enabled = onToggle != null;
    return InkWell(
      onTap: onToggle,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              value: picked && enabled,
              onChanged: enabled ? (_) => onToggle!() : null,
              visualDensity: VisualDensity.compact,
            ),
            const SizedBox(width: GcSpace.xs),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${selection.home} v ${selection.away}',
                    style: GcType.bodyStrong.copyWith(
                      color: enabled ? gc(context).ink : gc(context).inkFaint,
                    ),
                  ),
                  const SizedBox(height: GcSpace.xxs),
                  Text(
                    enabled
                        ? '${selection.marketLabel} · ${selection.pickLabel}'
                        : '${selection.pickLabel} — ${selection.status.reason}',
                    style: GcType.caption.copyWith(
                      fontSize: 12,
                      color: enabled ? gc(context).inkMuted : gc(context).warn,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: GcSpace.sm),
            Text(
              selection.odds == null ? '—' : selection.odds!.toStringAsFixed(2),
              style: GcType.label.copyWith(
                color: enabled ? gc(context).ink : gc(context).inkFaint,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// What the chosen legs come to, and where they can go.
class _Combined extends StatelessWidget {
  const _Combined({required this.state, required this.destinations});

  final MergeState state;
  final List<Bookmaker> destinations;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(GcSpace.md),
      decoration: BoxDecoration(
        color: gc(context).surfaceRaised,
        borderRadius: BorderRadius.circular(GcRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${state.chosen} '
                  '${state.chosen == 1 ? "selection" : "selections"} '
                  'from ${state.contributingSlips} '
                  '${state.contributingSlips == 1 ? "slip" : "slips"}',
                  style: GcType.bodyStrong,
                ),
              ),
            ],
          ),
          const SizedBox(height: GcSpace.xs),
          Text(
            // No combined price here, deliberately. Each source slip's odds are the price its own
            // bookmaker offered; the destination will have its own, and it is the only one that
            // can be paid out. Multiplying the sources together would look authoritative and be
            // nobody's actual price.
            state.canMerge
                ? 'The destination will price these itself. Its total appears once it has.'
                : 'Choose at least two selections from two different slips.',
            style: GcType.caption.copyWith(fontSize: 12),
          ),
          if (destinations.isNotEmpty) ...[
            const SizedBox(height: GcSpace.md),
            Text('BOOK AT', style: GcType.overline.copyWith(color: gc(context).inkFaint, fontSize: 9.5)),
            const SizedBox(height: GcSpace.sm),
            for (final b in destinations) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: GcSpace.sm),
                child: GcButton(
                  label: b.name,
                  kind: GcButtonKind.secondary,
                  size: GcButtonSize.small,
                  onPressed: state.canMerge
                      ? () => ProviderScope.containerOf(context)
                            .read(mergeProvider.notifier)
                            .merge(b.slug)
                      : null,
                ),
              ),
            ],
          ] else
            Padding(
              padding: const EdgeInsets.only(top: GcSpace.md),
              child: Text(
                'No bookmaker can issue a code right now, so a merge cannot be booked.',
                style: GcType.caption.copyWith(color: gc(context).warn, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}

/// Chosen legs that turned out to be the same bet.
class _Duplicates extends StatelessWidget {
  const _Duplicates({required this.duplicates});

  final List<MergeDuplicate> duplicates;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(GcSpace.md),
      decoration: BoxDecoration(
        color: gc(context).warn.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(GcRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            duplicates.length == 1
                ? 'One selection appeared on more than one slip'
                : '${duplicates.length} selections appeared on more than one slip',
            style: GcType.label.copyWith(color: gc(context).warn),
          ),
          const SizedBox(height: GcSpace.xs),
          Text(
            // Said plainly because the user's leg count changed under them, and a count that
            // changes without explanation reads as the app losing their work.
            'A bookmaker will not take the same bet twice, so each is on the merged slip once.',
            style: GcType.caption.copyWith(fontSize: 12),
          ),
          for (final d in duplicates) ...[
            const SizedBox(height: GcSpace.sm),
            Text('${d.fixture} — ${d.market} (×${d.count})',
                style: GcType.caption.copyWith(fontSize: 11.5)),
          ],
        ],
      ),
    );
  }
}
