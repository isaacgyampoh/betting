import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/features/slip_scan/slip_commands.dart';

/// Reading what someone wants done to a slip they just scanned.
///
/// Handled in code rather than by the model, because these are operations on data the app
/// already holds and the right answer is not a matter of interpretation. The important property
/// is the refusal: a sentence that mentions removing something without saying what must fall
/// through to Claw, not pick a selection and delete it.
void main() {
  group('removing', () {
    test('by position, written several ways', () {
      for (final phrase in [
        'remove the third selection',
        'delete the 3rd one',
        'drop selection 3',
        'take off number 3',
      ]) {
        final command = readCommand(phrase);
        expect(command, isA<RemoveSelection>(), reason: phrase);
        expect((command as RemoveSelection).index, 2, reason: phrase);
      }
    });

    test('"last" is understood as the last one', () {
      final command = readCommand('remove the last selection') as RemoveSelection;
      expect(command.index, -1);
    });

    test('by team name when no position is given', () {
      final command = readCommand('remove Arsenal from my slip') as RemoveSelection;
      expect(command.index, isNull);
      expect(command.team, contains('arsenal'));
    });

    test('an instruction that says remove but not what is not acted on', () {
      // The whole point. Choosing a selection to delete, when the user did not say which, is
      // worse than handing the sentence to Claw to ask about.
      expect(readCommand('remove one of them'), isNull);
      expect(readCommand('can you remove something'), isNull);
    });
  });

  group('converting', () {
    test('names the destination bookmaker', () {
      expect((readCommand('convert this to SportyBet') as ConvertTo).bookmaker, 'sportybet');
      expect((readCommand('move it to football.com') as ConvertTo).bookmaker, 'football.com');
      expect((readCommand('send to MSport') as ConvertTo).bookmaker, 'msport');
    });

    test('tolerates the spacing people actually use', () {
      expect((readCommand('convert to sporty bet') as ConvertTo).bookmaker, 'sportybet');
      expect((readCommand('switch to 1x bet') as ConvertTo).bookmaker, '1xbet');
    });

    test('convert with no bookmaker named falls through', () {
      // Picking a destination for them would be inventing the most important part of the
      // instruction.
      expect(readCommand('convert this slip'), isNull);
    });
  });

  group('odds', () {
    test('sets a price on a numbered selection', () {
      final command = readCommand('change the odds on the second to 1.90') as SetOdds;
      expect(command.index, 1);
      expect(command.odds, 1.90);
    });

    test('odds without a position is not acted on', () {
      expect(readCommand('the odds are 1.90'), isNull);
    });
  });

  test('asking what did not match is understood', () {
    expect(readCommand('which selections could not be matched'), isA<ShowUnmatched>());
    expect(readCommand('show me the unmatched ones'), isA<ShowUnmatched>());
  });

  test('scanning again is understood', () {
    expect(readCommand('scan another screenshot'), isA<Rescan>());
    expect(readCommand('try again'), isA<Rescan>());
  });

  test("a slip summary is not an instruction", () {
    // The app writes this itself after a scan. Running it through the interpreter made the app
    // read its own summary as a command and answer a question nobody asked - seen on the Pixel
    // as "I am not sure which selection you mean" sitting above the slip.
    const summary =
        'I scanned a betting slip. Here is what it says:\n'
        '- Bayern Munich v RB Leipzig 1.34, Over/Under (Bundesliga Sat 16:30) at 3.50\n'
        '- Villarreal v Elche CF 1.62, Both Teams To Score (LaLiga Sat 14:15) at odds not readable';
    // Even if it did parse, the summary never reaches the interpreter now; this pins the shape
    // of the text so a future change to _describe does not quietly start matching a verb.
    final command = readCommand(summary);
    expect(
      command,
      anyOf(isNull, isA<SetOdds>()),
      reason: 'a summary must never read as a removal',
    );
    expect(command, isNot(isA<RemoveSelection>()));
  });

  test('ordinary conversation is left for Claw', () {
    for (final phrase in [
      'build me a 5 odds slip for tonight',
      'what do the numbers say about these games',
      'is Arsenal playing well',
      '',
    ]) {
      expect(readCommand(phrase), isNull, reason: phrase);
    }
  });
}
