import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';
import 'package:gameclaw_app/features/share/special_slip_share.dart';
import 'package:share_plus/share_plus.dart';

/// Sharing the slip as one thing.
///
/// The picture is the one the server draws, downloaded rather than rendered on the phone, so every
/// recipient sees the same composition and it is not a screenshot of somebody's interface. These
/// check the parts a unit test can reach: the link, the text beside the picture, and that a failed
/// download is reported rather than opening an empty sheet.
SpecialSlip slipFrom({int legs = 2}) => SpecialSlip.fromJson({
  'reference': 'GC261105',
  'date': '2026-11-05',
  'combinedOdds': 2.03,
  'currentOdds': 2.03,
  'target': 2,
  'summary': '2 selections at 2.03.',
  'status': 'PENDING',
  'publishedAt': '2026-11-05T07:00:00.000Z',
  'lastVerifiedAt': '2026-11-05T07:30:00.000Z',
  'legs': [
    for (var i = 1; i <= legs; i++)
      {
        'position': i,
        'match': {
          'home': 'Home $i',
          'away': 'Away $i',
          'competition': 'Premier League',
          'country': 'England',
          'kickoffAt': '2026-11-05T19:45:00.000Z',
        },
        'market': {'kind': 'CORNERS', 'side': 'MATCH', 'label': 'Match corners', 'line': 9.5, 'outcome': 'OVER'},
        'price': {'bookmaker': 'sportybet', 'odds': 1.42, 'checkedAt': '2026-11-05T07:00:00.000Z'},
        'probability': 0.8,
        'confidence': 'medium',
        'reason': 'Over 9.5 in 7 of 8.',
        'evidence': {'sample': 8},
        'researchedAt': '2026-11-05T07:00:00.000Z',
        'status': 'PENDING',
        'actual': null,
      },
  ],
});

void main() {
  test('the link points at the public site, not the API host', () {
    expect(specialSlipUrl(slipFrom()), 'https://gameclaw.win/special/GC261105');
  });

  test('the text carries the reference, the price and every leg', () {
    final text = specialSlipText(slipFrom(legs: 3));

    expect(text, contains('GC261105'));
    expect(text, contains('3 selections at 2.03'));
    expect(text, contains('Home 1 v Away 1'));
    expect(text, contains('Home 3 v Away 3'));
    expect(text, contains('https://gameclaw.win/special/GC261105'));
  });

  test('nothing in the shared text claims a certainty', () {
    final text = specialSlipText(slipFrom()).toLowerCase();
    for (final word in ['guaranteed', 'certain', 'sure win', 'risk-free', 'banker']) {
      expect(text, isNot(contains(word)));
    }
  });

  test('shares one image for the whole slip, named after the reference', () async {
    final dir = await Directory.systemTemp.createTemp('gc-share');
    ShareParams? captured;

    final sharer = SpecialSlipSharer(
      get: (_) async => Uint8List.fromList(List.filled(64, 7)),
      cacheDir: () async => dir,
      share: (params) async {
        captured = params;
        return const ShareResult('ok', ShareResultStatus.success);
      },
    );

    expect(await sharer.shareSlip(slipFrom()), isTrue);
    expect(captured!.files, hasLength(1)); // one image, not one per match
    expect(captured!.files!.single.path, endsWith('gameclaw-GC261105.png'));
    expect(captured!.text, contains('GC261105'));
    await dir.delete(recursive: true);
  });

  test('reports a failure instead of opening an empty sheet', () async {
    var shared = false;
    final sharer = SpecialSlipSharer(
      get: (_) async => null, // the image could not be fetched
      cacheDir: () async => Directory.systemTemp,
      share: (_) async {
        shared = true;
        return const ShareResult('ok', ShareResultStatus.success);
      },
    );

    expect(await sharer.shareSlip(slipFrom()), isFalse);
    expect(shared, isFalse);
  });
}
