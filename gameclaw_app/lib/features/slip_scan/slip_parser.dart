/// Reading a betting slip out of recognised text.
///
/// The input is whatever OCR made of a photograph: line breaks in odd places, `0` read as `O`,
/// a team name cut off by the edge of the screenshot. The output is a set of *candidates*, each
/// of which says how sure it is and which fields it could not read at all.
///
/// The rule that shapes all of this: **never invent a field**. A selection whose odds were
/// unreadable carries a null and says so on the review screen. Filling in a plausible 1.85
/// because most odds look like that would produce a slip that converts cleanly and is wrong,
/// which is worse than one that visibly needs a correction.
library;

/// How much of a parsed value can be trusted.
enum Confidence {
  /// Read directly and unambiguously, e.g. "1.85" on its own line next to a selection.
  high,

  /// Read, but with a judgement call - a team name matched loosely, odds reconstructed from a
  /// line that also held other numbers.
  medium,

  /// A guess worth showing so the user can correct it, never worth acting on silently.
  low,
}

/// One line of a slip as the parser understood it.
class ParsedSelection {
  const ParsedSelection({
    required this.rawLines,
    this.home,
    this.away,
    this.competition,
    this.market,
    this.pick,
    this.odds,
    this.kickoff,
    this.confidence = Confidence.low,
  });

  /// Exactly what OCR produced for this block, kept so the review screen can show the user what
  /// was read when a field is wrong or missing.
  final List<String> rawLines;

  final String? home;
  final String? away;
  final String? competition;
  final String? market;
  final String? pick;
  final double? odds;
  final DateTime? kickoff;
  final Confidence confidence;

  /// Fields that could not be read. Shown as "not readable", never as a blank or a zero.
  List<String> get missing => [
    if (home == null || away == null) 'teams',
    if (market == null) 'market',
    if (odds == null) 'odds',
  ];

  bool get isUsable => home != null && away != null;

  ParsedSelection copyWith({
    String? home,
    String? away,
    String? competition,
    String? market,
    String? pick,
    double? odds,
    DateTime? kickoff,
    Confidence? confidence,
  }) => ParsedSelection(
    rawLines: rawLines,
    home: home ?? this.home,
    away: away ?? this.away,
    competition: competition ?? this.competition,
    market: market ?? this.market,
    pick: pick ?? this.pick,
    odds: odds ?? this.odds,
    kickoff: kickoff ?? this.kickoff,
    confidence: confidence ?? this.confidence,
  );
}

/// Everything read from one image.
class ParsedSlip {
  const ParsedSlip({
    required this.selections,
    this.bookmaker,
    this.bookingCode,
    this.totalOdds,
  });

  final List<ParsedSelection> selections;

  /// The bookmaker the slip came from, when the image names one.
  final String? bookmaker;

  /// A booking code, when one is printed on the slip. This is the single most useful thing an
  /// image can yield: with it, the existing conversion path can load the real slip from the
  /// bookmaker and nothing has to be inferred from pixels at all.
  final String? bookingCode;

  final double? totalOdds;

  bool get isEmpty => selections.isEmpty && bookingCode == null;
}

/// Bookmakers whose name appearing on a slip is worth recognising.
///
/// Only the ones GameClaw can actually talk to, plus the ones it knows about. Matching a name
/// GameClaw has no adapter for still helps: the review screen can say "this looks like a Betway
/// slip, which GameClaw cannot convert" instead of failing silently.
const _bookmakers = <String, List<String>>{
  'sportybet': ['sportybet', 'sporty bet'],
  'football.com': ['football.com', 'footballcom'],
  'msport': ['msport', 'm sport'],
  '1xbet': ['1xbet', '1x bet'],
  '22bet': ['22bet', '22 bet'],
  'betwinner': ['betwinner', 'bet winner'],
  'melbet': ['melbet', 'mel bet'],
  'paripesa': ['paripesa', 'pari pesa'],
  'betway': ['betway', 'bet way'],
  'betpawa': ['betpawa', 'bet pawa'],
};

