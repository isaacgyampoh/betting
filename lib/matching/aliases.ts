// Built-in alias groups (spellings of the same club). DB rows in team_aliases extend these
// at runtime, including aliases learned from confident matches.
export const ALIAS_GROUPS: string[][] = [
  ["manchester united", "man utd", "man united", "manchester utd"],
  ["manchester city", "man city"],
  ["tottenham", "tottenham hotspur", "spurs"],
  ["wolverhampton", "wolves", "wolverhampton wanderers"],
  ["nottingham forest", "nottm forest", "nottingham"],
  ["brighton", "brighton and hove albion", "brighton hove albion", "brighton and hove"],
  ["newcastle", "newcastle united", "newcastle utd"],
  ["west ham", "west ham united"],
  ["sheffield united", "sheffield utd"],
  ["atletico madrid", "atl madrid", "atletico de madrid", "atl"],
  ["real betis", "betis"],
  ["athletic bilbao", "athletic club", "athletic"],
  ["barcelona", "barca"],
  ["inter", "inter milan", "inter milano", "internazionale"],
  ["milan", "ac milan"],
  ["napoli", "ssc napoli"],
  ["asante kotoko", "kotoko"],
  ["hearts of oak", "accra hearts of oak", "hearts"],
  ["medeama", "medeama sc"],
  ["dreams", "dreams fc"],
  ["bechem united", "bechem utd", "bechem"],
  ["berekum chelsea", "berekum"],
  ["nations", "nations fc"],
  ["karela united", "karela utd", "karela"],

  // Added 23 Oct 2026 from the providers' own records, not from memory. Both fixtures were
  // carried by SportyBet and priced by Claw while the match analyst reported them "not listed",
  // because the analyst is the one path that compares names across two sources.
  //
  //   API-Football            SportyBet              Football.com
  //   Borussia Mönchengladbach  Borussia M´gladbach    Borussia Monchengladbach
  //   Stade Brestois 29         Brest                  Brest
  //
  // The SportyBet spelling normalises to "borussia m gladbach" - the acute accent is stripped as
  // punctuation, leaving a stray single letter - so that exact form is listed rather than guessed.
  ["borussia monchengladbach", "borussia m gladbach", "borussia mgladbach", "borussia moenchengladbach", "monchengladbach", "gladbach"],
  // "brest" alone is the French club at every provider we read. Dynamo Brest normalises to
  // "dynamo brest", a different string, so it does not land in this group.
  ["stade brestois 29", "stade brestois", "brest"],
];
