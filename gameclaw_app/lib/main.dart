import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';
import 'data/providers.dart';
import 'data/retry.dart';
import 'theme/tokens.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // The app owns the status bar: transparent, light icons, drawn over by our own canvas colour.
  SystemChrome.setSystemUIOverlayStyle(gcSystemBars);
  // Edge to edge: the app paints its own background behind the system bars rather than leaving
  // two grey strips at the ends of a near-black screen.
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  // Firebase is optional. A build without google-services.json has no push and must still run:
  // a missing optional feature taking the whole app down on launch is the worst possible trade.
  FirebaseMessaging? messaging;
  try {
    await Firebase.initializeApp();
    messaging = FirebaseMessaging.instance;
  } on Exception catch (error) {
    debugPrint('push: Firebase not configured in this build ($error)');
  }

  final container = ProviderContainer(retry: gcRetry);
  if (messaging != null) {
    container.read(pushServiceProvider).attach(messaging);
    // Registering needs a session, so it waits for one rather than firing at launch.
    container.listen(isSignedInProvider, (_, signedIn) {
      if (signedIn) container.read(pushServiceProvider).register();
    }, fireImmediately: true);
  }

  runApp(UncontrolledProviderScope(container: container, child: const GameClawApp()));
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
