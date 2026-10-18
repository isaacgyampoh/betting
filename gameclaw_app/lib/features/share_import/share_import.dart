import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

import 'shared_text.dart';

/// What arrives when somebody shares into GameClaw.
///
/// Two paths, and both have to work: a share that starts the app from cold, and a share that
/// arrives while it is already running. The first is a Future read once at startup, the second a
/// Stream for the rest of the session. Handling only one of them produces a feature that works
/// exactly half the time, in a way nobody can reproduce on purpose.
@immutable
class ImportedShare {
  const ImportedShare({required this.slip, required this.receivedAt});

  final SharedSlip slip;
  final DateTime receivedAt;

  /// Nothing usable arrived. The screen says so rather than claiming an import.
  bool get isEmpty => slip.isEmpty;
}

/// Reads shares and hands them on, once each.
///
/// `reset()` is called after every delivery because the plugin keeps returning the same initial
/// intent until it is cleared. Without it, every cold start re-imports the last thing anybody
/// shared - which looks like the app inventing a slip out of nothing.
class ShareImporter {
  ShareImporter({ReceiveSharingIntent? intent}) : _intent = intent ?? ReceiveSharingIntent.instance;

  final ReceiveSharingIntent _intent;
  StreamSubscription<List<SharedMediaFile>>? _sub;

  /// The share that launched the app, if any. Safe to call when there was none.
  Future<ImportedShare?> initial() async {
    try {
      final media = await _intent.getInitialMedia();
      final share = _read(media);
      if (share != null) await _intent.reset();
      return share;
    } catch (error) {
      // A share that cannot be read is not a crash. The app opens normally and the user pastes.
      debugPrint('share import: could not read the initial share ($error)');
      return null;
    }
  }

  /// Shares that arrive while the app is already open.
  void listen(void Function(ImportedShare) onShare) {
    _sub?.cancel();
    _sub = _intent.getMediaStream().listen(
      (media) {
        final share = _read(media);
        if (share != null) {
          onShare(share);
          _intent.reset();
        }
      },
      onError: (Object error) => debugPrint('share import: stream failed ($error)'),
    );
  }

  Future<void> dispose() async {
    await _sub?.cancel();
    _sub = null;
  }

  /// Turns what the platform handed over into text we can read.
  ///
  /// Only text is accepted. The manifest asks for `text/plain` and nothing else, so anything
  /// arriving here that is not text is a surprise rather than a case to handle - and silently
  /// treating a shared image as an empty slip would be worse than ignoring it, because the user
  /// would see an import that found nothing instead of nothing happening.
  static ImportedShare? _read(List<SharedMediaFile> media) {
    if (media.isEmpty) return null;
    final text = media
        .where((m) => m.type == SharedMediaType.text || m.type == SharedMediaType.url)
        // The plugin carries a text share's content in `path`, and some senders put a title or
        // caption in `message`. Both are worth reading: the code can be in either.
        .map((m) => [m.path, m.message ?? ''].where((s) => s.trim().isNotEmpty).join('\n'))
        .where((s) => s.trim().isNotEmpty)
        .join('\n')
        .trim();

    if (text.isEmpty) return null;
    return ImportedShare(slip: readSharedText(text), receivedAt: DateTime.now());
  }
}