/// Market wordings seen on real slips, mapped to something GameClaw understands.
const _markets = <String, List<String>>{
  '1X2': ['1x2', 'match result', 'full time result', 'ft result', 'winner', '3-way'],
  'Double Chance': ['double chance', 'dc'],
  'Over/Under': ['over/under', 'o/u', 'total goals', 'goals over', 'goals under', 'over ', 'under '],
  'Both Teams To Score': ['both teams to score', 'btts', 'gg/ng', 'gg', 'goal/goal'],
  'Draw No Bet': ['draw no bet', 'dnb'],
  'Handicap': ['handicap', 'ah ', 'asian handicap'],
  'Correct Score': ['correct score', 'cs '],
};

/// Separators a slip might use between two teams. Order matters: " v " would match inside
/// "Riv vs Boc" if the longer forms were not tried first.
const _versus = [' vs. ', ' vs ', ' v. ', ' v ', ' - ', ' — ', ' x ', ' @ '];

/// Lines that are chrome rather than content.
bool _isNoise(String line) {
  final l = line.toLowerCase().trim();
  if (l.isEmpty) return true;
  const noise = [
    'bet slip', 'betslip', 'total odds', 'total stake', 'potential win', 'possible win',
    'stake', 'share', 'book', 'booking', 'place bet', 'remove', 'delete', 'edit',
    'cash out', 'cashout', 'terms', 'accept', 'odds change', 'tax', 'bonus',
  ];
  return noise.any((n) => l == n || l.startsWith('$n:') || l.startsWith('$n '));
}

/// OCR confuses a handful of glyphs in numbers, consistently enough to undo.
String _repairDigits(String text) =>
    text.replaceAll('O', '0').replaceAll('o', '0').replaceAll('l', '1').replaceAll('I', '1');

/// Odds, if this line is one.
///
/// Deliberately strict. A slip is full of numbers - stakes, totals, minutes, dates - and reading
/// any of them as odds produces a confidently wrong selection. Odds are between 1.01 and 1000
/// and are written with a decimal point; a bare integer is not treated as odds.
double? readOdds(String line) {
  final cleaned = _repairDigits(line.trim());
  for (final match in RegExp(r'\d{1,4}[.,]\d{1,3}').allMatches(cleaned)) {
    final value = double.tryParse(match.group(0)!.replaceAll(',', '.'));
    if (value != null && value >= 1.01 && value <= 1000) return value;
  }
  return null;
}

/// The two sides, if this line names them.
({String home, String away})? readTeams(String line) {
  final trimmed = line.trim();
  if (trimmed.length < 5) return null;
  // "Over 2.5 - 1.85" has a separator and two sides and is not a match. A line that names a
  // market is a market line, whatever punctuation it happens to contain.
  if (readMarket(trimmed) != null) return null;
  for (final sep in _versus) {
    final index = trimmed.toLowerCase().indexOf(sep);
    if (index <= 0) continue;
    final home = trimmed.substring(0, index).trim();
    final away = trimmed.substring(index + sep.length).trim();
    if (home.isEmpty || away.isEmpty) continue;
    if (away.length < 2 || home.length < 2) continue;
    // A team name is mostly letters. Either side being mostly digits means this is a score, a
    // price or a date, not two teams.
    if (_mostlyDigits(home) || _mostlyDigits(away)) continue;
    return (home: _tidyTeam(home), away: _tidyTeam(away));
  }
  return null;
}

/// True when a fragment is more number than name.
bool _mostlyDigits(String text) {
  final letters = text.runes.where((r) => RegExp(r'[A-Za-z]').hasMatch(String.fromCharCode(r))).length;
  final digits = text.runes.where((r) => RegExp(r'[0-9]').hasMatch(String.fromCharCode(r))).length;
  return digits > 0 && letters <= digits;
}

String _tidyTeam(String name) =>
    name.replaceAll(RegExp(r'^\W+|\W+$'), '').replaceAll(RegExp(r'\s+'), ' ').trim();

/// The market this line describes, if any.
String? readMarket(String line) {
  final l = line.toLowerCase();
  for (final entry in _markets.entries) {
    if (entry.value.any(l.contains)) return entry.key;
  }
  return null;
}

/// The bookmaker named anywhere in the text.
String? readBookmaker(List<String> lines) {
  final all = lines.join(' ').toLowerCase();
  for (final entry in _bookmakers.entries) {
    if (entry.value.any(all.contains)) return entry.key;
  }
  return null;
}

