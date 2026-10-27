import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/features/convert/convert_screen.dart';

/// The sentence under the "Booked on ..." headline, the only place a conversion reports what
/// actually happened. It has to survive two results that look like failures and are not: a slip
/// the destination could only partly carry, and a code that comes back unchanged.
void main() {
  String line({
    int carried = 3,
    int total = 3,
    String from = 'SportyBet',
    String to = 'Football.com',
    bool sameCode = false,
  }) => convertOutcomeLine(
    carried: carried,
    total: total,
    sourceBookmaker: from,
    destinationBookmaker: to,
    sameCode: sameCode,
  );

  group('what carried', () {
    test('a clean conversion says only that', () {
      expect(line(), '3 of 3 selections carried across.');
    });

    test('names how many did not, rather than leaving it to subtraction', () {
      expect(line(carried: 2, total: 5), contains('2 of 5 selections carried across.'));
      expect(line(carried: 2, total: 5), contains('3 could not be.'));
    });

    test('does not invent a loss when nothing was lost', () {
      expect(line(carried: 4, total: 4), isNot(contains('could not be')));
    });
  });

  // SportyBet and Football.com are separate sites on one platform and share the booking-code
  // namespace, so converting between them returns the code that was pasted in. Verified against
  // both sites' orders/share endpoint: AP6S8A resolved to the same selection on each. Without a
  // word of explanation, pasting AP6S8A and being shown AP6S8A is indistinguishable from the
  // conversion having silently done nothing.
  group('a code that comes back unchanged', () {
    test('is explained, not left to look like a failure', () {
      final text = line(sameCode: true);
      expect(text, contains('The code is unchanged'));
      expect(text, contains('share a booking platform'));
      expect(text, contains('opens on both'));
    });

    test('names both bookmakers, since which two share a platform is the whole point', () {
      final text = line(from: 'SportyBet', to: 'Football.com', sameCode: true);
      expect(text, contains('SportyBet'));
      expect(text, contains('Football.com'));
    });

    test('stays silent when the destination issued its own code', () {
      expect(line(sameCode: false), isNot(contains('share a booking platform')));
    });

    test('still reports a partial carry alongside the explanation', () {
      final text = line(carried: 1, total: 2, sameCode: true);
      expect(text, contains('1 of 2 selections carried across.'));
      expect(text, contains('1 could not be.'));
      expect(text, contains('The code is unchanged'));
    });
  });
}
