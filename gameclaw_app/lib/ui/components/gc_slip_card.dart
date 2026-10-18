import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'gc_button.dart';
import 'gc_chip.dart';
import 'gc_states.dart';

/// A built slip, and its booking code if the bookmaker issued one.
///
/// Three rules are visible in here and all three are deliberate:
///
/// 1. A code is only ever shown when the server returned one. "Built, not booked" is a real state
///    and it is said plainly - an empty code box looks like a rendering failure, and a made-up one
///    would send someone to a betting shop with a number that does nothing.
/// 2. A sample-adapter code looks exactly like a real one, so it is labelled before anything else
///    on the card.
/// 3. A selection the bookmaker could not carry stays on the slip, marked, rather than vanishing.
///    A slip that quietly loses two legs between being read and being booked is worse than one
///    that says what it could not take across.
class GcSlipCard extends StatelessWidget {
  const GcSlipCard({
    super.key,
    required this.slip,
    this.onBook,
    this.onRemove,
    this.onShare,
    this.busy = false,
  });

  final Slip slip;

  /// Asks the bookmaker to issue a code for this draft. Absent where booking makes no sense -
  /// a slip read from a code already has one.
  final Future<void> Function()? onBook;

  /// Removes one selection, by its own position number.
  final Future<void> Function(int position)? onRemove;

  /// Sends the slip out of the app as a branded picture. Absent where there is nothing worth
  /// sending - a draft with no code is a working note, not something to forward.
  final Future<void> Function()? onShare;

