import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/theme/palette.dart';
import 'package:gameclaw_app/theme/tokens.dart';
import 'package:gameclaw_app/ui/components/gc_fixture_row.dart';
import 'package:gameclaw_app/ui/components/gc_states.dart';

/// The app was dark-only. These pin the two things that break when a second appearance is added:
/// a colour that is legible on one background and invisible on the other, and a widget that
/// reads a hard-coded constant instead of the theme.
void main() {
  /// Contrast ratio, per WCAG. Used to assert that text can actually be read.
  double contrast(Color a, Color b) {
    double channel(double c) => c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
    double luminance(Color c) =>
        0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    final la = luminance(a), lb = luminance(b);
    final hi = la > lb ? la : lb, lo = la > lb ? lb : la;
    return (hi + 0.05) / (lo + 0.05);
  }

  group('both palettes are actually readable', () {
    for (final (name, p) in [('dark', GcPalette.dark), ('light', GcPalette.light)]) {
      test('$name: body text on the canvas clears 7:1', () {
        expect(contrast(p.ink, p.canvas), greaterThan(7.0));
      });

      test('$name: muted text on the canvas clears 4.5:1', () {
        expect(contrast(p.inkMuted, p.canvas), greaterThan(4.5));
      });

      test('$name: text on an accent fill clears 4.5:1', () {
        expect(contrast(p.onAccent, p.accent), greaterThan(4.5));
      });

      test('$name: accent text on the canvas clears 4.5:1', () {
        // The reason accentInk exists. The lime fill is the brand and works as a block of
        // colour on either background; the same lime as TEXT on white is about 1.3:1, which is
        // not a colour choice, it is an invisible one.
        expect(contrast(p.accentInk, p.canvas), greaterThan(4.5));
      });

      test('$name: outcome colours are legible on the canvas', () {
        for (final c in [p.win, p.loss, p.warn]) {
          expect(contrast(c, p.canvas), greaterThan(3.0));
        }
      });
    }

    test('the light palette is genuinely light and the dark one genuinely dark', () {
      expect(GcPalette.light.canvas.computeLuminance(), greaterThan(0.8));
      expect(GcPalette.dark.canvas.computeLuminance(), lessThan(0.05));
    });

    test('lime as text would have failed, which is why it is not used that way', () {
      // Guards the mistake directly: if someone sets light.accentInk back to the fill lime,
      // the assertion above starts failing and this explains why.
      expect(contrast(GcPalette.dark.accent, GcPalette.light.canvas), lessThan(2.0));
    });
  });

  group('the theme carries the palette', () {
    test('each brightness ships its own extension', () {
      final dark = gcTheme(brightness: Brightness.dark).extension<GcPalette>();
      final light = gcTheme(brightness: Brightness.light).extension<GcPalette>();
      expect(dark, GcPalette.dark);
      expect(light, GcPalette.light);
      expect(dark!.canvas, isNot(light!.canvas));
    });

    test('a theme change interpolates rather than snapping', () {
      final half = GcPalette.dark.lerp(GcPalette.light, 0.5);
      expect(half.canvas, isNot(GcPalette.dark.canvas));
      expect(half.canvas, isNot(GcPalette.light.canvas));
    });

    test('system bar icons contrast with the canvas behind them', () {
      // Light icons on a light status bar is an invisible clock.
      expect(gcSystemBarsFor(Brightness.dark).statusBarIconBrightness, Brightness.light);
      expect(gcSystemBarsFor(Brightness.light).statusBarIconBrightness, Brightness.dark);
    });
  });

  group('widgets follow the theme rather than a constant', () {
    Fixture fixture() => Fixture.fromJson({
      'id': 1,
      'kickoffAt': '2026-10-16T18:45:00.000Z',
      'status': 'FINISHED',
      'statusLabel': 'Match Finished',
      'league': {'id': 1, 'name': 'A-League', 'country': 'Australia'},
      'home': {'id': 1, 'name': 'Sydney'},
      'away': {'id': 2, 'name': 'Melbourne'},
      'goals': {'home': 2, 'away': 1},
    });

    Future<Color> canvasUnder(WidgetTester tester, Brightness brightness, Widget child) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: gcTheme(brightness: brightness),
          home: Builder(
            builder: (context) => Scaffold(backgroundColor: gc(context).canvas, body: child),
          ),
        ),
      );
      // MaterialApp animates between themes, and the palette lerps with it, so the first frame
      // after a switch is still part-way between the two. Settling is what the real app does
      // over about 200ms; asserting before it is asserting on a transition.
      await tester.pumpAndSettle();
      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      return scaffold.backgroundColor!;
    }

    testWidgets('a fixture row renders in both appearances without overflow', (tester) async {
      for (final brightness in [Brightness.dark, Brightness.light]) {
        final canvas = await canvasUnder(tester, brightness, GcFixtureRow(fixture: fixture()));
        expect(tester.takeException(), isNull);
        expect(
          canvas,
          brightness == Brightness.dark ? GcPalette.dark.canvas : GcPalette.light.canvas,
        );
      }
    });

    testWidgets('an empty state renders in both appearances', (tester) async {
      for (final brightness in [Brightness.dark, Brightness.light]) {
        await canvasUnder(
          tester,
          brightness,
          const GcEmpty(title: 'Nothing here', note: 'Try another day.'),
        );
        expect(tester.takeException(), isNull);
        expect(find.text('Nothing here'), findsOneWidget);
      }
    });
  });
}

/// Local pow, so the test has no dependency beyond the framework.
double pow(double x, double exp) {
  var result = 1.0;
  // Only ever called with 2.4; a simple exp/ln is enough and keeps this dependency-free.
  result = _exp(exp * _ln(x));
  return result;
}

double _ln(double x) {
  if (x <= 0) return double.negativeInfinity;
  var result = 0.0;
  var value = x;
  while (value > 2) {
    value /= 2.718281828459045;
    result += 1;
  }
  while (value < 0.5) {
    value *= 2.718281828459045;
    result -= 1;
  }
  final z = (value - 1) / (value + 1);
  var term = z;
  var sum = 0.0;
  for (var n = 1; n < 60; n += 2) {
    sum += term / n;
    term *= z * z;
  }
  return result + 2 * sum;
}

double _exp(double x) {
  var sum = 1.0;
  var term = 1.0;
  for (var n = 1; n < 60; n++) {
    term *= x / n;
    sum += term;
  }
  return sum;
}
