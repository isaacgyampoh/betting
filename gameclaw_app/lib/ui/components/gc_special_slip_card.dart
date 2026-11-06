import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../domain/models.dart';
import '../../features/share/special_slip_share.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'gc_button.dart';
import 'gc_chip.dart';

final _date = DateFormat('EEEE d MMMM');
final _kickoff = DateFormat('E HH:mm');
final _verified = DateFormat('HH:mm');

const _bookmakers = {'sportybet': 'SportyBet', 'footballcom': 'Football.com'};
const _markets = {
  'CORNERS': 'corners',
  'SHOTS': 'shots',
  'SHOTS_ON_TARGET': 'shots on target',
  'FOULS': 'fouls',
  'OFFSIDES': 'offsides',
};

/// The Daily Special Slip, as one publication.
///
/// The combined price is the largest thing on it, because that is what is being published. Each
/// leg still carries its own verified price and the research behind it - a slip whose legs cannot
/// be checked is a tip rather than research.
class GcSpecialSlipCard extends StatelessWidget {
  const GcSpecialSlipCard({super.key, required this.slip, this.sharer = const SpecialSlipSharer()});

  final SpecialSlip slip;
  final SpecialSlipSharer sharer;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: gc(context).surface,
        borderRadius: BorderRadius.circular(GcRadius.lg),
        border: Border.all(color: gc(context).border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Header(slip: slip),
          Container(height: 1, color: gc(context).border),
          Padding(
            padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.md, GcSpace.lg, GcSpace.md),
            child: Text(slip.summary, style: GcType.caption),
          ),
          for (final leg in slip.legs) ...[
            Container(height: 1, color: gc(context).border),
            _Leg(leg: leg),
          ],
          Container(height: 1, color: gc(context).border),
          _Footer(slip: slip, sharer: sharer),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.slip});

  final SpecialSlip slip;

  @override
  Widget build(BuildContext context) {
    final (label, colour) = switch (slip.status) {
      PickStatus.won => ('WON', gc(context).win),
      PickStatus.lost => ('LOST', gc(context).loss),
      PickStatus.voided => ('VOID', gc(context).inkFaint),
      PickStatus.pending => ('RUNNING', gc(context).accentInk),
    };

    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.lg, GcSpace.lg, GcSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'GAMECLAW',
                  style: GcType.overline.copyWith(color: gc(context).inkFaint),
                ),
              ),
              GcStatusChip(label: label, colour: colour),
            ],
          ),
          const SizedBox(height: GcSpace.xs),
          Text('Daily Special Slip', style: GcType.title),
          const SizedBox(height: GcSpace.xxs),
          Text(
            '${_date.format(DateTime.parse(slip.date))} · ${slip.legs.length} '
            '${slip.legs.length == 1 ? 'match' : 'matches'} · ${slip.reference}',
            style: GcType.caption.copyWith(color: gc(context).inkFaint),
          ),
          const SizedBox(height: GcSpace.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                slip.combinedOdds.toStringAsFixed(2),
                style: GcType.hero.copyWith(
                  color: gc(context).accentInk,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(width: GcSpace.sm),
              Padding(
                padding: const EdgeInsets.only(bottom: GcSpace.xs + 2),
                child: Text('combined odds', style: GcType.caption),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Leg extends StatelessWidget {
  const _Leg({required this.leg});

  final SpecialPick leg;

  @override
  Widget build(BuildContext context) {
    final colour = switch (leg.status) {
      PickStatus.won => gc(context).win,
      PickStatus.lost => gc(context).loss,
      _ => gc(context).inkFaint,
    };

    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.md, GcSpace.lg, GcSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${leg.home} v ${leg.away}', style: GcType.label),
                    const SizedBox(height: 2),
                    Text(
                      [
                        if (leg.competition != null) leg.competition!,
                        _kickoff.format(leg.kickoffUtc.toLocal()),
                      ].join(' · '),
                      style: GcType.caption.copyWith(color: gc(context).inkFaint),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: GcSpace.sm),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    leg.odds == null ? '–' : leg.odds!.toStringAsFixed(2),
                    style: GcType.figure.copyWith(fontSize: 16),
                  ),
                  if (leg.status != PickStatus.pending)
                    Text(
                      switch (leg.status) {
                        PickStatus.won => 'won',
                        PickStatus.lost => 'lost',
                        _ => 'void',
                      },
                      style: GcType.caption.copyWith(fontSize: 11, color: colour),
                    ),
                ],
              ),
            ],
          ),
          const SizedBox(height: GcSpace.sm),
          Text(
            '${_markets[leg.marketKind] ?? leg.marketLabel.toLowerCase()} — ${leg.selection}',
            style: GcType.bodyStrong.copyWith(fontSize: 14),
          ),
          const SizedBox(height: 2),
          // In full. A researched reason cut to one line is how research starts looking like a guess.
          Text(leg.reason, style: GcType.caption),
          const SizedBox(height: 2),
          Text(
            '${leg.bookmaker == null ? 'no verified price' : _bookmakers[leg.bookmaker] ?? leg.bookmaker!}'
            ' · our estimate ${(leg.probability * 100).round()}%'
            '${leg.actual != null ? ' · match produced ${leg.actual!.toStringAsFixed(0)}' : ''}',
            style: GcType.caption.copyWith(color: gc(context).inkFaint),
          ),
        ],
      ),
    );
  }
}

class _Footer extends StatefulWidget {
  const _Footer({required this.slip, required this.sharer});

  final SpecialSlip slip;
  final SpecialSlipSharer sharer;

  @override
  State<_Footer> createState() => _FooterState();
}

class _FooterState extends State<_Footer> {
  bool _sharing = false;

  Future<void> _share() async {
    if (_sharing) return;
    setState(() => _sharing = true);

    final messenger = ScaffoldMessenger.of(context);
    final shared = await widget.sharer.shareSlip(widget.slip);
    if (mounted) setState(() => _sharing = false);
    if (shared) return;

    // A share that silently does nothing reads as the app being broken.
    messenger
      ..clearSnackBars()
      ..showSnackBar(const SnackBar(content: Text('Could not fetch the slip image. Try again in a moment.')));
  }

  @override
  Widget build(BuildContext context) {
    final slip = widget.slip;

    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.lg, GcSpace.md, GcSpace.lg, GcSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            slip.lastVerifiedAt == null
                ? 'Prices as published'
                : 'Prices last checked ${_verified.format(slip.lastVerifiedAt!.toLocal())}'
                      '${slip.moved ? ' · now ${slip.currentOdds!.toStringAsFixed(2)}' : ''}',
            style: GcType.caption.copyWith(color: gc(context).inkFaint),
          ),
          const SizedBox(height: GcSpace.md),
          // One bet, so one share control - never one per match.
          GcButton(
            label: _sharing ? 'Sharing…' : 'Share slip',
            kind: GcButtonKind.secondary,
            icon: Icons.ios_share_rounded,
            onPressed: _sharing ? null : _share,
          ),
        ],
      ),
    );
  }
}
