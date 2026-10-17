import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/features/slip_scan/slip_parser.dart';

/// Reading a slip out of whatever OCR made of a photograph.
///
/// The rule under all of these: never invent a field. A selection whose odds could not be read
/// carries a null and says so, because a plausible 1.85 produces a slip that converts cleanly
/// and is wrong - worse than one that visibly needs correcting.
void main() {
  group('odds', () {
    test('reads a decimal price', () {
      expect(readOdds('1.85'), 1.85);
      expect(readOdds('Odds 2.40'), 2.40);
      expect(readOdds('12,50'), 12.50); // comma decimal, common outside the UK
    });

    test('repairs the glyphs OCR reliably confuses', () {
      // "O" for zero is the single most common OCR error on a slip.
      expect(readOdds('2.O5'), 2.05);
      expect(readOdds('1O.50'), 10.50);
    });

    test('refuses numbers that are not odds', () {
      expect(readOdds('Stake 500'), isNull); // a bare integer is not odds
      expect(readOdds('45'), isNull); // a minute
      expect(readOdds('0.85'), isNull); // below 1.01, impossible as decimal odds
      expect(readOdds('no numbers here'), isNull);
    });
  });

  group('teams', () {
    test('splits on the separators slips actually use', () {
      for (final line in [
        'Arsenal vs Chelsea',
        'Arsenal v Chelsea',
        'Arsenal - Chelsea',
        'Arsenal x Chelsea',
      ]) {
        final teams = readTeams(line);
        expect(teams?.home, 'Arsenal', reason: line);
        expect(teams?.away, 'Chelsea', reason: line);
      }
    });

    test('does not read a market line as a fixture', () {
      // "Over 2.5 - 1.85" has a separator and two sides, and is not a match.
      expect(readTeams('Over 2.5 - 1.85'), isNull);
      expect(readTeams('1.85'), isNull);
    });
  });

  group('market', () {
    test('recognises the wordings slips use', () {
      expect(readMarket('Match Result'), '1X2');
      expect(readMarket('1X2'), '1X2');
      expect(readMarket('Both Teams To Score'), 'Both Teams To Score');
      expect(readMarket('GG/NG'), 'Both Teams To Score');
      expect(readMarket('Double Chance'), 'Double Chance');
      expect(readMarket('Total Goals'), 'Over/Under');
    });

    test('returns null rather than guessing', () {
      expect(readMarket('Arsenal'), isNull);
    });
  });

  group('booking code', () {
    test('reads a labelled code on the same line', () {
      expect(readBookingCode(['Booking Code: AB12CD']), 'AB12CD');
    });

    test('reads a labelled code on the next line', () {
      expect(readBookingCode(['Booking Code', 'XY99ZZ']), 'XY99ZZ');
    });

    test('does not mistake an unlabelled token for a code', () {
      // Without this, competition abbreviations and team short names become booking codes.
      expect(readBookingCode(['EPL', 'ARS', 'CHE']), isNull);
    });
  });

  group('a whole slip', () {
    const sportybet = '''
SportyBet
Bet Slip
Arsenal vs Chelsea
Match Result
Arsenal
1.85
Real Madrid vs Barcelona
Both Teams To Score
Yes
1.60
Total Odds
2.96
Booking Code: GC4T2P
''';

    test('reads the bookmaker, the code and both selections', () {
      final slip = parseSlip(sportybet);
      expect(slip.bookmaker, 'sportybet');
      expect(slip.bookingCode, 'GC4T2P');
      expect(slip.selections, hasLength(2));
      expect(slip.totalOdds, 2.96);
    });

    test('attaches the right market and odds to each selection', () {
      final slip = parseSlip(sportybet);
      final first = slip.selections.first;
      expect(first.home, 'Arsenal');
      expect(first.away, 'Chelsea');
      expect(first.market, '1X2');
      expect(first.odds, 1.85);
      expect(first.confidence, Confidence.high);

      final second = slip.selections[1];
      expect(second.home, 'Real Madrid');
      expect(second.market, 'Both Teams To Score');
      expect(second.odds, 1.60);
    });

    test('a selection with unreadable odds says so instead of inventing one', () {
      final slip = parseSlip('''
Arsenal vs Chelsea
Match Result
''');
      final only = slip.selections.single;
      expect(only.odds, isNull);
      expect(only.missing, contains('odds'));
      // Found the teams and the market, so it is not a guess - but it is not complete either.
      expect(only.confidence, Confidence.medium);
    });

    test('an image with no fixture in it yields nothing, not a blank selection', () {
      final slip = parseSlip('Total Stake\n500\nPotential Win\n1480');
      expect(slip.selections, isEmpty);
      expect(slip.isEmpty, isTrue);
    });

    test('keeps the raw lines so the user can see what was read', () {
      final slip = parseSlip(sportybet);
      // The review screen shows these next to a field it could not parse.
      expect(slip.selections.first.rawLines, contains('Arsenal vs Chelsea'));
      expect(slip.selections.first.rawLines, contains('1.85'));
    });

    test('survives a slip with no bookmaker name visible', () {
      final slip = parseSlip('Arsenal vs Chelsea\nMatch Result\n1.85');
      expect(slip.bookmaker, isNull);
      expect(slip.selections, hasLength(1));
    });

    test('reads a row where the price sits beside the pick', () {
      // What layout-aware reading produces: a right-aligned price joined to the row it prices.
      // Measured on the Pixel, where block-order text gave the last selection the first
      // selection's odds and left two selections with no price at all.
      final slip = parseSlip('''
Bournemouth vs Sunderland
Match Result
Bournemouth  1.85
Osasuna vs Racing Santander
Both Teams To Score
Yes  1.60
''');
      expect(slip.selections, hasLength(2));
      expect(slip.selections[0].odds, 1.85);
      expect(slip.selections[0].pick, 'Bournemouth');
      expect(slip.selections[1].odds, 1.60);
      expect(slip.selections[1].pick, 'Yes');
    });

    test('reads a three-selection slip without merging the legs', () {
      final slip = parseSlip('''
MSport
Liverpool vs Everton
1X2
1.50
Spurs vs Fulham
Double Chance
2.10
Leeds vs Burnley
Over/Under
Over 2.5
1.95
''');
      expect(slip.bookmaker, 'msport');
      expect(slip.selections, hasLength(3));
      expect(slip.selections.map((s) => s.odds), [1.50, 2.10, 1.95]);
    });
  });
}
