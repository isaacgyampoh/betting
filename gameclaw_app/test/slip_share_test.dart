import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/features/share/slip_share.dart';
import 'package:gameclaw_app/ui/components/gc_share_card.dart';

/// A shared slip is the one artefact that outlives the app's control of it.
///
/// Once a picture is in a WhatsApp thread it cannot be corrected, recalled or qualified by the
/// screen it came from. So the things that would be merely wrong in the app - an invented code, an
/// unlabelled sample, a quietly dropped leg - are tested here specifically, on the image and on
/// the text, because both travel and they travel separately.
void main() {
  Map<String, dynamic> selection(
    int position, {
    String status = 'OK',
    double? odds = 1.85,
    String home = 'Arsenal',
    String away = 'Chelsea',
  }) => {
    'position': position,
    'home': home,
    'away': away,
    'competition': 'Premier League',
    'kickoffAt': '2026-10-18T19:00:00.000Z',
    'marketLabel': '1X2',
    'pickLabel': home,
    'odds': odds,
    'status': status,
  };

  Slip slipFrom({
    String? code,
    int count = 3,
    int unsupported = 0,
    bool demo = false,
    double? totalOdds = 5.09,
    double? legOdds = 1.85,
  }) => Slip.fromJson({
    'id': '11111111-2222-3333-4444-555555555555',
    'bookmaker': {'slug': 'sportybet', 'name': 'SportyBet'},
    'code': code,
    'demo': demo,
    'totalOdds': totalOdds,
    'selectionCount': count,
    'selections': [
      for (var i = 1; i <= count; i++)
        selection(
          i,
          status: i <= unsupported ? 'MARKET_NOT_FOUND' : 'OK',
          odds: legOdds,
          home: 'Home $i',
          away: 'Away $i',
        ),
    ],
    'warnings': <dynamic>[],
  });

  Future<void> pumpCard(WidgetTester tester, Slip slip) => tester.pumpWidget(
    MediaQuery(
      data: const MediaQueryData(),
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: SingleChildScrollView(child: GcShareCard(slip: slip, capturedAt: DateTime(2026, 10, 18, 9, 30))),
      ),
    ),
  );

  group('the picture', () {
    testWidgets('renders off-screen to a PNG at the width we asked for', (tester) async {
      // runAsync, not a bare await: rasterising goes out to the engine, and the fake clock a
      // widget test runs on never lets that future complete.
      final png = (await tester.runAsync(
        () => renderToPng(
          GcShareCard(slip: slipFrom(code: 'ABC123'), capturedAt: DateTime(2026, 10, 18)),
          width: GcShareCard.width,
          pixelRatio: 2,
        ),
      ))!;

      // A real PNG, not an empty buffer: the 8-byte signature every PNG starts with.
      expect(png.sublist(0, 8), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

      // Width and height live big-endian in the IHDR chunk, bytes 16..24.
      int be32(int at) => (png[at] << 24) | (png[at + 1] << 16) | (png[at + 2] << 8) | png[at + 3];
      expect(be32(16), (GcShareCard.width * 2).round(), reason: '540 logical at 2x is 1080px');

      // The card sizes itself to its contents, so the height is not a fixed number - but it has
      // to be a real one. A three-leg slip comes out 886px tall; anything under a few hundred
      // would mean the content had collapsed.
      expect(be32(20), greaterThan(400));
    });

    testWidgets('a slip with more selections produces a taller image', (tester) async {
      int heightOf(List<int> png) =>
          (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];

      final short = (await tester.runAsync(
        () => renderToPng(
          GcShareCard(slip: slipFrom(count: 2), capturedAt: DateTime(2026, 10, 18)),
          width: GcShareCard.width,
        ),
      ))!;
      final long = (await tester.runAsync(
        () => renderToPng(
          GcShareCard(slip: slipFrom(count: 8), capturedAt: DateTime(2026, 10, 18)),
          width: GcShareCard.width,
        ),
      ))!;

      expect(heightOf(long), greaterThan(heightOf(short)));
    });

    testWidgets('the width does not depend on the device the share came from', (tester) async {
      // A phone far narrower than the card. A screenshot-based approach would come out 320px
      // wide; this must not.
      tester.view.physicalSize = const Size(320, 480);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      final png = (await tester.runAsync(
        () => renderToPng(
          GcShareCard(slip: slipFrom(code: 'ABC123'), capturedAt: DateTime(2026, 10, 18)),
          width: GcShareCard.width,
          pixelRatio: 2,
        ),
      ))!;
      final width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
      expect(width, 1080);
    });
  });

  group('what the card says', () {
    testWidgets('shows a code the bookmaker issued, and names the bookmaker', (tester) async {
      await pumpCard(tester, slipFrom(code: 'K7F2QP'));
      expect(find.text('K7F2QP'), findsOneWidget);
      expect(find.text('BOOKING CODE'), findsOneWidget);
      expect(find.textContaining('at SportyBet'), findsOneWidget);
    });

    testWidgets('invents nothing when there is no code, and says it is not booked', (tester) async {
      await pumpCard(tester, slipFrom(code: null));
      expect(find.text('BOOKING CODE'), findsNothing);
      expect(find.textContaining('Built, not booked'), findsOneWidget);
      // The bookmaker name takes the headline slot instead of an empty code box.
      expect(find.text('SportyBet'), findsOneWidget);
    });

    testWidgets('labels sample data before anything else on the card', (tester) async {
      await pumpCard(tester, slipFrom(code: 'MOCK01', demo: true));
      expect(find.textContaining('SAMPLE DATA'), findsOneWidget);
    });

    testWidgets('a real slip carries no sample label', (tester) async {
      await pumpCard(tester, slipFrom(code: 'K7F2QP'));
      expect(find.textContaining('SAMPLE DATA'), findsNothing);
    });

    testWidgets('keeps a leg the bookmaker could not carry, and marks it', (tester) async {
      await pumpCard(tester, slipFrom(code: 'K7F2QP', count: 5, unsupported: 2));

      // Still listed - all five fixtures are on the card.
      for (var i = 1; i <= 5; i++) {
        expect(find.text('Home $i v Away $i'), findsOneWidget);
      }
      expect(find.textContaining('not carried across'), findsNWidgets(2));
      expect(find.textContaining('2 of 5 could not be carried across'), findsOneWidget);
    });

    testWidgets('an unpriced leg shows a dash, never a zero', (tester) async {
      await pumpCard(tester, slipFrom(code: 'K7F2QP', count: 1, legOdds: null));
      expect(find.text('—'), findsOneWidget);
      expect(find.text('0.00'), findsNothing);
    });

    testWidgets('carries the mark, the address and the age statement', (tester) async {
      await pumpCard(tester, slipFrom(code: 'K7F2QP'));
      expect(find.text('GameClaw'), findsOneWidget);
      expect(find.text('gameclaw.win'), findsOneWidget);
      expect(find.text('18+'), findsOneWidget);
      expect(find.textContaining('Bet responsibly'), findsOneWidget);
    });

    testWidgets('omits the total odds row when the slip has no total', (tester) async {
      await pumpCard(tester, slipFrom(code: 'K7F2QP', totalOdds: null));
      expect(find.text('TOTAL ODDS'), findsNothing);
    });
  });

  group('the message that travels with it', () {
    test('leads with the code so it can be copied, not retyped from a picture', () {
      final text = shareTextFor(slipFrom(code: 'K7F2QP'));
      expect(text, contains('K7F2QP'));
      expect(text, contains('SportyBet'));
      expect(text.split('\n').first, contains('K7F2QP'));
    });

    test('says a sample is a sample in the text too, not only on the image', () {
      // The image can be cropped away by a notification preview or a reply quote; the warning
      // has to survive on its own.
      final text = shareTextFor(slipFrom(code: 'MOCK01', demo: true));
      expect(text, contains('SAMPLE DATA'));
      expect(text.indexOf('SAMPLE DATA'), lessThan(text.indexOf('MOCK01')));
    });

    test('offers no code when none was issued', () {
      final text = shareTextFor(slipFrom(code: null));
      expect(text, contains('built, not booked'));
      expect(text, isNot(contains('booking code')));
    });

    test('reports dropped legs rather than only the ones that survived', () {
      final text = shareTextFor(slipFrom(code: 'K7F2QP', count: 5, unsupported: 2));
      expect(text, contains('2 of 5 could not be carried across'));
    });

    test('states the odds and the leg count, and claims nothing about winning', () {
      final text = shareTextFor(slipFrom(code: 'K7F2QP', count: 3));
      expect(text, contains('3 selections at 5.09'));
      // No promise about the outcome. Checked against the phrasings that would be a claim: a
      // bare 'win' substring is useless here, because the address itself is gameclaw.win.
      for (final claim in [
        'guarantee',
        'sure thing',
        'will win',
        'cannot lose',
        "can't lose",
        'banker',
      ]) {
        expect(text.toLowerCase(), isNot(contains(claim)), reason: 'must not promise an outcome');
      }
    });

    test('a single selection is not called "1 selections"', () {
      expect(shareTextFor(slipFrom(code: 'A', count: 1)), contains('1 selection at'));
    });

    test('carries the age statement and the address', () {
      final text = shareTextFor(slipFrom(code: 'K7F2QP'));
      expect(text, contains('18+'));
      expect(text, contains('gameclaw.win'));
    });
  });

  group('building both halves together', () {
    testWidgets('returns a PNG and its message from one slip', (tester) async {
      final share = (await tester.runAsync(
        () => buildSlipShare(
          slipFrom(code: 'K7F2QP'),
          capturedAt: DateTime(2026, 10, 18, 9, 30),
        ),
      ))!;
      expect(share.image.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47]);
      expect(share.text, contains('K7F2QP'));
    });
  });
}
