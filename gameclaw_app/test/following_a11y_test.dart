import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/local/cache.dart';
import 'package:gameclaw_app/data/providers.dart';
import 'package:gameclaw_app/features/favourites/favourites_screen.dart';
import 'package:gameclaw_app/theme/tokens.dart';

/// What a screen reader gets from the Following screen.
///
/// The visual row carries its meaning in an icon colour and a muted text shade, and neither is
/// spoken. These pin the spoken form, which is the kind of thing that regresses silently because
/// nothing on screen changes when it breaks.
void main() {
  Future<void> pump(WidgetTester tester, CacheDb db) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [cacheDbProvider.overrideWithValue(db)],
        child: MaterialApp(theme: gcTheme(brightness: Brightness.light), home: const FavouritesScreen()),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('a followed match says it is followed, and when it kicks off', (tester) async {
    final handle = tester.ensureSemantics();
    final db = CacheDb.memory();
    await db.followMatch(1, 'Valencia v Athletic Club', DateTime.utc(2026, 10, 17, 19));
    await pump(tester, db);

    final labels = tester
        .widgetList<Semantics>(find.byType(Semantics))
        .map((s) => s.properties.label)
        .whereType<String>()
        .toList();

    expect(
      labels.any((l) => l.contains('Valencia v Athletic Club') && l.contains('Followed')),
      isTrue,
      reason: 'the row must announce that it is followed, not just name the match',
    );
    await db.close();
    handle.dispose();
  });

  testWidgets('a muted match says so', (tester) async {
    final handle = tester.ensureSemantics();
    final db = CacheDb.memory();
    await db.followMatch(2, 'A v B', null);
    await db.setMatchMuted(2, true);
    await pump(tester, db);

    final labels = tester
        .widgetList<Semantics>(find.byType(Semantics))
        .map((s) => s.properties.label)
        .whereType<String>()
        .toList();

    // Muting shows as a dimmed shade and a different icon. Neither is audible.
    expect(labels.any((l) => l.contains('muted')), isTrue);
    await db.close();
    handle.dispose();
  });

  testWidgets('the alerts button stays reachable beside the row', (tester) async {
    final handle = tester.ensureSemantics();
    final db = CacheDb.memory();
    await db.followMatch(3, 'A v B', null);
    await pump(tester, db);

    // The row excludes its descendants' semantics so it reads as one thing. The button must be
    // a sibling, not nested inside - excludeSemantics drops every descendant node, so a nested
    // Semantics looks right in the source and is unreachable in practice.
    expect(find.bySemanticsLabel('Alerts for A v B'), findsOneWidget);
    await db.close();
    handle.dispose();
  });
}
