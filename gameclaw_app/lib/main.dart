import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';
import 'data/appearance.dart';
import 'data/providers.dart';
import 'data/retry.dart';
import 'theme/tokens.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // The app owns the status bar: transparent, light icons, drawn over by our own canvas colour.
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
    await container.read(pushServiceProvider).attach(messaging);
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
      // Three themes, one chosen by the user. With ThemeMode.system, Flutter rebuilds on a
      // platform brightness change by itself, so switching the phone's appearance while the app
      // is open takes effect immediately - and the palette lerps, so it fades rather than snaps.
      theme: gcTheme(brightness: Brightness.light),
      darkTheme: gcTheme(brightness: Brightness.dark),
      themeMode: ref.watch(appearanceProvider).value ?? ThemeMode.system,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
