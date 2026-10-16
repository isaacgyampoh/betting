import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/ui/brand/gc_claw.dart';
import 'package:gameclaw_app/ui/motion.dart';

/// The mark replaces a sparkle - the house style of every AI feature shipped since 2023, which
/// said nothing about football or about this product. It is drawn rather than shipped as an
/// image so one piece of geometry serves the launcher icon, the tab bar and the launch moment.
void main() {
  Widget wrap(Widget child, {bool animations = true}) => MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(disableAnimations: !animations),
      child: Scaffold(body: Center(child: child)),
    ),
  );

  group('the mark', () {
    testWidgets('draws at the size it is given', (tester) async {
      await tester.pumpWidget(wrap(const GcClawMark(size: 40)));
      expect(tester.getSize(find.byType(GcClawMark)), const Size(40, 40));
    });

    testWidgets('takes the surrounding icon colour when none is given', (tester) async {
      await tester.pumpWidget(
        wrap(
          const IconTheme(
            data: IconThemeData(color: Color(0xFF123456)),
            child: GcClawMark(),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a partly drawn mark paints without error', (tester) async {
      for (final p in [0.0, 0.2, 0.5, 0.9, 1.0]) {
        await tester.pumpWidget(wrap(GcClawMark(size: 64, progress: p)));
        expect(tester.takeException(), isNull, reason: 'progress $p');
      }
    });

    testWidgets('progress outside 0..1 is clamped rather than throwing', (tester) async {
      await tester.pumpWidget(wrap(const GcClawMark(size: 32, progress: -3)));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(wrap(const GcClawMark(size: 32, progress: 7)));
      expect(tester.takeException(), isNull);
    });
  });

  group('the launch strike', () {
    testWidgets('animates, then reports it is done', (tester) async {
      var done = false;
      await tester.pumpWidget(wrap(GcLaunchMark(onDone: () => done = true)));
      expect(done, isFalse, reason: 'should not finish on the first frame');
      await tester.pumpAndSettle();
      expect(done, isTrue);
    });

    // Android's "Remove animations" is set by people who get vestibular symptoms from movement,
    // and by people on phones where every dropped frame is felt. The mark still appears.
    testWidgets('a phone that wants no movement gets the mark, not the strike', (tester) async {
      var done = false;
      await tester.pumpWidget(wrap(GcLaunchMark(onDone: () => done = true), animations: false));
      await tester.pump();
      expect(done, isTrue, reason: 'should be finished immediately, with no animation');
      expect(find.byType(GcClawMark), findsOneWidget);
    });
  });

  group('motion preference', () {
    testWidgets('is read from the platform', (tester) async {
      late bool allowed;
      await tester.pumpWidget(
        wrap(
          Builder(
            builder: (context) {
              allowed = gcMotionAllowed(context);
              return const SizedBox.shrink();
            },
          ),
          animations: false,
        ),
      );
      expect(allowed, isFalse);
    });

    testWidgets('collapses a duration to nothing when movement is off', (tester) async {
      late Duration off;
      late Duration on;
      await tester.pumpWidget(
        wrap(
          Builder(
            builder: (context) {
              off = gcDuration(context, const Duration(milliseconds: 300));
              return const SizedBox.shrink();
            },
          ),
          animations: false,
        ),
      );
      await tester.pumpWidget(
        wrap(
          Builder(
            builder: (context) {
              on = gcDuration(context, const Duration(milliseconds: 300));
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      expect(off, Duration.zero);
      expect(on, const Duration(milliseconds: 300));
    });
  });
}
