import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/theme/tokens.dart';
import 'package:gameclaw_app/ui/components/gc_button.dart';
import 'package:gameclaw_app/ui/components/gc_slip_card.dart';

/// Converting and booking are separate, and the card has to make that legible. A draft is not a
/// failure: everything expensive has already happened and what is left is one write the bookmaker
/// can refuse. What must never happen is a code appearing that nobody issued.
void main() {
  Map<String, dynamic> selection(int position, {String status = 'OK', double? odds = 1.85}) => {
    'position': position,
    'home': 'Home $position',
    'away': 'Away $position',
    'competition': 'Premier League',
    'kickoffAt': '2026-10-17T19:00:00.000Z',
    'marketLabel': '1X2',
    'pickLabel': 'Home $position',
    'odds': odds,
    'status': status,
  };

  Slip slipFrom({String? code, int count = 3, int unsupported = 0, bool demo = false}) =>
      Slip.fromJson({
        'id': '11111111-2222-3333-4444-555555555555',
        'bookmaker': {'slug': 'sportybet', 'name': 'SportyBet'},
        'code': code,
        'demo': demo,
        'totalOdds': 5.09,
        'selectionCount': count,
        'selections': [
          for (var i = 1; i <= count; i++)
            selection(i, status: i <= unsupported ? 'MARKET_NOT_FOUND' : 'OK'),
        ],
        'warnings': <dynamic>[],
      });

  Future<void> pump(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: gcTheme(brightness: Brightness.light),
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    );
  }

  group('a draft that has not been booked', () {
    testWidgets('says what the destination can carry, and that nothing is booked', (tester) async {
      await pump(tester, GcSlipCard(slip: slipFrom(count: 5, unsupported: 2), onBook: () async {}));

      expect(find.textContaining('can carry 3 of 5'), findsOneWidget);
      expect(find.textContaining('Nothing is booked yet'), findsOneWidget);
      expect(find.text('Get the booking code'), findsOneWidget);
    });

    testWidgets('says so plainly when everything carries', (tester) async {
      await pump(tester, GcSlipCard(slip: slipFrom(count: 3), onBook: () async {}));
      expect(find.textContaining('can carry all 3'), findsOneWidget);
    });

    testWidgets('will not offer to book when nothing can be carried', (tester) async {
      await pump(tester, GcSlipCard(slip: slipFrom(count: 2, unsupported: 2), onBook: () async {}));

      expect(find.text('Nothing to book'), findsOneWidget);
      final button = tester.widget<GcButton>(find.byType(GcButton));
      expect(button.onPressed, isNull, reason: 'there is nothing to book');
    });

    testWidgets('books once, and asks the caller rather than inventing a code', (tester) async {
      var booked = 0;
      await pump(tester, GcSlipCard(slip: slipFrom(), onBook: () async => booked++));

      await tester.tap(find.text('Get the booking code'));
      await tester.pumpAndSettle();

      expect(booked, 1);
      // Nothing resembling a code appeared on its own.
      expect(find.textContaining('BOOKING CODE'), findsNothing);
    });
  });

  group('a slip the bookmaker has issued a code for', () {
    testWidgets('shows the code and stops offering to book', (tester) async {
      await pump(
        tester,
        GcSlipCard(
          slip: slipFrom(code: 'APS016'),
          onBook: () async {},
        ),
      );

      expect(find.text('APS016'), findsOneWidget);
      expect(find.text('Get the booking code'), findsNothing);
    });

    // A code is those selections. Editing the list underneath it would make the card describe
    // something the code does not say.
    testWidgets('cannot have selections removed', (tester) async {
      await pump(
        tester,
        GcSlipCard(
          slip: slipFrom(code: 'APS016'),
          onRemove: (_) async {},
        ),
      );
      expect(find.byTooltip('Remove Home 1 v Away 1'), findsNothing);
    });

    testWidgets('a sample code is labelled before anything else', (tester) async {
      await pump(tester, GcSlipCard(slip: slipFrom(code: 'DEMO1', demo: true)));
      expect(find.textContaining('Sample data'), findsOneWidget);
    });
  });

  group('editing a draft', () {
    testWidgets('removes the selection the user pointed at, by its own number', (tester) async {
      final removed = <int>[];
      await pump(
        tester,
        GcSlipCard(slip: slipFrom(count: 3), onRemove: (p) async => removed.add(p)),
      );

      await tester.tap(find.byTooltip('Remove Home 2 v Away 2'));
      await tester.pumpAndSettle();

      expect(removed, [2]);
    });

    // Removing the only remaining selection is a delete by another name, and is not offered.
    testWidgets('will not remove the last selection', (tester) async {
      await pump(tester, GcSlipCard(slip: slipFrom(count: 1), onRemove: (_) async {}));
      expect(find.byTooltip('Remove Home 1 v Away 1'), findsNothing);
    });

    testWidgets('offers nothing to edit when the caller supplied no handler', (tester) async {
      await pump(tester, GcSlipCard(slip: slipFrom(count: 3)));
      expect(find.byTooltip('Remove Home 1 v Away 1'), findsNothing);
      expect(find.text('Get the booking code'), findsNothing);
    });
  });

  group('what is never invented', () {
    testWidgets('an unpriced selection shows a dash, not a zero', (tester) async {
      final slip = Slip.fromJson({
        'id': 'x',
        'bookmaker': {'slug': 'sportybet', 'name': 'SportyBet'},
        'code': null,
        'demo': false,
        'totalOdds': null,
        'selectionCount': 1,
        'selections': [selection(1, status: 'MARKET_NOT_FOUND', odds: null)],
        'warnings': <dynamic>[],
      });
      await pump(tester, GcSlipCard(slip: slip));

      expect(find.text('–'), findsOneWidget);
      expect(find.text('0.00'), findsNothing);
    });

    testWidgets('a selection the destination could not carry stays on the slip', (tester) async {
      await pump(tester, GcSlipCard(slip: slipFrom(count: 4, unsupported: 1)));

      expect(find.textContaining('Home 1 v Away 1'), findsOneWidget);
      expect(find.textContaining('1 of 4 could not be carried'), findsOneWidget);
    });
  });
}
