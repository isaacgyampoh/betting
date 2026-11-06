import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../domain/models.dart';

/// Where the website lives, which is not where the API lives.
///
/// The share link has to be one a recipient can open, so it points at the public site rather than
/// at the API host the app talks to. Set at build time with `--dart-define=GC_SITE_BASE=...`.
const kSiteBase = String.fromEnvironment('GC_SITE_BASE', defaultValue: 'https://gameclaw.win');

String specialSlipUrl(SpecialSlip slip) => '$kSiteBase/special/${slip.reference}';

/// What travels alongside the picture, for whoever pastes rather than looks.
String specialSlipText(SpecialSlip slip) {
  final legs = slip.legs.map((l) => '${l.home} v ${l.away} — ${l.marketLabel.toLowerCase()} ${l.selection}').join('\n');
  return 'gameclaw Daily Special Slip ${slip.reference}\n'
      '${slip.legs.length} selections at ${slip.combinedOdds.toStringAsFixed(2)}\n\n'
      '$legs\n\n${specialSlipUrl(slip)}';
}

/// Shares the slip as one image.
///
/// The picture is the one the server draws, downloaded rather than rendered here. That is the
/// whole point of it: every recipient sees the same composition whatever phone sent it, and it is
/// not a screenshot of somebody's interface at their font size in their theme. It also means the
/// image a link unfurls to and the image that lands in a chat are the same file.
class SpecialSlipSharer {
  const SpecialSlipSharer({
    this.share = _systemShare,
    this.cacheDir = getTemporaryDirectory,
    this.get = _fetch,
  });

  final Future<ShareResult> Function(ShareParams params) share;
  final Future<Directory> Function() cacheDir;
  final Future<Uint8List?> Function(Uri url) get;

  static Future<ShareResult> _systemShare(ShareParams params) => SharePlus.instance.share(params);

  static Future<Uint8List?> _fetch(Uri url) async {
    final res = await Dio().getUri<List<int>>(
      url,
      options: Options(responseType: ResponseType.bytes, validateStatus: (s) => s != null && s < 500),
    );
    return res.statusCode == 200 && res.data != null ? Uint8List.fromList(res.data!) : null;
  }

  /// Returns false when the picture could not be fetched, so the caller can say so rather than
  /// opening an empty sheet. A share that silently does nothing reads as the app being broken.
  Future<bool> shareSlip(SpecialSlip slip) async {
    try {
      final bytes = await get(Uri.parse('${specialSlipUrl(slip)}/image'));
      if (bytes == null || bytes.isEmpty) return false;

      // Through a real file: Android's share intent hands the receiving app a path and reads it
      // after this process has moved on, so the bytes have to be somewhere it can still reach.
      final dir = await cacheDir();
      final file = File(p.join(dir.path, 'gameclaw-${slip.reference}.png'));
      await file.writeAsBytes(bytes, flush: true);

      await share(
        ShareParams(
          files: [XFile(file.path, mimeType: 'image/png')],
          text: specialSlipText(slip),
          subject: 'gameclaw Daily Special Slip ${slip.reference}',
        ),
      );
      return true;
    } catch (error, stack) {
      debugPrint('special slip share failed: $error\n$stack');
      return false;
    }
  }
}
