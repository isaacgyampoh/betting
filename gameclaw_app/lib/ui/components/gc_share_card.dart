import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../brand/gc_claw.dart';

/// A slip as a picture, for sending out of the app.
///
/// This is a different object from [GcSlipCard] on purpose, and the difference is the audience.
/// The in-app card is for the person who built the slip: it has buttons, it follows the device
/// theme, and it can rely on the surrounding screen for context. A share image is read by somebody
/// who may never have heard of GameClaw, in a WhatsApp thread, at thumbnail size, with no context
/// at all. So it is always dark, always the same size whatever phone made it, carries the mark and
/// the address, and repeats the things the in-app card can leave to the screen around it.
///
/// Every honesty rule from the in-app card is repeated here rather than inherited, because a
/// picture travels further than the app does and cannot be corrected once it has been sent:
///
///  * a booking code appears only when the bookmaker issued one. There is no placeholder and
///    nothing is ever assembled to look like a code;
///  * a sample-data slip says so, in the loudest position on the card. A mock code is formatted
///    exactly like a real one, so an unlabelled screenshot of one is indistinguishable from a
///    working slip;
///  * a selection the bookmaker could not carry stays on the card, struck and marked, instead of
///    being dropped. A shared image that quietly lists eight of ten legs is a lie by omission;
///  * odds are printed only where there is a price. A missing price is a dash, never a 0.00.
///
/// No network images. The in-app card draws team crests, which are fetched; here they would have
/// to be resolved before the capture or they would paint as holes, and a half-drawn crest in a
/// picture that has already been sent cannot be retried. Team names set as type read better at
/// thumbnail size anyway, so nothing is lost by leaving them out.
class GcShareCard extends StatelessWidget {
  const GcShareCard({super.key, required this.slip, this.capturedAt});

  final Slip slip;

  /// When the picture was made. Injected so a golden test is not a function of the clock.
  final DateTime? capturedAt;

  /// Logical width of the exported image. 540 at a 2x raster is 1080px across, which is what the
  /// messaging apps want and is wide enough that ten selections stay legible.
  static const width = 540.0;

  @override
  Widget build(BuildContext context) {
    // Fixed to the dark palette rather than read from the theme. A share image is not part of the
    // sender's interface and should not change shape because they use the app in light mode; it
    // also means the one set of colours is the one every test and every recipient sees.
    const p = GcPalette.dark;
    final unsupported = slip.selections.where((s) => !s.status.isOk).length;

    return Container(
      width: width,
      decoration: BoxDecoration(color: p.canvas),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          _Header(),
          if (slip.demo) const _SampleBanner(),
          _Headline(slip: slip),
          const SizedBox(height: GcSpace.lg),
          for (final (i, s) in slip.selections.indexed) ...[
            if (i > 0)
              Divider(height: 1, color: p.border, indent: GcSpace.xl, endIndent: GcSpace.xl),
            _Row(selection: s),
          ],
          if (unsupported > 0) _Carried(unsupported: unsupported, total: slip.selections.length),
          _Footer(capturedAt: capturedAt),
        ],
      ),
    );
  }
}

