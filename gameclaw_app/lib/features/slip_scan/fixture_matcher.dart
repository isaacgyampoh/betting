/// Turning two team names read off a photograph into a real fixture.
///
/// This is where the feature is most likely to be quietly wrong, so it is built to refuse rather
/// than to reach. OCR gives "Man Utd", "MANCHESTER UTD", "Mancheater United" - and the day's card
/// may contain Manchester United and Manchester City, which differ by one word. Picking the wrong
/// one produces a slip that converts perfectly and is about a different match.
///
/// So a match is only returned with a confidence, and a near-tie between two candidates is
/// reported as uncertain even when the best score is high. The review screen shows the
/// alternatives and lets the user choose; nothing is committed on the parser's say-so.
library;

import '../../domain/models.dart';
import 'slip_parser.dart';

/// Everything stripped that OCR and bookmakers disagree about.
///
/// Case, punctuation, accents, and the club-type words that one source prints and another omits:
/// "FC Barcelona", "Barcelona FC" and "Barcelona" are the same club to everybody except a string
/// comparison.
String normaliseTeam(String name) {
  const accents = {
    'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a', 'å': 'a',
    'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
    'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
    'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o',
    'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u',
    'ñ': 'n', 'ç': 'c', 'ø': 'o', 'ß': 'ss',
  };
  var text = name.toLowerCase();
  accents.forEach((from, to) => text = text.replaceAll(from, to));
  // Dots close up rather than splitting: "C.F." has to become "cf" so the abbreviation list can
  // recognise it. Turning every dot into a space first left "c f", two stray letters that no
  // list will ever contain.
  text = text.replaceAll('.', '');
  text = text.replaceAll(RegExp(r'[^a-z0-9 ]'), ' ');

  // Club-type words and the abbreviations slips use. Dropped from both sides, so their presence
  // or absence never decides a match.
  const noise = {
    'fc', 'cf', 'sc', 'ac', 'afc', 'cd', 'sv', 'fk', 'bk', 'if', 'ff', 'sk',
    'club', 'de', 'the', 'team', 'united', 'utd', 'city', 'town', 'athletic',
  };
  final words = text.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  // Single letters are punctuation left over from an abbreviation, never a club name.
  final kept = words.where((w) => !noise.contains(w) && w.length > 1).toList();

  // Unless dropping them leaves nothing - "United" alone has to stay "united".
  return (kept.isEmpty ? words : kept).join(' ').trim();
}

/// How alike two names are, 0 to 1.
///
/// Token overlap rather than edit distance: "Manchester United" and "Utd Manchester" are the same
/// club in a different order, which Levenshtein scores poorly and overlap scores perfectly. A
/// character-level fallback catches the typos OCR actually makes within a single word.
double similarity(String a, String b) {
  final left = normaliseTeam(a);
  final right = normaliseTeam(b);
  if (left.isEmpty || right.isEmpty) return 0;
  if (left == right) return 1;

  final leftWords = left.split(' ').toSet();
  final rightWords = right.split(' ').toSet();
  final shared = leftWords.intersection(rightWords).length;
  final overlap = shared / (leftWords.length > rightWords.length ? leftWords.length : rightWords.length);

  // Trigram similarity, which survives a transposed or dropped letter inside a word.
  Set<String> grams(String s) {
    final padded = '  $s ';
    return {for (var i = 0; i + 3 <= padded.length; i++) padded.substring(i, i + 3)};
  }

  final ga = grams(left);
  final gb = grams(right);
  final gramShared = ga.intersection(gb).length;
  final gram = gramShared == 0 ? 0.0 : (2 * gramShared) / (ga.length + gb.length);

  return overlap > gram ? overlap : gram;
}

/// What the matcher concluded about one parsed selection.
class FixtureMatch {
  const FixtureMatch({
    required this.parsed,
    this.fixture,
    this.score = 0,
    this.alternatives = const [],
    this.ambiguous = false,
  });

  final ParsedSelection parsed;

  /// Null when nothing on the card resembled it closely enough to offer.
  final Fixture? fixture;

  /// 0 to 1, how closely the names agreed.
  final double score;

  /// Other fixtures that scored nearly as well. Shown when the choice is not clear-cut.
  final List<Fixture> alternatives;

  /// True when the runner-up was close enough that picking the leader would be a coin toss.
  final bool ambiguous;

  /// Only a clear, high-scoring, unambiguous match is treated as settled.
  Confidence get confidence {
    if (fixture == null) return Confidence.low;
    if (ambiguous) return Confidence.medium;
    if (score >= 0.92) return Confidence.high;
    if (score >= 0.72) return Confidence.medium;
    return Confidence.low;
  }

  bool get needsReview => fixture == null || confidence != Confidence.high;
}

/// Below this, a candidate is not worth offering at all.
const _floor = 0.55;

/// Within this of the leader, the choice is a coin toss and must be shown as one.
const _tieWindow = 0.08;

/// Finds the fixture a parsed selection refers to.
///
/// Both sides must agree: a candidate scores as the lower of its two team similarities, so
/// "Arsenal vs Chelsea" cannot match "Arsenal vs Everton" on the strength of Arsenal alone.
FixtureMatch matchFixture(ParsedSelection parsed, List<Fixture> candidates) {
  if (parsed.home == null || parsed.away == null || candidates.isEmpty) {
    return FixtureMatch(parsed: parsed);
  }

  final scored = <(Fixture, double)>[];
  for (final fixture in candidates) {
    final home = similarity(parsed.home!, fixture.home.name);
    final away = similarity(parsed.away!, fixture.away.name);
    // The weaker side decides. Averaging would let one perfect match carry a wrong one.
    final both = home < away ? home : away;

    // A slip can list the sides the other way round from the fixture.
    final swappedHome = similarity(parsed.home!, fixture.away.name);
    final swappedAway = similarity(parsed.away!, fixture.home.name);
    final swapped = swappedHome < swappedAway ? swappedHome : swappedAway;

    final best = both > swapped ? both : swapped;
    if (best >= _floor) scored.add((fixture, best));
  }

  if (scored.isEmpty) return FixtureMatch(parsed: parsed);
  scored.sort((a, b) => b.$2.compareTo(a.$2));

  final leader = scored.first;
  final rivals = scored.skip(1).where((s) => leader.$2 - s.$2 <= _tieWindow).toList();

  return FixtureMatch(
    parsed: parsed,
    fixture: leader.$1,
    score: leader.$2,
    alternatives: rivals.map((r) => r.$1).toList(),
    ambiguous: rivals.isNotEmpty,
  );
}

/// Matches every selection on a slip.
List<FixtureMatch> matchSlip(ParsedSlip slip, List<Fixture> candidates) =>
    slip.selections.map((s) => matchFixture(s, candidates)).toList();
