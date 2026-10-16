import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';
import 'data/retry.dart';
import 'theme/tokens.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // The app owns the status bar: transparent, light icons, drawn over by our own canvas colour.
  SystemChrome.setSystemUIOverlayStyle(gcSystemBars);
  // Edge to edge: the app paints its own background behind the system bars rather than leaving
  // two grey strips at the ends of a near-black screen.
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  runApp(const ProviderScope(retry: gcRetry, child: GameClawApp()));
}

class GameClawApp extends ConsumerWidget {
  const GameClawApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'GameClaw',
      debugShowCheckedModeBanner: false,
      theme: gcTheme(),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