/// The mark, the name, and where to get it. The only branding a recipient needs.
class _Header extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    const p = GcPalette.dark;
    return Container(
      padding: const EdgeInsets.fromLTRB(GcSpace.xl, GcSpace.xl, GcSpace.xl, GcSpace.lg),
      child: Row(
        children: [
          GcClawMark(size: 26, colour: p.accent),
          const SizedBox(width: GcSpace.md),
          Text(
            'GameClaw',
            style: GcType.title.copyWith(color: p.ink, letterSpacing: -0.6),
          ),
          const Spacer(),
          Text(
            'gameclaw.win',
            style: GcType.caption.copyWith(color: p.inkFaint, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

/// Said before anything else, because a mock code looks exactly like a real one.
class _SampleBanner extends StatelessWidget {
  const _SampleBanner();

  @override
  Widget build(BuildContext context) {
    const p = GcPalette.dark;
    return Container(
      width: double.infinity,
      color: p.warn,
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.xl, vertical: GcSpace.md),
      child: Row(
        children: [
          Icon(Icons.science_outlined, size: 16, color: p.canvas),
          const SizedBox(width: GcSpace.sm),
          Expanded(
            child: Text(
              'SAMPLE DATA — this code will not work at the bookmaker',
              style: GcType.overline.copyWith(color: p.canvas, fontSize: 10.5),
            ),
          ),
        ],
      ),
    );
  }
}

/// The bookmaker, the code, and the price. The reason the picture is being sent.
class _Headline extends StatelessWidget {
  const _Headline({required this.slip});

  final Slip slip;

  @override
  Widget build(BuildContext context) {
    const p = GcPalette.dark;
    final code = slip.code;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.xl),
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
                    Text(
                      code != null ? 'BOOKING CODE' : 'DESTINATION',
                      style: GcType.overline.copyWith(color: p.inkFaint, fontSize: 9.5),
                    ),
                    const SizedBox(height: GcSpace.xs),
                    // A code is set large and in the accent because it is the one thing the
                    // recipient has to copy by hand. Where there is none, the bookmaker's name
                    // takes the slot and the absence is stated underneath rather than implied.
                    Text(
                      code ?? slip.bookmakerName,
                      style: GcType.hero.copyWith(
                        color: code != null ? p.accent : p.ink,
                        fontSize: code != null ? 36 : 28,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    const SizedBox(height: GcSpace.xs),
                    Text(
                      code != null
                          ? 'at ${slip.bookmakerName}'
                          : 'Built, not booked — no code was issued',
                      style: GcType.label.copyWith(
                        color: code != null ? p.inkMuted : p.warn,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: GcSpace.md),
              if (slip.totalOdds != null) _Odds(total: slip.totalOdds!),
            ],
          ),
          const SizedBox(height: GcSpace.lg),
          Text(
            '${slip.selections.length} ${slip.selections.length == 1 ? "selection" : "selections"}',
            style: GcType.overline.copyWith(color: p.inkFaint, fontSize: 9.5),
          ),
        ],
      ),
    );
  }
}

class _Odds extends StatelessWidget {
  const _Odds({required this.total});

  final double total;

  @override
  Widget build(BuildContext context) {
    const p = GcPalette.dark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.sm),
      decoration: BoxDecoration(
        color: p.surfaceRaised,
        borderRadius: BorderRadius.circular(GcRadius.md),
        border: Border.all(color: p.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            'TOTAL ODDS',
            style: GcType.overline.copyWith(color: p.inkFaint, fontSize: 8.5),
          ),
          const SizedBox(height: GcSpace.xxs),
          Text(
            total.toStringAsFixed(2),
            style: GcType.title.copyWith(
              color: p.ink,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

/// One selection: the fixture, what was picked, and the price.
class _Row extends StatelessWidget {
  const _Row({required this.selection});

  final Selection selection;

  @override
  Widget build(BuildContext context) {
    const p = GcPalette.dark;
    final dropped = !selection.status.isOk;
    final odds = selection.odds;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.xl, vertical: GcSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${selection.home} v ${selection.away}',
                  style: GcType.bodyStrong.copyWith(
                    color: dropped ? p.inkFaint : p.ink,
                    // Struck through rather than removed, so the recipient can see that a leg was
                    // dropped and which one.
                    decoration: dropped ? TextDecoration.lineThrough : null,
                    decorationColor: p.inkFaint,
                  ),
                ),
                const SizedBox(height: GcSpace.xxs),
                Text(
                  dropped
                      ? '${selection.pickLabel} — not carried across'
                      : '${selection.marketLabel} · ${selection.pickLabel}',
                  style: GcType.caption.copyWith(
                    color: dropped ? p.warn : p.inkMuted,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: GcSpace.md),
          Text(
            // An unpriced pick has no price. A dash says that; a 0.00 would read as a real number
            // and would not multiply out to the total shown above.
            odds == null ? '—' : odds.toStringAsFixed(2),
            style: GcType.label.copyWith(
              color: dropped || odds == null ? p.inkFaint : p.accent,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

/// How many legs survived, when some did not.
class _Carried extends StatelessWidget {
  const _Carried({required this.unsupported, required this.total});

  final int unsupported;
  final int total;

  @override
  Widget build(BuildContext context) {
    const p = GcPalette.dark;
    return Container(
      width: double.infinity,
      color: p.surfaceRaised,
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.xl, vertical: GcSpace.md),
      child: Text(
        '$unsupported of $total could not be carried across to this bookmaker.',
        style: GcType.caption.copyWith(color: p.warn, fontSize: 12),
      ),
    );
  }
}

/// The age statement, and when the picture was made.
///
/// The 18+ line is not decoration. This image is built to leave the app and be forwarded by people
/// who did not make it, which is exactly the path by which gambling content reaches someone it
/// should not; it is also what Play's real-money-gambling policy expects of promotional material.
/// It is the last thing on the card and it is not optional.
class _Footer extends StatelessWidget {
  const _Footer({this.capturedAt});

  final DateTime? capturedAt;

  @override
  Widget build(BuildContext context) {
    const p = GcPalette.dark;
    final at = capturedAt;

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: p.surface,
        border: Border(top: BorderSide(color: p.border)),
      ),
      padding: const EdgeInsets.fromLTRB(GcSpace.xl, GcSpace.lg, GcSpace.xl, GcSpace.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: GcSpace.sm, vertical: 3),
            decoration: BoxDecoration(
              border: Border.all(color: p.loss),
              borderRadius: BorderRadius.circular(GcRadius.xs),
            ),
            child: Text(
              '18+',
              style: GcType.overline.copyWith(color: p.loss, fontSize: 10),
            ),
          ),
          const SizedBox(width: GcSpace.md),
          Expanded(
            child: Text(
              'Odds can change. Bet responsibly.',
              style: GcType.caption.copyWith(color: p.inkMuted, fontSize: 11.5),
            ),
          ),
          if (at != null)
            Text(
              DateFormat('d MMM, HH:mm').format(at),
              style: GcType.caption.copyWith(color: p.inkFaint, fontSize: 11),
            ),
        ],
      ),
    );
  }
}
