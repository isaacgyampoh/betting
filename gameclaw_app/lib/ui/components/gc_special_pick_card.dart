import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'gc_chip.dart';

/// One Daily Special Pick.
///
/// The three figures along the bottom are the point of this card and they are three separate
/// labelled columns on purpose: the bookmaker's price, our estimated chance, and the value the two
/// imply. A single number beside a percentage is how an estimate ends up being read as a price.
///
/// Nothing is expandable. A special pick is one selection with one reason, so there is nothing to
/// fold away - unlike a slip, which is several games behind a header.
class GcSpecialPickCard extends StatelessWidget {
  const GcSpecialPickCard({super.key, required this.pick, this.onTap});

  final SpecialPick pick;

  /// Opens the match, when the caller can resolve one.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.md, GcSpace.lg, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _StatusChip(status: pick.status),
              const SizedBox(width: GcSpace.sm),
              Expanded(
                child: Text(
                  '${pick.home} v ${pick.away}',
                  style: GcType.heading,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: GcSpace.xs),
          Text(
            [
              if (pick.competition != null) pick.competition!,
              DateFormat('E HH:mm').format(pick.kickoffUtc.toLocal()),
            ].join(' · '),
            style: GcType.caption.copyWith(color: gc(context).inkFaint),
          ),
          const SizedBox(height: GcSpace.md),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: '${pick.marketLabel}: ',
                  style: GcType.body.copyWith(fontSize: 14, color: gc(context).inkMuted),
                ),
                TextSpan(text: pick.selection, style: GcType.bodyStrong.copyWith(fontSize: 14)),
              ],
            ),
          ),
          if (pick.reason.isNotEmpty) ...[
            const SizedBox(height: GcSpace.xs),
            // In full. A researched reason cut to one line is how research starts looking like a
            // guess.
            Text(pick.reason, style: GcType.caption),
          ],
          const SizedBox(height: GcSpace.md),
          _Figures(pick: pick),
          if (pick.actual != null) ...[
            const SizedBox(height: GcSpace.sm),
            Text(
              'The match produced ${_trim(pick.actual!)}.',
              style: GcType.caption.copyWith(color: _colourFor(context, pick.status)),
            ),
          ],
          const SizedBox(height: GcSpace.md),
        ],
      ),
    );

    return Container(
      margin: const EdgeInsets.only(bottom: GcSpace.md),
      decoration: BoxDecoration(
        color: gc(context).surface,
        borderRadius: BorderRadius.circular(GcRadius.lg),
        border: Border.all(color: gc(context).border),
      ),
      clipBehavior: Clip.antiAlias,
      child: onTap == null
          ? body
          : InkWell(onTap: onTap, child: body),
    );
  }
}

String _trim(double v) => v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

Color _colourFor(BuildContext context, PickStatus status) => switch (status) {
  PickStatus.won => gc(context).win,
  PickStatus.lost => gc(context).loss,
  _ => gc(context).inkFaint,
};

/// Price, estimate, value. Three columns, three labels, no shared units.
class _Figures extends StatelessWidget {
  const _Figures({required this.pick});

  final SpecialPick pick;

  @override
  Widget build(BuildContext context) {
    final value = pick.value;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.md),
      decoration: BoxDecoration(
        color: gc(context).surfaceRaised,
        borderRadius: BorderRadius.circular(GcRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Figure(
            label: 'Bookmaker odds',
            value: pick.odds == null ? '–' : pick.odds!.toStringAsFixed(2),
            note: pick.bookmaker == null ? 'no verified price' : _bookmaker(pick.bookmaker!),
          ),
          _Figure(
            label: 'Our estimate',
            value: '${(pick.probability * 100).round()}%',
            note: '${pick.confidence} confidence',
          ),
          _Figure(
            label: 'Estimated value',
            value: value == null
                ? '–'
                : '${value >= 0 ? '+' : ''}${(value * 100).round()}%',
            note: 'per unit staked',
            colour: value == null ? null : (value > 0 ? gc(context).win : gc(context).loss),
          ),
        ],
      ),
    );
  }

  static String _bookmaker(String slug) => switch (slug) {
    'sportybet' => 'SportyBet',
    'footballcom' => 'Football.com',
    _ => slug,
  };
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value, required this.note, this.colour});

  final String label;
  final String value;
  final String note;
  final Color? colour;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: GcType.caption.copyWith(fontSize: 11, color: gc(context).inkFaint),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: GcSpace.xxs),
          Text(value, style: GcType.figure.copyWith(fontSize: 16, color: colour ?? gc(context).ink)),
          const SizedBox(height: GcSpace.xxs),
          Text(
            note,
            style: GcType.caption.copyWith(fontSize: 11, color: gc(context).inkFaint),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
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
      PickStatus.pending => ('RUNNING', gc(context).accentInk),
    };
    return GcStatusChip(label: label, colour: colour);
  }
}
