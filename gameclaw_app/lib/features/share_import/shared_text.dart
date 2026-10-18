/// Finding a booking code in whatever a bookmaker's app decided to share.
///
/// Shared text is not a format. It is a sentence somebody's marketing team wrote, with a code
/// somewhere in it, and it differs per bookmaker and per app version:
///
///   "Check out my bet! Booking code: K7F2QP - sportybet.com/gh"
///   "I just booked A1B2C3 on MSport 🔥"
///   "https://www.sportybet.com/gh/?shareCode=K7F2QP"
///
/// So this does not try to parse the sentence. It finds the candidates that *could* be a booking
/// code, scores them by how much the surrounding text supports that reading, and returns them in
/// order. When nothing scores well enough it returns nothing, and the user is asked - which is the
/// whole point. Guessing produces an import that looks successful and loads somebody else's slip,
/// or none at all.
library;

/// A possible booking code and how much the text supports it.
class CodeCandidate {
  const CodeCandidate({required this.code, required this.confidence, required this.why});

  final String code;

  /// 0 to 1. Above [CodeCandidate.certain] the app may proceed without asking.
  final double confidence;

  /// What made this look like a code. Shown to the user when we ask them to confirm.
  final String why;

  /// Confident enough to act on without asking, because the text said so in as many words.
  static const certain = 0.8;

  @override
  String toString() => '$code (${confidence.toStringAsFixed(2)}: $why)';
}

/// Every bookmaker code format we accept is 5-10 of A-Z and 0-9.
final _token = RegExp(r'\b[A-Z0-9]{5,10}\b');

/// Words near a code that say it is one. Ordered loosely by how specific they are.
const _labels = [
  'booking code',
  'bet code',
  'share code',
  'sharecode',
  'booking',
  'code',
];

/// Query parameters bookmakers put a code in.
final _urlParam = RegExp(
  r'[?&](?:shareCode|share_code|bookingCode|booking_code|code|coupon)=([A-Za-z0-9]{5,10})\b',
  caseSensitive: false,
);

/// Tokens that match the shape but are words, not codes.
///
/// Shared text is full of shouting. Without this, "CHECK", "GOALS" and "WINNER" are all perfectly
/// valid-looking booking codes, and the first one in the sentence wins.
const _notCodes = {
  'CHECK', 'GOALS', 'WINNER', 'WINNERS', 'MATCH', 'MATCHES', 'TODAY', 'ODDS', 'TOTAL', 'STAKE',
  'SHARE', 'SPORT', 'SPORTS', 'SOCCER', 'TICKET', 'SLIP', 'BOOKING', 'DOUBLE', 'SINGLE', 'TREBLE',
  'LEAGUE', 'HTTPS', 'HTTP', 'WWW', 'COM', 'BET', 'BETS', 'PLACE', 'PLACED', 'MYBET', 'FIXED',
  'ACCUM', 'PARLAY', 'MULTI', 'POTENTIAL', 'RETURN', 'RETURNS', 'PAYOUT', 'LIVE', 'FULL', 'TIME',
  'OVER', 'UNDER', 'DRAW', 'HOME', 'AWAY', 'GHANA', 'NIGERIA', 'KENYA',
};

/// Bookmaker names as they appear in shared text, and the slug the API knows them by.
///
/// Only used as a hint: the server detects the bookmaker from the code's own shape, which is more
/// reliable than a brand name in marketing copy. This is for the case where two bookmakers share
/// a format and the text settles it.
const _brands = <String, String>{
  'sportybet': 'sportybet',
  'sporty bet': 'sportybet',
  'football.com': 'footballcom',
  'msport': 'msport',
  'betway': 'betway',
  'betpawa': 'betpawa',
  'bet pawa': 'betpawa',
  '1xbet': '1xbet',
  '22bet': '22bet',
  'betwinner': 'betwinner',
  'paripesa': 'paripesa',
};

/// What a shared message turned out to contain.
class SharedSlip {
  const SharedSlip({required this.candidates, this.bookmaker, required this.rawText});

  /// Best first. Empty when nothing in the text could be a booking code.
  final List<CodeCandidate> candidates;

  /// The bookmaker slug the text names, when it names one unambiguously.
  final String? bookmaker;

  /// What was shared, kept so the import screen can show it when nothing was found.
  final String rawText;

  /// The one candidate worth acting on without asking, or null when the user should choose.
  CodeCandidate? get confident {
    if (candidates.isEmpty) return null;
    final best = candidates.first;
    if (best.confidence < CodeCandidate.certain) return null;
    // A clear winner, not a tie. Two equally good candidates is exactly when to ask.
    if (candidates.length > 1 && candidates[1].confidence >= best.confidence - 0.15) return null;
    return best;
  }

  bool get isEmpty => candidates.isEmpty;
}

/// Reads whatever was shared.
///
/// Never throws and never returns a code it is not willing to explain: every candidate carries the
/// reason it was chosen, because the user may be asked to confirm it.
SharedSlip readSharedText(String? input) {
  final text = (input ?? '').trim();
  if (text.isEmpty) return SharedSlip(candidates: const [], rawText: '');

  final lower = text.toLowerCase();
  final scored = <String, CodeCandidate>{};

  void offer(String code, double confidence, String why) {
    final existing = scored[code];
    if (existing == null || existing.confidence < confidence) {
      scored[code] = CodeCandidate(code: code, confidence: confidence, why: why);
    }
  }

  // 1. A code in a share URL. The strongest signal there is: the bookmaker put it there itself,
  //    in a parameter it named.
  for (final m in _urlParam.allMatches(text)) {
    offer(m.group(1)!.toUpperCase(), 0.95, 'in the share link');
  }

  // 2. A token immediately after a label. "Booking code: K7F2QP" leaves little doubt.
  for (final label in _labels) {
    var from = 0;
    while (true) {
      final at = lower.indexOf(label, from);
      if (at < 0) break;
      from = at + label.length;
      // Look only at what follows, within a short window - a label refers forwards.
      final after = text.substring(from, (from + 24).clamp(0, text.length));
      final m = _token.firstMatch(after.toUpperCase());
      if (m != null) {
        final code = m.group(0)!;
        if (!_notCodes.contains(code)) {
          // Longer labels are more specific, so they earn slightly more.
          offer(code, label.contains(' ') ? 0.92 : 0.85, 'labelled "$label"');
        }
      }
    }
  }

  // 3. A bare token with a digit in it and nothing to confirm it. Offered so the user can
  //    choose, never acted on alone.
  //
  //    A token of letters only is not offered at all. It is almost always a word - "EXAMPLE" out
  //    of a URL, a team name, a word the shouting list does not happen to contain - and no list of
  //    exclusions ever catches them all. Missing a genuine all-letters code costs a manual paste;
  //    offering a word as a code costs an import of somebody else's slip, or of nothing, under a
  //    screen that says it worked.
  for (final m in _token.allMatches(text.toUpperCase())) {
    final code = m.group(0)!;
    if (_notCodes.contains(code)) continue;
    if (!RegExp(r'\d').hasMatch(code)) continue;
    offer(code, 0.5, 'looks like a code');
  }

  final candidates = scored.values.toList()
    ..sort((a, b) => b.confidence.compareTo(a.confidence));

  // The bookmaker, only when the text names exactly one.
  final named = _brands.entries.where((e) => lower.contains(e.key)).map((e) => e.value).toSet();

  return SharedSlip(
    candidates: candidates,
    bookmaker: named.length == 1 ? named.first : null,
    rawText: text,
  );
}
