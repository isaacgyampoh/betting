import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/features/share/share_slip_action.dart';
import 'package:share_plus/share_plus.dart';

/// What actually reaches the share sheet.
///
/// The sheet itself is a platform channel and cannot run here, so it is injected. What is worth
/// asserting is everything around it: that an image file exists at the moment it is handed over,
/// that the code travels as text as well as in the picture, and that the file is gone afterwards.
/// That last one is the point - a picture of somebody's betting slip left in the cache is the
/// thing this is meant to avoid.
void main() {
  Slip slipFrom({String? code = 'K7F2QP', bool demo = false}) => Slip.fromJson({
    'id': 'abcd1234-2222-3333-4444-555555555555',
    'bookmaker': {'slug': 'sportybet', 'name': 'SportyBet'},
    'code': code,
    'demo': demo,
    'totalOdds': 3.42,
    'selectionCount': 2,
    'selections': [
      for (var i = 1; i <= 2; i++)
        {
          'position': i,
          'home': 'Home $i',
          'away': 'Away $i',
          'competition': 'Premier League',
          'kickoffAt': '2026-10-18T19:00:00.000Z',
          'marketLabel': '1X2',
          'pickLabel': 'Home $i',
          'odds': 1.85,
          'status': 'OK',
        },
    ],
    'warnings': <dynamic>[],
  });

  late Directory temp;
  setUp(() => temp = Directory.systemTemp.createTempSync('gc-share-test'));
  tearDown(() => temp.deleteSync(recursive: true));

  /// Records what was passed to the sheet, and whether the file was readable at that moment.
  ({ShareParams? params, int? bytesAtShareTime, bool existedAtShareTime}) captured = (
    params: null,
    bytesAtShareTime: null,
    existedAtShareTime: false,
  );

  SlipSharer sharerFor() => SlipSharer(
    cacheDir: () async => temp,
    share: (params) async {
      final path = params.files!.single.path;
      final file = File(path);
      final exists = file.existsSync();
      captured = (
        params: params,
        bytesAtShareTime: exists ? file.lengthSync() : null,
        existedAtShareTime: exists,
      );
      return const ShareResult('ok', ShareResultStatus.success);
    },
  );

  testWidgets('hands the sheet a real PNG file that exists while the sheet is open', (
    tester,
  ) async {
    final ok = (await tester.runAsync(() => sharerFor().shareSlip(slipFrom())))!;

    expect(ok, isTrue);
    expect(captured.existedAtShareTime, isTrue, reason: 'the receiving app has to be able to read it');
    expect(captured.bytesAtShareTime, greaterThan(1000), reason: 'a rendered card, not an empty file');
    expect(captured.params!.files!.single.mimeType, 'image/png');
  });

  testWidgets('names the file after the booking code, so an attachment is identifiable', (
    tester,
  ) async {
    await tester.runAsync(() => sharerFor().shareSlip(slipFrom(code: 'K7F2QP')));
    expect(captured.params!.files!.single.path, endsWith('gameclaw-slip-K7F2QP.png'));
  });

  testWidgets('falls back to the slip id when there is no code to name it after', (tester) async {
    await tester.runAsync(() => sharerFor().shareSlip(slipFrom(code: null)));
    expect(captured.params!.files!.single.path, endsWith('gameclaw-slip-abcd1234.png'));
  });

  testWidgets('sends the code as text as well, so it can be pasted rather than retyped', (
    tester,
  ) async {
    await tester.runAsync(() => sharerFor().shareSlip(slipFrom()));
    expect(captured.params!.text, contains('K7F2QP'));
    expect(captured.params!.subject, contains('K7F2QP'));
  });

  testWidgets('deletes the image once the sheet has closed', (tester) async {
    await tester.runAsync(() => sharerFor().shareSlip(slipFrom()));

    final path = captured.params!.files!.single.path;
    expect(File(path).existsSync(), isFalse, reason: 'no slip pictures left in the cache');
    expect(temp.listSync(), isEmpty);
  });

  testWidgets('reports failure rather than throwing when the sheet itself fails', (tester) async {
    final sharer = SlipSharer(
      cacheDir: () async => temp,
      share: (_) async => throw StateError('no activity found to handle the intent'),
    );

    final ok = (await tester.runAsync(() => sharer.shareSlip(slipFrom())))!;
    expect(ok, isFalse);
    // And still cleans up: a failed share must not leave the picture behind either.
    expect(temp.listSync(), isEmpty);
  });

  testWidgets('reports failure when the cache directory is unavailable', (tester) async {
    final sharer = SlipSharer(
      cacheDir: () async => throw const FileSystemException('no cache directory'),
      share: (_) async => const ShareResult('ok', ShareResultStatus.success),
    );

    final ok = (await tester.runAsync(() => sharer.shareSlip(slipFrom())))!;
    expect(ok, isFalse);
  });
}
