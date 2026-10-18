import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/router.dart';
import '../convert/convert_controller.dart';
import 'share_import.dart';

/// Turns an incoming share into the screen the user expects.
///
/// Wrapped around the app rather than placed on a screen, because a share can arrive before any
/// screen exists - it is what started the app - and while any screen is open.
///
/// There is deliberately no new import screen. A shared code goes to Convert and is loaded there
/// through the same path a pasted code takes, so the slip is read by the real adapter and shown
/// before anything is converted. A separate screen would be a second way to read a slip, which is
/// a second place for it to be wrong.
class ShareListener extends ConsumerStatefulWidget {
  const ShareListener({super.key, required this.child, ShareImporter? importer})
    : _importer = importer;

  final Widget child;
  final ShareImporter? _importer;

  @override
  ConsumerState<ShareListener> createState() => _ShareListenerState();
}

class _ShareListenerState extends ConsumerState<ShareListener> {
  late final ShareImporter _importer = widget._importer ?? ShareImporter();

  @override
  void initState() {
    super.initState();
    _importer.listen(_handle);
    // The share that launched the app. Read after the first frame so a route exists to go to.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final initial = await _importer.initial();
      if (initial != null && mounted) _handle(initial);
    });
  }

  @override
  void dispose() {
    _importer.dispose();
    super.dispose();
  }

  void _handle(ImportedShare share) {
    if (!mounted) return;
    final router = ref.read(routerProvider);

    // Nothing usable in it. Say so plainly: an import that silently does nothing reads as the app
    // being broken, and one that claims success reads worse.
    if (share.isEmpty) {
      _say('No booking code in what was shared. Paste it here instead.');
      router.go('/convert');
      return;
    }

    final sure = share.slip.confident;
    router.go('/convert');

    if (sure == null) {
      // Candidates exist but none is clearly the code - two equally good ones, or a bare token
      // with nothing to confirm it. Asking is the correct answer, not picking the first.
      final best = share.slip.candidates.first;
      _say('Not sure which code was shared. Check "${best.code}" before converting.');
      return;
    }

    // Load it the way a pasted code is loaded: the server detects the bookmaker from the code's
    // own shape, which is more reliable than a brand name in marketing copy. The name is passed
    // only when the text named exactly one.
    ref.read(convertProvider.notifier).load(sure.code, bookmaker: share.slip.bookmaker);
  }

  void _say(String message) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger
      ?..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 4)));
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
