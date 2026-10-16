import 'package:flutter/material.dart';

import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// A starting eleven, laid out on a pitch.
///
/// Every position comes from the provider's own `grid` ("row:column", counting out from the
/// goalkeeper). Nothing is inferred from the formation string and nothing is placed by guesswork:
/// a lineup whose players have no grid is shown as a list instead, because a pitch with invented
/// positions is a picture of a formation that may not be the one that was played.
class GcPitch extends StatelessWidget {
  const GcPitch({super.key, required this.lineup});

  final Lineup lineup;

  @override
  Widget build(BuildContext context) {
    // Rows in order, goalkeeper first. The provider does not guarantee contiguous numbering, so
    // the rows present are taken as they come rather than assumed to be 1..n.
    final byRow = <int, List<LineupPlayer>>{};
    for (final player in lineup.startXI) {
      final row = player.row;
      if (row != null) (byRow[row] ??= []).add(player);
    }
    final rows = byRow.keys.toList()..sort();
    for (final row in rows) {
      byRow[row]!.sort((a, b) => (a.column ?? 0).compareTo(b.column ?? 0));
    }

    return AspectRatio(
      // Taller than a real pitch: eleven names need vertical room far more than they need
      // geometric accuracy, and a true 105:68 leaves every row cramped on a phone.
      aspectRatio: 0.78,
      child: Container(
        decoration: BoxDecoration(
          color: gc(context).surface,
          borderRadius: BorderRadius.circular(GcRadius.md),
          border: Border.all(color: gc(context).border),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: [
            Positioned.fill(child: CustomPaint(painter: _PitchLines(gc(context).border))),
            Positioned.fill(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: GcSpace.md),
                child: Column(
                  children: [
                    for (final row in rows)
                      Expanded(
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            for (final player in byRow[row]!)
                              Flexible(child: _Player(player: player)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The markings. Drawn rather than imaged: one painter at any size, no asset to ship, and it tints
/// with the theme.
class _PitchLines extends CustomPainter {
  const _PitchLines(this.line);

  /// Passed in rather than read from a context, which a painter does not have. Comparing it in
  /// shouldRepaint is what makes the markings follow a theme change.
  final Color line;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = line;

    final rect = Offset.zero & size;
    canvas.drawRect(rect.deflate(8), paint);

    // Halfway line and centre circle.
    canvas.drawLine(Offset(8, size.height / 2), Offset(size.width - 8, size.height / 2), paint);
    canvas.drawCircle(Offset(size.width / 2, size.height / 2), size.width * 0.14, paint);

    // Penalty areas, top and bottom.
    final boxWidth = size.width * 0.52;
    final boxHeight = size.height * 0.14;
    final left = (size.width - boxWidth) / 2;
    canvas.drawRect(Rect.fromLTWH(left, 8, boxWidth, boxHeight), paint);
    canvas.drawRect(Rect.fromLTWH(left, size.height - 8 - boxHeight, boxWidth, boxHeight), paint);
  }

  @override
  bool shouldRepaint(_PitchLines oldDelegate) => oldDelegate.line != line;
}

class _Player extends StatelessWidget {
  const _Player({required this.player});

  final LineupPlayer player;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '${player.number ?? ''} ${player.name}'.trim(),
      excludeSemantics: true,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: gc(context).surfaceRaised,
              shape: BoxShape.circle,
              border: Border.all(color: gc(context).borderStrong),
            ),
            child: Text(
              player.number?.toString() ?? '–',
              style: GcType.figureSm.copyWith(fontSize: 11, color: gc(context).ink),
            ),
          ),
          const SizedBox(height: GcSpace.xs),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Text(
              // The surname is what fits and what people read. The full name stays on the
              // semantics label, so a screen reader still gets all of it.
              _short(player.name),
              style: GcType.caption.copyWith(fontSize: 9.5, color: gc(context).inkMuted),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  static String _short(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    return parts.length < 2 ? name : parts.last;
  }
}
