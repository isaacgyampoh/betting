import 'package:flutter/material.dart';

import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'share_slip_action.dart';

/// The one line a screen needs to make a slip shareable.
///
/// Exists so that the three screens showing a [GcSlipCard] do not each carry their own copy of
/// "build the sharer, await it, and say something if it failed" - and so that the failure is
/// actually said. A share that silently does nothing is read as the app being broken, which is
/// roughly the opposite of what a share button is for.
Future<void> shareSlip(
  BuildContext context,
  Slip slip, {
  SlipSharer sharer = const SlipSharer(),
}) async {
  // Taken before the await: the widget can be gone by the time the sheet closes, and the
  // messenger is the thing that outlives it.
  final messenger = ScaffoldMessenger.of(context);
  final palette = gc(context);

  final shared = await sharer.shareSlip(slip);
  if (shared) return;

  messenger
    ..clearSnackBars()
    ..showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(Icons.error_outline_rounded, size: 16, color: palette.warn),
            const SizedBox(width: GcSpace.sm),
            Expanded(
              child: Text(
                'Could not make the share image. Try again in a moment.',
                style: GcType.label.copyWith(color: palette.ink),
              ),
            ),
          ],
        ),
        duration: const Duration(seconds: 3),
      ),
    );
}
