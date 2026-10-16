import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';
import 'ui/brand/gc_claw.dart';
import 'theme/palette.dart';
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
      builder: (context, child) => _Launch(child: child ?? const SizedBox.shrink()),
    );
  }
}

/// The mark, struck once, over the app while it settles.
///
/// Deliberately not a splash screen in the usual sense. The app is live underneath from the first
/// frame and nothing waits on this - it is a short overlay on a moment that would otherwise be an
/// empty canvas while the first day of fixtures arrives. It is gone in about two thirds of a
/// second, it never appears again, and a phone set to remove animations gets the mark without the
/// strike and the same brief pause.
///
/// The colours come from the live palette rather than constants, so a cold start in light mode
/// draws a deep olive claw on white and one in dark mode draws lime on near-black, matching the
/// window behind it instead of flashing against it.
class _Launch extends StatefulWidget {
  const _Launch({required this.child});

  final Widget child;

  @override
  State<_Launch> createState() => _LaunchState();
}

class _LaunchState extends State<_Launch> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (!_done)
          AnimatedOpacity(
            opacity: 1,
            duration: GcMotion.quick,
            child: ColoredBox(
              color: gc(context).canvas,
              child: Center(
                child: GcLaunchMark(
                  size: 96,
                  colour: gc(context).accentInk,
                  onDone: () {
                    if (mounted) setState(() => _done = true);
                  },
                ),
              ),
            ),
          ),
      ],
    );
  }
}
