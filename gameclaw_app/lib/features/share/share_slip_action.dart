import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../domain/models.dart';
import 'slip_share.dart';

/// Handing a slip to the system share sheet.
///
/// Kept apart from [buildSlipShare] so that everything deciding *what* is shared - the card, the
/// wording, the honesty rules - is testable without a platform channel, and this file holds only
/// the part that cannot be: the sheet itself and the temporary file it reads from.
///
/// The image goes via a real file rather than `XFile.fromData`. Android's share intent hands the
/// receiving app a content URI it resolves itself, and the receiver may read it after the sheet
/// has closed; an in-memory XFile has to be spooled somewhere for that to work, so doing it
/// explicitly is both more predictable and the only way to know which file to delete afterwards.
class SlipSharer {
  const SlipSharer({this.share = _systemShare, this.cacheDir = getTemporaryDirectory});

  /// Injected so a test can assert what would be shared without summoning a share sheet.
  final Future<ShareResult> Function(ShareParams params) share;

  /// Injected for the same reason: a unit test has no application cache directory.
  final Future<Directory> Function() cacheDir;

  static Future<ShareResult> _systemShare(ShareParams params) =>
      SharePlus.instance.share(params);

  /// Renders the slip and opens the share sheet.
  ///
  /// Returns false when the picture could not be produced, so the caller can say so rather than
  /// opening an empty sheet. Throwing would be wrong: failing to render a share card is a
  /// disappointment, not an error worth an exception reaching a screen.
  Future<bool> shareSlip(Slip slip) async {
    File? file;
    try {
      final built = await buildSlipShare(slip);
      final dir = await cacheDir();
      // A name a recipient will see in a file manager or a mail attachment. The code makes each
      // one distinct; a slip without one falls back to the id, which is always there.
      final stem = slip.code ?? slip.id.split('-').first;
      file = File(p.join(dir.path, 'gameclaw-slip-$stem.png'));
      await file.writeAsBytes(built.image, flush: true);

      await share(
        ShareParams(
          files: [XFile(file.path, mimeType: 'image/png')],
          // The code travels as text as well as in the picture, so the recipient can paste it.
          text: built.text,
          subject: slip.code != null
              ? 'GameClaw slip ${slip.code} — ${slip.bookmakerName}'
              : 'GameClaw slip — ${slip.bookmakerName}',
        ),
      );
      return true;
    } catch (error, stack) {
      debugPrint('share slip: could not share ($error)\n$stack');
      return false;
    } finally {
      // Best effort, and deliberately after the sheet has returned rather than before: the
      // receiving app has had its chance to read the file by then, and leaving a picture of
      // somebody's betting slip in the cache is the thing being avoided.
      await _discard(file);
    }
  }

  static Future<void> _discard(File? file) async {
    if (file == null) return;
    try {
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Nothing useful to do, and nothing the user can act on.
    }
  }
}
