import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/features/share_import/shared_text.dart';

/// Reading a booking code out of whatever a bookmaker's app shared.
///
/// The failure that matters is not "we missed a code" - that one asks the user and recovers. It is
/// importing the wrong thing confidently: a word out of the marketing copy treated as a code,
/// loading somebody else's slip or nothing at all, while the screen says it worked.
///
/// So most of what follows is about when *not* to be sure.
void main() {
  group('a share that plainly contains a code', () {
    test('takes the code out of a share link, which the bookmaker named itself', () {
      final s = readSharedText('Check my bet https://www.sportybet.com/gh/?shareCode=K7F2QP');
      expect(s.confident?.code, 'K7F2QP');
      expect(s.confident!.confidence, greaterThanOrEqualTo(0.9));
      expect(s.bookmaker, 'sportybet');
    });

    test('takes a labelled code', () {
      final s = readSharedText('I just booked this! Booking code: A1B2C3 on MSport');
      expect(s.confident?.code, 'A1B2C3');
      expect(s.confident!.why, contains('booking code'));
    });

    test('reads the shorter label too', () {
      expect(readSharedText('Code: XY99ZZ').confident?.code, 'XY99ZZ');
    });

    test('is not confused by lower-case label text', () {
      expect(readSharedText('booking code k7f2qp').confident?.code, 'K7F2QP');
    });

    test('names the bookmaker when the text names exactly one', () {
      expect(readSharedText('Booking code: K7F2QP on SportyBet').bookmaker, 'sportybet');
      expect(readSharedText('Booking code: K7F2QP on Football.com').bookmaker, 'footballcom');
    });

    test('names no bookmaker when the text names two', () {
      // "Convert from SportyBet to MSport" names both. Picking one would be a guess.
      final s = readSharedText('Convert from SportyBet to MSport, code: K7F2QP');
      expect(s.bookmaker, isNull);
    });
  });

  group('what it refuses to be sure about', () {
    test('does not treat shouting in the marketing copy as a code', () {
      // Every one of these matches [A-Z0-9]{5,10} and would win on position alone.
      final s = readSharedText('CHECK MY WINNER TODAY! GOALS GALORE');
      expect(s.confident, isNull);
    });

    test('offers a bare token but will not act on it alone', () {
      final s = readSharedText('K7F2QP');
      expect(s.candidates, isNotEmpty);
      expect(s.confident, isNull, reason: 'nothing in the text says this is a booking code');
    });

    test('asks when two candidates are equally plausible', () {
      // Two labelled codes. Choosing the first would import an arbitrary one of them.
      final s = readSharedText('Booking code: AAA111 and booking code: BBB222');
      expect(s.candidates.length, greaterThanOrEqualTo(2));
      expect(s.confident, isNull);
    });

    test('finds nothing in text that contains no code at all', () {
      final s = readSharedText('Join me on the app! https://example.com/download');
      expect(s.confident, isNull);
    });

    test('returns empty for empty, whitespace or null input', () {
      for (final input in [null, '', '   ', '\n\t']) {
        final s = readSharedText(input);
        expect(s.isEmpty, isTrue, reason: 'input was ${input?.trim()}');
        expect(s.confident, isNull);
      }
    });

    test('does not invent a code from a URL with no code parameter', () {
      expect(readSharedText('https://www.sportybet.com/gh/sport/football').confident, isNull);
    });
  });

  group('shapes that really occur', () {
    test('survives emoji and punctuation around the code', () {
      expect(readSharedText('🔥 Booking code: K7F2QP 🔥 lets go!!!').confident?.code, 'K7F2QP');
    });

    test('survives a multi-line share', () {
      final s = readSharedText('''
My selections today
Arsenal vs Chelsea - Home
Spurs vs Everton - Over 2.5

Booking code: K7F2QP
Total odds: 3.42
''');
      expect(s.confident?.code, 'K7F2QP');
    });

    test('prefers the labelled code over an unlabelled token elsewhere', () {
      // "ABCDEF" appears first and looks like a code; the labelled one is the real one.
      final s = readSharedText('Shared from ABCDEF app. Booking code: K7F2QP');
      expect(s.confident?.code, 'K7F2QP');
    });

    test('keeps the raw text so the screen can show what arrived', () {
      const raw = 'nothing useful here';
      expect(readSharedText(raw).rawText, raw);
    });

    test('normalises a lower-case code from a link to upper case', () {
      expect(readSharedText('https://x.com/?shareCode=k7f2qp').confident?.code, 'K7F2QP');
    });
  });

  group('every candidate can be explained to the user', () {
    test('carries a reason, because the user may be asked to confirm it', () {
      final s = readSharedText('Booking code: K7F2QP, or try AB12CD');
      expect(s.candidates, isNotEmpty);
      for (final c in s.candidates) {
        expect(c.why.trim(), isNotEmpty);
        expect(c.confidence, inInclusiveRange(0, 1));
      }
    });

    test('orders candidates best first', () {
      final s = readSharedText('Booking code: K7F2QP, or try AB12CD');
      for (var i = 1; i < s.candidates.length; i++) {
        expect(s.candidates[i - 1].confidence, greaterThanOrEqualTo(s.candidates[i].confidence));
      }
    });
  });
}
