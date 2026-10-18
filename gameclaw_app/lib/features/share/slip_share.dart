import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../../domain/models.dart';
import '../../ui/components/gc_share_card.dart';

/// Turning a slip into something that can leave the app.
///
/// Two forms, and both are built from the same slip so they cannot disagree:
///
///  * a picture, which is what gets forwarded and looked at;
///  * a line of text, which is what gets copied. A picture of a booking code cannot be pasted
///    into a bookmaker's app, so sending the image alone would make the recipient retype it.
///
/// The picture is rendered off-screen at a fixed size. It is tempting to screenshot the card
/// already on screen - `RepaintBoundary` around the visible widget, `toImage` on its render object
/// - and it is what most code does, but it produces an image whose width, pixel density and
/// cropping are whatever the sender's phone happens to be, and it cannot render anything the
/// screen is not currently showing. Building a private pipeline instead means every GameClaw slip
/// shared from any phone is the same 1080px card.

/// What is needed to share a slip, in the two forms a share sheet takes.
@immutable
class SlipShare {
  const SlipShare({required this.image, required this.text});

  /// PNG bytes of the branded card.
  final Uint8List image;

  /// The accompanying message. Carries the code as text so it can be copied.
  final String text;
}

/// The message that travels with the picture.
///
/// Deliberately plain. It repeats the code, because that is the one thing a recipient needs to
/// type somewhere else, and it names the bookmaker, because a code is only meaningful at the
/// bookmaker that issued it. It makes no claim about the slip winning.
///
/// A sample slip says so here as well as on the image. Text survives in places an image does not -
/// a notification preview, a reply quote - and a mock code reaching somebody with the warning
/// cropped off is the failure this is guarding against.
String shareTextFor(Slip slip) {
  final lines = <String>[];

  if (slip.demo) {
    lines.add('SAMPLE DATA — this code will not work at the bookmaker.');
    lines.add('');
  }

  final code = slip.code;
  if (code != null) {
    lines.add('$code — ${slip.bookmakerName} booking code');
  } else {
    // No invented code, and no empty "code:" label that would read as a rendering fault.
    lines.add('${slip.bookmakerName} slip — built, not booked (no code was issued)');
  }

  final legs = slip.selections.length;
  final odds = slip.totalOdds;
  lines.add(
    odds != null
        ? '$legs ${legs == 1 ? "selection" : "selections"} at ${odds.toStringAsFixed(2)}'
        : '$legs ${legs == 1 ? "selection" : "selections"}',
  );

  final dropped = slip.selections.where((s) => !s.status.isOk).length;
  if (dropped > 0) {
    lines.add('$dropped of $legs could not be carried across.');
  }

  lines.add('');
  lines.add('Odds can change. 18+ — bet responsibly.');
  lines.add('Built with GameClaw · gameclaw.win');

  return lines.join('\n');
}

/// Builds the picture and the message for a slip.
///
/// [pixelRatio] is the raster multiplier over [GcShareCard.width]: at 2 the card comes out 1080px
/// wide, which is what the messaging apps resample to and is the most detail worth sending.
Future<SlipShare> buildSlipShare(
  Slip slip, {
  double pixelRatio = 2,
  DateTime? capturedAt,
}) async {
  final image = await renderToPng(
    GcShareCard(slip: slip, capturedAt: capturedAt ?? DateTime.now()),
    width: GcShareCard.width,
    pixelRatio: pixelRatio,
  );
  return SlipShare(image: image, text: shareTextFor(slip));
}

/// Rasterises a widget that is not on screen, at a width we choose.
///
/// Builds a one-off render tree - its own [RenderView], [PipelineOwner] and [BuildOwner] - drives
/// a single frame through it by hand, and reads the result out of a repaint boundary. The widget
/// never enters the app's tree, so nothing flickers, no route is pushed, and the size owes nothing
/// to the device.
///
/// The view is given a fixed width and an unbounded height. [RenderView] sizes itself to its child
/// when its constraints are not tight, so the card decides its own height from however many
/// selections it has, which is the one dimension that cannot be known in advance.
///
/// Widgets below this point get no inherited anything, so the two that are not optional are
/// supplied: [Directionality], without which every [Text] throws, and [MediaQuery], which
/// [Container] and friends reach for. Anything needing a [Theme] or a provider has to be passed
/// its values directly - which is why [GcShareCard] takes the dark palette as a constant rather
/// than reading it from context.
@visibleForTesting
Future<Uint8List> renderToPng(
  Widget widget, {
  required double width,
  double pixelRatio = 2,
}) async {
  final boundary = RenderRepaintBoundary();
  final view = ui.PlatformDispatcher.instance.implicitView;
  if (view == null) {
    // No view to borrow a configuration from. Nothing can be rasterised, and a caller that gets
    // an exception here can fall back to sharing text.
    throw StateError('no render view available to rasterise into');
  }

  // Width fixed, height free. Device pixel ratio stays at 1 so layout happens in the card's own
  // units; the scaling up to a shareable resolution is done once, at toImage, from the recorded
  // picture - so text and the claw mark are rasterised at the final size rather than magnified.
  final constraints = BoxConstraints(minWidth: width, maxWidth: width, maxHeight: double.infinity);
  final renderView = RenderView(
    view: view,
    child: boundary,
    configuration: ViewConfiguration(
      logicalConstraints: constraints,
      physicalConstraints: constraints,
    ),
  );

  final pipelineOwner = PipelineOwner();
  final buildOwner = BuildOwner(focusManager: FocusManager());
  pipelineOwner.rootNode = renderView;
  renderView.prepareInitialFrame();

  final element = RenderObjectToWidgetAdapter<RenderBox>(
    container: boundary,
    child: Directionality(
      textDirection: TextDirection.ltr,
      child: MediaQuery(
        data: MediaQueryData(size: Size(width, double.infinity)),
        child: widget,
      ),
    ),
  ).attachToRenderTree(buildOwner);

  try {
    buildOwner.buildScope(element);
    buildOwner.finalizeTree();
    pipelineOwner.flushLayout();
    pipelineOwner.flushCompositingBits();
    pipelineOwner.flushPaint();

    final image = await boundary.toImage(pixelRatio: pixelRatio);
    try {
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      if (data == null) throw StateError('the card rendered but produced no PNG bytes');
      return data.buffer.asUint8List();
    } finally {
      // The raw image holds memory off the Dart heap; a share of a ten-leg slip is several
      // megabytes of it and the collector cannot see any of it.
      image.dispose();
    }
  } finally {
    // Unbuild the throwaway tree whatever happened: re-attach the same element with no child,
    // which unmounts the card's subtree and disposes its render objects through the ordinary
    // framework path. Leaving it attached would keep every render object on the card alive, and
    // this runs once per share.
    RenderObjectToWidgetAdapter<RenderBox>(container: boundary).attachToRenderTree(buildOwner, element);
    buildOwner.buildScope(element);
    buildOwner.finalizeTree();
    renderView.dispose();
    pipelineOwner.rootNode = null;
  }
}
