/// Understanding what someone wants done to a slip they just scanned.
///
/// Handled here rather than by the model, because these are operations on data the app already
/// holds and the right answer is not a matter of interpretation. "Remove the third selection"
/// has exactly one meaning; sending it to a language model to be paraphrased back into an
/// intention introduces a way for it to be wrong that does not otherwise exist.
///
/// Anything not recognised falls through to Claw untouched. This is a shortcut for the few
/// phrasings that are unambiguous, not an attempt at a parser for English.
library;

/// What the user asked for.
sealed class SlipCommand {
  const SlipCommand();
}

/// Drop one selection, identified by position or by a team name in it.
class RemoveSelection extends SlipCommand {
  const RemoveSelection({this.index, this.team});

  /// Zero-based, when they said "the third one".
  final int? index;

  /// A name to look for, when they said "remove Arsenal".
  final String? team;
}

/// Send the slip to a bookmaker.
class ConvertTo extends SlipCommand {
  const ConvertTo(this.bookmaker);
  final String bookmaker;
}

/// List what could not be matched to a fixture.
class ShowUnmatched extends SlipCommand {
  const ShowUnmatched();
}

/// Scan again.
class Rescan extends SlipCommand {
  const Rescan();
}

/// Change the odds on one selection.
class SetOdds extends SlipCommand {
  const SetOdds({required this.index, required this.odds});
  final int index;
  final double odds;
}

/// Ordinals only, never bare cardinals.
///
/// "one", "two" and "three" were in here and caused two different wrongs. "Delete the 3rd one"
/// matched "one" before it reached "3rd" and removed the first selection; and "remove one of
/// them" became "remove the first", which is precisely the guess this is meant not to make. A
/// position is said as an ordinal or as a digit, and a bare cardinal is almost always something
/// else.
const _ordinals = {
  'first': 0,
  '1st': 0,
  'second': 1,
  '2nd': 1,
  'third': 2,
  '3rd': 2,
  'fourth': 3,
  '4th': 3,
  'fifth': 4,
  '5th': 4,
  'sixth': 5,
  '6th': 5,
  'last': -1,
};

/// Bookmakers a conversion can name, and the spellings people use.
const _bookmakers = {
  'sportybet': ['sportybet', 'sporty bet', 'sporty'],
  'football.com': ['football.com', 'footballcom', 'football com'],
  'msport': ['msport', 'm sport'],
  '1xbet': ['1xbet', '1x bet'],
  '22bet': ['22bet', '22 bet'],
  'betwinner': ['betwinner', 'bet winner'],
  'melbet': ['melbet'],
  'paripesa': ['paripesa', 'pari pesa'],
  'betway': ['betway', 'bet way'],
  'betpawa': ['betpawa', 'bet pawa'],
};

/// A position mentioned in the text, as a zero-based index. -1 means "the last one".
int? _positionIn(String text) {
  for (final entry in _ordinals.entries) {
    if (RegExp('\\b${RegExp.escape(entry.key)}\\b').hasMatch(text)) return entry.value;
  }
  // "remove 2" or "remove selection 2", which people write as often as "the second".
  final digits = RegExp(
    r'\b(?:selection|leg|game|match|number|no\.?)?\s*#?(\d{1,2})\b',
  ).firstMatch(text);
  if (digits != null) {
    final n = int.tryParse(digits.group(1)!);
    // One-based when spoken, and a 0 is not a position.
    if (n != null && n >= 1 && n <= 20) return n - 1;
  }
  return null;
}

/// Reads a command, or returns null to let Claw answer.
///
/// Deliberately conservative: a sentence that merely mentions removing something, without saying
/// what, is not acted on. Guessing which selection to delete is worse than asking.
SlipCommand? readCommand(String input) {
  final text = input.toLowerCase().trim();
  if (text.isEmpty) return null;

  if (RegExp(r'\b(scan|read|try) (again|another)\b').hasMatch(text) ||
      text == 'rescan' ||
      RegExp(r'\banother (photo|screenshot|image)\b').hasMatch(text)) {
    return const Rescan();
  }

  if (RegExp(r"\b(which|what).*(could ?n.t|not|unmatched|failed)\b").hasMatch(text) ||
      text.contains('unmatched') ||
      RegExp(r'\bshow.*(not matched|no fixture)\b').hasMatch(text)) {
    return const ShowUnmatched();
  }

  if (RegExp(r'\b(convert|move|send|switch|change)\b').hasMatch(text)) {
    for (final entry in _bookmakers.entries) {
      if (entry.value.any(text.contains)) return ConvertTo(entry.key);
    }
  }

  // Odds before removal: "change the odds on the second to 1.90" contains "change", which the
  // conversion branch above would otherwise have to be careful about, and contains a position.
  if (RegExp(r'\bodds?\b').hasMatch(text)) {
    final price = RegExp(r'\b(\d{1,3}[.,]\d{1,3})\b').firstMatch(text);
    final position = _positionIn(text.replaceAll(RegExp(r'\d{1,3}[.,]\d{1,3}'), ''));
    if (price != null && position != null) {
      final value = double.tryParse(price.group(1)!.replaceAll(',', '.'));
      if (value != null && value >= 1.01) return SetOdds(index: position, odds: value);
    }
  }

  if (RegExp(r'\b(remove|delete|drop|take off|get rid of)\b').hasMatch(text)) {
    final position = _positionIn(text);
    if (position != null) return RemoveSelection(index: position);

    // A name instead of a position: everything after the verb, with filler removed.
    final after = RegExp(r'\b(?:remove|delete|drop|take off|get rid of)\b(.*)')
        .firstMatch(text)
        ?.group(1)
        ?.replaceAll(
          // Filler and pronouns together. "Remove one of them" survived a pronoun-only check
          // because the phrase as a whole is not a pronoun; stripping each word leaves nothing,
          // which is the correct reading - it names no selection.
          RegExp(
            r'\b(the|a|an|selection|leg|game|match|from|my|slip|please|of|'
            r'one|it|that|this|them|these|those|something|anything|any|some)\b',
          ),
          ' ',
        )
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    // A pronoun is not a team. "Remove something", "take that off", "get rid of it" all name
    // nothing, and matching a selection against them would delete an arbitrary leg.
    const vague = {
      'something',
      'anything',
      'it',
      'that',
      'this',
      'them',
      'these',
      'those',
      'one',
      'any',
      'some',
      'stuff',
      'things',
      'thing',
    };
    if (after != null && after.length >= 3 && !vague.contains(after)) {
      return RemoveSelection(team: after);
    }

    // "remove one of them" says nothing about which. Asking is better than choosing.
    return null;
  }

  return null;
}