  /// A request is in flight; actions are disabled rather than re-entrant.
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final unsupported = slip.selections.where((s) => !s.status.isOk).length;
    final carryable = slip.selections.length - unsupported;

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
            padding: const EdgeInsets.fromLTRB(GcSpace.md, GcSpace.md, GcSpace.md, GcSpace.sm),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'DESTINATION',
                        style: GcType.overline.copyWith(fontSize: 9, color: gc(context).inkFaint),
                      ),
                      const SizedBox(height: GcSpace.xxs),
                      Text(
                        slip.bookmakerName,
                        style: GcType.heading,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                if (slip.totalOdds != null)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        'TOTAL ODDS',
                        style: GcType.overline.copyWith(fontSize: 9, color: gc(context).inkFaint),
                      ),
                      const SizedBox(height: GcSpace.xxs),
                      Text(
                        slip.totalOdds!.toStringAsFixed(2),
                        style: GcType.title.copyWith(
                          color: gc(context).accentInk,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),

          if (slip.demo)
            Padding(
              padding: const EdgeInsets.fromLTRB(GcSpace.md, 0, GcSpace.md, GcSpace.sm),
              child: Container(
                padding: const EdgeInsets.all(GcSpace.sm + 2),
                decoration: BoxDecoration(
                  color: gc(context).warn.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(GcRadius.sm),
                ),
                child: Row(
                  children: [
                    Icon(Icons.science_outlined, size: 14, color: gc(context).warn),
                    const SizedBox(width: GcSpace.sm),
                    Expanded(
                      child: Text(
                        'Sample data — this code will not work on the bookmaker’s site.',
                        style: GcType.caption.copyWith(color: gc(context).warn, fontSize: 11.5),
                      ),
                    ),
                  ],
                ),
              ),
            ),

          Padding(
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.md),
            child: slip.code != null
                ? _Code(code: slip.code!, expiresAt: slip.expiresAtUtc)
                // A draft is a real, useful state and is named as one. The expensive half has
                // already happened - every game found at this bookmaker and priced - and what is
                // left is one write the bookmaker can refuse. Saying "no code" and stopping would
                // throw that away and read like a failure.
                : onBook != null
                ? _Draft(
                    carryable: carryable,
                    total: slip.selections.length,
                    bookmaker: slip.bookmakerName,
                    busy: busy,
                    onBook: onBook!,
                  )
                : const GcNote(
                    'Built, but not booked. The bookmaker issued no code for this slip.',
                    icon: Icons.info_outline_rounded,
                  ),
          ),

          if (onShare != null) ...[
            const SizedBox(height: GcSpace.md),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: GcSpace.md),
              child: GcButton(
                label: 'Share slip',
                icon: Icons.ios_share_rounded,
                kind: GcButtonKind.secondary,
                size: GcButtonSize.small,
                onPressed: busy ? null : onShare,
              ),
            ),
          ],

          const SizedBox(height: GcSpace.md),
          const Divider(height: 1),

          for (final (i, selection) in slip.selections.indexed) ...[
            if (i > 0) const Divider(height: 1, indent: GcSpace.md, endIndent: GcSpace.md),
            _SelectionRow(
              selection: selection,
              // Three conditions, and the first is the one that matters: a slip the bookmaker
              // has issued a code for is not editable, because the code *is* those selections and
              // changing the list underneath it would make this card describe something the code
              // does not say. Enforced here rather than only at the call site, so a future screen
              // cannot get it wrong. Removing the last leg is a delete by another name.
              onRemove: onRemove == null || busy || slip.code != null || slip.selections.length < 2
                  ? null
                  : () => onRemove!(selection.position),
            ),
          ],

          if (unsupported > 0 || slip.warnings.isNotEmpty)
            Container(
              color: gc(context).surfaceRaised,
              padding: const EdgeInsets.all(GcSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (unsupported > 0)
                    Text(
                      '$unsupported of ${slip.selections.length} could not be carried across.',
                      style: GcType.caption.copyWith(color: gc(context).warn),
                    ),
                  for (final warning in slip.warnings)
                    Padding(
                      padding: const EdgeInsets.only(top: GcSpace.xs),
                      child: Text(
                        warning.message,
                        style: GcType.caption.copyWith(color: gc(context).warn),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Code extends StatelessWidget {
  const _Code({required this.code, required this.expiresAt});

  final String code;
  final DateTime? expiresAt;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Booking code $code, tap to copy',
      excludeSemantics: true,
      child: InkWell(
        onTap: () {
          HapticFeedback.mediumImpact();
          Clipboard.setData(ClipboardData(text: code));
          ScaffoldMessenger.of(context)
            ..clearSnackBars()
            ..showSnackBar(
              SnackBar(
                content: Row(
                  children: [
                    Icon(Icons.check_rounded, size: 16, color: gc(context).accentInk),
                    const SizedBox(width: GcSpace.sm),
                    Text(
                      'Booking code copied',
                      style: GcType.label.copyWith(color: gc(context).ink),
                    ),
                  ],
                ),
                duration: const Duration(seconds: 2),
              ),
            );
        },
        borderRadius: BorderRadius.circular(GcRadius.md),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.md),
          decoration: BoxDecoration(
            color: gc(context).surfaceRaised,
            borderRadius: BorderRadius.circular(GcRadius.md),
            border: Border.all(color: gc(context).borderStrong),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      code,
                      style: GcType.title.copyWith(
                        letterSpacing: 2,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    if (expiresAt != null) ...[
                      const SizedBox(height: GcSpace.xxs),
                      Text(
                        'Expires ${DateFormat('d MMM, HH:mm').format(expiresAt!.toLocal())}',
                        style: GcType.caption.copyWith(fontSize: 11, color: gc(context).inkFaint),
                      ),
                    ],
                  ],
                ),
              ),
              Icon(Icons.copy_rounded, size: 17, color: gc(context).inkMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _SelectionRow extends StatelessWidget {
  const _SelectionRow({required this.selection, this.onRemove});

  final Selection selection;

  /// Null where the slip is not editable, or where this is the last remaining selection.
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final ok = selection.status.isOk;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  '${selection.home} v ${selection.away}',
                  style: GcType.label.copyWith(color: ok ? gc(context).ink : gc(context).inkMuted),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: GcSpace.sm),
              Text(
                // An unpriced pick has no price. Never a zero, which would read as odds and would
                // multiply a slip's total to nothing.
                selection.odds?.toStringAsFixed(2) ?? '–',
                style: GcType.figure.copyWith(color: ok ? gc(context).ink : gc(context).inkFaint),
              ),
              if (onRemove != null) ...[
                const SizedBox(width: GcSpace.xs),
                // The icon button carries a full 44dp touch target, which in a list this dense
                // doubles the height of every row and pushes the market line away from the teams
                // it belongs to. The target stays - it is what makes this tappable for everyone -
                // and only the space it reserves is clipped back.
                SizedBox(
                  width: 28,
                  height: 24,
                  child: OverflowBox(
                    maxWidth: GcSize.touch,
                    maxHeight: GcSize.touch,
                    child: GcIconButton(
                      icon: Icons.close_rounded,
                      colour: gc(context).inkFaint,
                      tooltip: 'Remove ${selection.home} v ${selection.away}',
                      onPressed: onRemove,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: GcSpace.xs),
          Row(
            children: [
              Flexible(
                child: Text(
                  '${selection.marketLabel} · ${selection.pickLabel}',
                  style: GcType.caption.copyWith(
                    color: ok ? gc(context).inkMuted : gc(context).inkFaint,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (!ok) ...[
                const SizedBox(width: GcSpace.sm),
                GcStatusChip(label: 'NOT BOOKED', colour: gc(context).warn),
              ],
            ],
          ),
          if (!ok) ...[
            const SizedBox(height: GcSpace.xs),
            Text(
              selection.status.reason,
              style: GcType.caption.copyWith(color: gc(context).warn, fontSize: 11.5),
            ),
          ],
          if (selection.reason != null && selection.reason!.isNotEmpty) ...[
            const SizedBox(height: GcSpace.xs),
            Text(selection.reason!, style: GcType.caption.copyWith(fontSize: 11.5)),
          ],
          const SizedBox(height: GcSpace.xs),
          Text(
            [
              if (selection.competition != null) selection.competition!,
              DateFormat('E HH:mm').format(selection.kickoffUtc.toLocal()),
            ].join(' · '),
            style: GcType.caption.copyWith(fontSize: 11, color: gc(context).inkFaint),
          ),
        ],
      ),
    );
  }
}

/// A converted slip that has not been booked yet.
///
/// The distinction this draws is the whole reason conversion and booking are separate. Everything
/// expensive has already happened: each game was found at this bookmaker and its own price read.
/// What is left is a single write the bookmaker can refuse for its own reasons. So the card says
/// what this destination can actually carry, and asks before anything is booked in the user's
/// name - rather than committing them to a move and reporting afterwards that three legs were lost.
class _Draft extends StatelessWidget {
  const _Draft({
    required this.carryable,
    required this.total,
    required this.bookmaker,
    required this.busy,
    required this.onBook,
  });

  final int carryable;
  final int total;
  final String bookmaker;
  final bool busy;
  final Future<void> Function() onBook;

  @override
  Widget build(BuildContext context) {
    final all = carryable == total;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        GcNote(
          all
              ? '$bookmaker can carry all $total. Nothing is booked yet.'
              : '$bookmaker can carry $carryable of $total. Nothing is booked yet.',
          icon: Icons.fact_check_outlined,
        ),
        const SizedBox(height: GcSpace.sm),
        // GcButton keeps itself busy for as long as the future it is given takes to settle, so
        // a double tap cannot book twice.
        GcButton(
          label: carryable == 0 ? 'Nothing to book' : 'Get the booking code',
          icon: Icons.confirmation_number_outlined,
          onPressed: carryable == 0 || busy ? null : onBook,
        ),
      ],
    );
  }
}
