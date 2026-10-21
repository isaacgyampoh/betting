import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';

/// What fits in the clock column on a fixture row.
///
/// The column is sized for `90'`. When the ball is not in play the server sends the provider's own
/// phrase instead of a minute, and "Halftime" was rendering as "Half…" on a real Pixel - which
/// reads as a rendering bug rather than as a status.
///
/// The rule worth pinning is the last one: an unrecognised phrase is passed through untouched
/// rather than abbreviated on a guess. A truncated real status is honest; an invented initialism
/// is not, because nobody looking at it could tell it was wrong.
void main() {
  test('a minute is left exactly as it is', () {
    expect(shortLiveLabel("45'"), "45'");
    expect(shortLiveLabel("90'"), "90'");
    expect(shortLiveLabel('7'), '7');
  });

  test('the phrases the provider actually sends get a short form', () {
    expect(shortLiveLabel('Halftime'), 'HT');
    expect(shortLiveLabel('Break Time'), 'BRK');
    expect(shortLiveLabel('Extra Time'), 'ET');
    expect(shortLiveLabel('Penalty In Progress'), 'PENS');
    expect(shortLiveLabel('Match Suspended'), 'SUSP');
    expect(shortLiveLabel('Match Interrupted'), 'INT');
    expect(shortLiveLabel('First Half'), '1H');
    expect(shortLiveLabel('Second Half'), '2H');
  });

  test('case and surrounding space do not matter', () {
    expect(shortLiveLabel('  halftime '), 'HT');
    expect(shortLiveLabel('MATCH SUSPENDED'), 'SUSP');
  });

  test('an unknown phrase is passed through, not guessed at', () {
    // It will ellipse, which is the correct outcome: showing part of a true status beats
    // inventing an abbreviation that cannot be checked.
    expect(shortLiveLabel('Awaiting Updates'), 'Awaiting Updates');
    expect(shortLiveLabel('Technical Loss'), 'Technical Loss');
  });

  test('empty stays empty', () {
    expect(shortLiveLabel(''), '');
    expect(shortLiveLabel('   '), '');
  });
}
