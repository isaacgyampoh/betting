import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../domain/models.dart';
import '../../theme/tokens.dart';
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
  const GcSlipCard({super.key, required this.slip});

  final Slip slip;

  @override
  Widget build(BuildContext context) {
    final unsupported = slip.selections.where((s) => !s.status.isOk).length;

    return Container(
      decoration: BoxDecoration(
        color: GcColors.surface,
        borderRadius: BorderRadius.circular(GcRadius.lg),
        border: Border.all(color: GcColors.border),
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
                        style: GcType.overline.copyWith(fontSize: 9, color: GcColors.inkFaint),
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
                        style: GcType.overline.copyWith(fontSize: 9, color: GcColors.inkFaint),
                      ),
                      const SizedBox(height: GcSpace.xxs),
                      Text(
                        slip.totalOdds!.toStringAsFixed(2),
                        style: GcType.title.copyWith(
                          color: GcColors.accent,
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
                  color: GcColors.warn.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(GcRadius.sm),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.science_outlined, size: 14, color: GcColors.warn),
                    const SizedBox(width: GcSpace.sm),
                    Expanded(
                      child: Text(
                        'Sample data — this code will not work on the bookmaker’s site.',
                        style: GcType.caption.copyWith(color: GcColors.warn, fontSize: 11.5),
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
                : const GcNote(
                    'Built, but not booked. The bookmaker issued no code for this slip.',
                    icon: Icons.info_outline_rounded,
                  ),
          ),

          const SizedBox(height: GcSpace.md),
          const Divider(height: 1),

          for (final (i, selection) in slip.selections.indexed) ...[
            if (i > 0) const Divider(height: 1, indent: GcSpace.md, endIndent: GcSpace.md),
            _SelectionRow(selection: selection),
          ],

          if (unsupported > 0 || slip.warnings.isNotEmpty)
            Container(
              color: GcColors.surfaceRaised,
              padding: const EdgeInsets.all(GcSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (unsupported > 0)
                    Text(
                      '$unsupported of ${slip.selections.length} could not be carried across.',
                      style: GcType.caption.copyWith(color: GcColors.warn),
                    ),
                  for (final warning in slip.warnings)
                    Padding(
                      padding: const EdgeInsets.only(top: GcSpace.xs),
                      child: Text(
                        warning.message,
                        style: GcType.caption.copyWith(color: GcColors.warn),
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
                    const Icon(Icons.check_rounded, size: 16, color: GcColors.accent),
                    const SizedBox(width: GcSpace.sm),
                    Text('Booking code copied', style: GcType.label.copyWith(color: GcColors.ink)),
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
            color: GcColors.surfaceRaised,
            borderRadius: BorderRadius.circular(GcRadius.md),
            border: Border.all(color: GcColors.borderStrong),
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
                        style: GcType.caption.copyWith(fontSize: 11, color: GcColors.inkFaint),
                      ),
                    ],
                  ],
                ),
              ),
              const Icon(Icons.copy_rounded, size: 17, color: GcColors.inkMuted),
            ],
          ),
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
                  style: GcType.label.copyWith(color: ok ? GcColors.ink : GcColors.inkMuted),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: GcSpace.sm),
              Text(
                // An unpriced pick has no price. Never a zero, which would read as odds and would
                // multiply a slip's total to nothing.
                selection.odds?.toStringAsFixed(2) ?? '–',
                style: GcType.figure.copyWith(color: ok ? GcColors.ink : GcColors.inkFaint),
              ),
            ],
          ),
          const SizedBox(height: GcSpace.xs),
          Row(
            children: [
              Flexible(
                child: Text(
                  '${selection.marketLabel} · ${selection.pickLabel}',
                  style: GcType.caption.copyWith(color: ok ? GcColors.inkMuted : GcColors.inkFaint),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (!ok) ...[
                const SizedBox(width: GcSpace.sm),
                GcStatusChip(label: 'NOT BOOKED', colour: GcColors.warn),
              ],
            ],
          ),
          if (!ok) ...[
            const SizedBox(height: GcSpace.xs),
            Text(
              selection.status.reason,
              style: GcType.caption.copyWith(color: GcColors.warn, fontSize: 11.5),
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
            style: GcType.caption.copyWith(fontSize: 11, color: GcColors.inkFaint),
          ),
        ],
      ),
    );
  }
}
