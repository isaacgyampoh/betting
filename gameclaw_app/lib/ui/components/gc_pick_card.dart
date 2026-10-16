import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'gc_chip.dart';

/// A published slip.
///
/// Two rules are visible in here and both are deliberate. The chance is always the server's own
/// wording - "roughly a 1 in 4 chance" - and never a word like sure or guaranteed. And a locked
/// slip shows its header and says what is behind the plan rather than rendering an empty card or
/// inventing legs to fill it.
class GcPickCard extends StatelessWidget {
  const GcPickCard({super.key, required this.pick, this.initiallyExpanded = false});

  final DailyPick pick;
  final bool initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: GcSpace.md),
      decoration: BoxDecoration(
        color: gc(context).surface,
        borderRadius: BorderRadius.circular(GcRadius.lg),
        border: Border.all(color: gc(context).border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        // The default expansion tile paints its own divider and a tint on open, both of which
        // fight the card's border.
        data: Theme.of(
          context,
        ).copyWith(dividerColor: Colors.transparent, splashColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: initiallyExpanded,
          tilePadding: const EdgeInsets.symmetric(horizontal: GcSpace.lg, vertical: GcSpace.xs),
          childrenPadding: const EdgeInsets.only(bottom: GcSpace.sm),
          title: _Header(pick: pick),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: GcSpace.xs),
            child: Text('${pick.confidence} · ${pick.chance}', style: GcType.caption),
          ),
          children: [
            if (!pick.unlocked)
              const Padding(
                padding: EdgeInsets.fromLTRB(GcSpace.lg, 0, GcSpace.lg, GcSpace.md),
                child: Text(
                  'The games on this slip are part of a paid plan. '
                  'Every slip opens to everyone the moment it settles, win or lose.',
                  style: GcType.caption,
                ),
              )
            else
              for (final leg in pick.legs) _Leg(leg: leg),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.pick});

  final DailyPick pick;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _StatusChip(status: pick.status),
        const SizedBox(width: GcSpace.sm),
        Expanded(
          child: Text(
            '${pick.target} odds slip',
            style: GcType.heading,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Text(pick.totalOdds.toStringAsFixed(2), style: GcType.figure.copyWith(fontSize: 16)),
      ],
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final PickStatus status;

  @override
  Widget build(BuildContext context) {
    final (label, colour) = switch (status) {
      PickStatus.won => ('WON', gc(context).win),
      PickStatus.lost => ('LOST', gc(context).loss),
      PickStatus.voided => ('VOID', gc(context).inkFaint),
      PickStatus.pending => ('RUNNING', gc(context).accent),
    };
    return GcStatusChip(label: label, colour: colour);
  }
}

class _Leg extends StatelessWidget {
  const _Leg({required this.leg});

  final PickLeg leg;

  @override
  Widget build(BuildContext context) {
    final colour = switch (leg.status) {
      PickStatus.won => gc(context).win,
      PickStatus.lost => gc(context).loss,
      _ => gc(context).inkFaint,
    };

    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.sm, GcSpace.lg, GcSpace.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(color: colour, shape: BoxShape.circle),
              ),
              const SizedBox(width: GcSpace.sm),
              Expanded(
                child: Text(
                  '${leg.home} v ${leg.away}',
                  style: GcType.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(
                leg.odds.toStringAsFixed(2),
                style: GcType.figure.copyWith(fontSize: 13, color: gc(context).inkMuted),
              ),
            ],
          ),
          const SizedBox(height: GcSpace.xs),
          Padding(
            padding: const EdgeInsets.only(left: 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${leg.marketLabel}: ${leg.pickLabel}',
                  style: GcType.body.copyWith(fontSize: 13),
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    if (leg.competition != null) leg.competition!,
                    DateFormat('E HH:mm').format(leg.kickoffUtc.toLocal()),
                  ].join(' · '),
                  style: GcType.caption.copyWith(color: gc(context).inkFaint),
                ),
                if (leg.reason.isNotEmpty) ...[
                  const SizedBox(height: GcSpace.xs),
                  // In full. A researched reason cut to one line is how a researched pick starts
                  // looking like a guess.
                  Text(leg.reason, style: GcType.caption),
                ],
                if (leg.resultText != null) ...[
                  const SizedBox(height: GcSpace.xs),
                  Text(leg.resultText!, style: GcType.caption.copyWith(color: colour)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