/// A booking code, if the slip shows one.
///
/// Worth far more than anything else on the image: with a code, the existing conversion path
/// loads the real slip from the bookmaker and no pixel has to be trusted. Codes are short
/// alphanumeric strings, so this only accepts one that is labelled as such - looking for "any
/// short uppercase token" would match team abbreviations and competition names constantly.
String? readBookingCode(List<String> lines) {
  final labels = ['booking code', 'bet code', 'share code', 'code:', 'booking id'];
  for (var i = 0; i < lines.length; i++) {
    final l = lines[i].toLowerCase();
    if (!labels.any(l.contains)) continue;

    // On the same line after the label, or on the next line.
    final sameLine = RegExp(r'[:\s]([A-Z0-9]{4,12})\s*$').firstMatch(lines[i]);
    if (sameLine != null) return sameLine.group(1);
    if (i + 1 < lines.length) {
      final next = lines[i + 1].trim();
      if (RegExp(r'^[A-Z0-9]{4,12}$').hasMatch(next)) return next;
    }
  }
  return null;
}

/// Reads a slip out of OCR text.
///
/// Blocks are built around team lines, because that is the one anchor a slip reliably has: a
/// selection without two teams is not a selection. Lines after a team line and before the next
/// one are that selection's own - the market, the pick, the odds.
ParsedSlip parseSlip(String ocrText) {
  final raw = ocrText.split('\n').map((l) => l.trim()).where((l) => l.isNotEmpty).toList();

  // Read from the unfiltered text. The noise filter strips lines beginning "booking", which is
  // right for a "Book bet" button and catastrophic for "Booking Code: GC4T2P" - the one thing on
  // the image worth more than everything else, because with a code the existing conversion path
  // loads the real slip and nothing has to be inferred from pixels.
  final bookmaker = readBookmaker(raw);
  final bookingCode = readBookingCode(raw);

  final lines = raw.where((l) => !_isNoise(l)).toList();

  final selections = <ParsedSelection>[];
  List<String> current = [];
  ({String home, String away})? teams;

  void flush() {
    if (teams == null) {
      current = [];
      return;
    }
    String? market;
    String? pick;
    double? odds;

    // A line that is nothing but a price, preferred over any line that merely contains a number.
    // Without this, "Over 2.5" supplies 2.5 as the odds and the real 1.95 two lines below is
    // never reached - a wrong price that looks entirely plausible on the review screen.
    for (final line in current.skip(1)) {
      final bare = RegExp(r'^\s*\d{1,4}[.,]\d{1,3}\s*$').hasMatch(_repairDigits(line));
      if (bare) {
        odds ??= readOdds(line);
      }
    }

    for (final line in current.skip(1)) {
      market ??= readMarket(line);
      odds ??= readOdds(line);
      // A short line that is neither the market nor odds is most likely the pick itself.
      if (pick == null &&
          readMarket(line) == null &&
          readOdds(line) == null &&
          line.length <= 24 &&
          readTeams(line) == null) {
        pick = line;
      }
    }

    // Confidence is about how much had to be inferred, not about how much was found.
    final confidence = odds != null && market != null
        ? Confidence.high
        : odds != null || market != null
        ? Confidence.medium
        : Confidence.low;

    selections.add(
      ParsedSelection(
        rawLines: List.of(current),
        home: teams!.home,
        away: teams!.away,
        market: market,
        pick: pick,
        odds: odds,
        confidence: confidence,
      ),
    );
    current = [];
    teams = null;
  }

  for (final line in lines) {
    final found = readTeams(line);
    if (found != null) {
      flush();
      teams = found;
      current = [line];
    } else if (teams != null) {
      current.add(line);
    }
  }
  flush();

  // The total, if the slip prints one. From a labelled line only, never from the largest number
  // on the image. Slips put the label and the figure on one line or on two, so both are tried -
  // the same shape as the booking code.
  double? total;
  for (var i = 0; i < raw.length; i++) {
    if (!raw[i].toLowerCase().contains('total odd')) continue;
    total = readOdds(raw[i]);
    if (total == null && i + 1 < raw.length) total = readOdds(raw[i + 1]);
    break;
  }

  return ParsedSlip(
    selections: selections,
    bookmaker: bookmaker,
    bookingCode: bookingCode,
    totalOdds: total,
  );
}
