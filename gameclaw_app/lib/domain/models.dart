/// The app's own view of football, independent of whatever a provider happens to return.
///
/// Two rules run through all of it:
///
/// 1. Missing is not zero. A competition that publishes no shot counts and a match with genuinely
///    zero shots are different facts, and a product that shows "0" for both is lying. Anything a
///    provider may not supply is nullable, and the UI is required to handle null as "not published"
///    rather than as a number.
/// 2. Nothing is derived here. These are the numbers as reported; anything calculated belongs in a
///    repository or a view model where it can be labelled as such.
library;

enum MatchStatus { scheduled, live, halfTime, finished, postponed, cancelled, unknown }

extension MatchStatusX on MatchStatus {
  bool get isLive => this == MatchStatus.live || this == MatchStatus.halfTime;
  bool get isDone => this == MatchStatus.finished;

  static MatchStatus parse(String? raw) => switch (raw?.toUpperCase()) {
        'LIVE' => MatchStatus.live,
        'HT' || 'HALFTIME' || 'HALF_TIME' => MatchStatus.halfTime,
        'FINISHED' || 'FT' => MatchStatus.finished,
        'SCHEDULED' || 'NS' => MatchStatus.scheduled,
        'POSTPONED' => MatchStatus.postponed,
        'CANCELLED' || 'CANCELED' => MatchStatus.cancelled,
        _ => MatchStatus.unknown,
      };
}

class Team {
  const Team({required this.id, required this.name, this.logoUrl});
  final int id;
  final String name;
  final String? logoUrl;

  factory Team.fromJson(Map<String, dynamic> json) => Team(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: json['name'] as String? ?? '',
        logoUrl: json['logo'] as String?,
      );
}

class Competition {
  const Competition({required this.id, required this.name, required this.country, this.logoUrl, this.season});
  final int id;
  final String name;
  final String country;
  final String? logoUrl;
  final int? season;

  factory Competition.fromJson(Map<String, dynamic> json) => Competition(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: json['name'] as String? ?? '',
        country: json['country'] as String? ?? '',
        logoUrl: json['logo'] as String?,
        season: (json['season'] as num?)?.toInt(),
      );
}

/// What a competition's season actually publishes.
///
/// Carried alongside the data rather than inferred from it, because an empty list is ambiguous:
/// a match with no events yet and a competition that never publishes events look identical until
/// something says which it is.
class Coverage {
  const Coverage({
    required this.events,
    required this.lineups,
    required this.statistics,
    required this.playerStats,
    required this.standings,
  });

  final bool events;
  final bool lineups;
  final bool statistics;
  final bool playerStats;
  final bool standings;

  factory Coverage.fromJson(Map<String, dynamic> json) => Coverage(
        events: json['events'] == true,
        lineups: json['lineups'] == true,
        statistics: json['statistics'] == true,
        playerStats: json['playerStats'] == true,
        standings: json['standings'] == true,
      );
}

class Fixture {
  const Fixture({
    required this.id,
    required this.kickoffUtc,
    required this.status,
    required this.statusLabel,
    required this.competition,
    required this.home,
    required this.away,
    this.homeGoals,
    this.awayGoals,
    this.halfTimeHome,
    this.halfTimeAway,
  });

  final int id;
  final DateTime kickoffUtc;
  final MatchStatus status;

  /// The provider's own wording for the state - "Match Finished", "62'". Shown as given rather
  /// than re-worded, so the app never claims a state the provider did not.
  final String statusLabel;

  final Competition competition;
  final Team home;
  final Team away;

  /// Null before kick-off, and null for a match whose score is not published. Never defaulted to 0.
  final int? homeGoals;
  final int? awayGoals;
  final int? halfTimeHome;
  final int? halfTimeAway;

  bool get hasScore => homeGoals != null && awayGoals != null;

  factory Fixture.fromJson(Map<String, dynamic> json) {
    final goals = json['goals'] as Map<String, dynamic>? ?? const {};
    final half = json['halftime'] as Map<String, dynamic>?;
    return Fixture(
      id: (json['id'] as num?)?.toInt() ?? 0,
      kickoffUtc: DateTime.parse(json['kickoffAt'] as String).toUtc(),
      status: MatchStatusX.parse(json['status'] as String?),
      statusLabel: json['statusLabel'] as String? ?? '',
      competition: Competition.fromJson(json['league'] as Map<String, dynamic>? ?? const {}),
      home: Team.fromJson(json['home'] as Map<String, dynamic>? ?? const {}),
      away: Team.fromJson(json['away'] as Map<String, dynamic>? ?? const {}),
      homeGoals: (goals['home'] as num?)?.toInt(),
      awayGoals: (goals['away'] as num?)?.toInt(),
      halfTimeHome: (half?['home'] as num?)?.toInt(),
      halfTimeAway: (half?['away'] as num?)?.toInt(),
    );
  }
}

enum MatchEventType { goal, ownGoal, penalty, penaltyMissed, yellow, secondYellow, red, substitution, varReview, unknown }

class MatchEvent {
  const MatchEvent({
    required this.minute,
    required this.isHome,
    required this.type,
    this.extra,
    this.player,
    this.other,
    required this.detail,
  });

  final int minute;

  /// Added time inside the minute: 45+2 is minute 45, extra 2.
  final int? extra;
  final bool isHome;
  final MatchEventType type;
  final String? player;

  /// The assisting player on a goal, or the player coming on in a substitution.
  final String? other;

  /// The provider's own wording, kept so an event we do not model still reads correctly.
  final String detail;

  String get minuteLabel => extra == null ? "$minute'" : "$minute+$extra'";

  factory MatchEvent.fromJson(Map<String, dynamic> json) => MatchEvent(
        minute: (json['minute'] as num?)?.toInt() ?? 0,
        extra: (json['extra'] as num?)?.toInt(),
        isHome: json['side'] == 'HOME',
        type: switch (json['type'] as String?) {
          'GOAL' => MatchEventType.goal,
          'OWN_GOAL' => MatchEventType.ownGoal,
          'PENALTY' => MatchEventType.penalty,
          'PENALTY_MISSED' => MatchEventType.penaltyMissed,
          'YELLOW' => MatchEventType.yellow,
          'SECOND_YELLOW' => MatchEventType.secondYellow,
          'RED' => MatchEventType.red,
          'SUBSTITUTION' => MatchEventType.substitution,
          'VAR' => MatchEventType.varReview,
          _ => MatchEventType.unknown,
        },
        player: json['player'] as String?,
        other: json['other'] as String?,
        detail: json['detail'] as String? ?? '',
      );
}

enum FormResult { win, draw, loss }

extension FormResultX on FormResult {
  String get letter => switch (this) {
        FormResult.win => 'W',
        FormResult.draw => 'D',
        FormResult.loss => 'L',
      };

  static FormResult parse(String? raw) => switch (raw?.toUpperCase()) {
        'W' => FormResult.win,
        'L' => FormResult.loss,
        _ => FormResult.draw,
      };
}

class FormGame {
  const FormGame({
    required this.fixture,
    required this.result,
    required this.goalsFor,
    required this.goalsAgainst,
    required this.wasHome,
  });

  final Fixture fixture;
  final FormResult result;
  final int goalsFor;
  final int goalsAgainst;
  final bool wasHome;

  factory FormGame.fromJson(Map<String, dynamic> json) => FormGame(
        fixture: Fixture.fromJson(json['match'] as Map<String, dynamic>),
        result: FormResultX.parse(json['result'] as String?),
        goalsFor: (json['goalsFor'] as num?)?.toInt() ?? 0,
        goalsAgainst: (json['goalsAgainst'] as num?)?.toInt() ?? 0,
        wasHome: json['wasHome'] == true,
      );
}

/// A team's recent record.
///
/// Rates are fractions the server computed over [played] games, not percentages, and they are only
/// worth showing alongside that number: "60% both teams scored" means something different over ten
/// games than over three, and the screen shows the sample so the reader can tell.
class TeamForm {
  const TeamForm({required this.team, required this.games, required this.summary});

  final Team team;
  final List<FormGame> games;
  final FormSummary summary;

  factory TeamForm.fromJson(Map<String, dynamic> json) => TeamForm(
        team: Team.fromJson(json['team'] as Map<String, dynamic>? ?? const {}),
        games: (json['matches'] as List<dynamic>? ?? const [])
            .map((m) => FormGame.fromJson(m as Map<String, dynamic>))
            .toList(growable: false),
        summary: FormSummary.fromJson(json['summary'] as Map<String, dynamic>? ?? const {}),
      );
}

class FormSummary {
  const FormSummary({
    required this.played,
    required this.won,
    required this.drawn,
    required this.lost,
    required this.goalsFor,
    required this.goalsAgainst,
    required this.bttsRate,
    required this.over25Rate,
  });

  final int played;
  final int won;
  final int drawn;
  final int lost;
  final int goalsFor;
  final int goalsAgainst;

  /// Fraction of [played] in which both teams scored.
  final double bttsRate;

  /// Fraction of [played] with three or more goals.
  final double over25Rate;

  factory FormSummary.fromJson(Map<String, dynamic> json) => FormSummary(
        played: (json['played'] as num?)?.toInt() ?? 0,
        won: (json['won'] as num?)?.toInt() ?? 0,
        drawn: (json['drawn'] as num?)?.toInt() ?? 0,
        lost: (json['lost'] as num?)?.toInt() ?? 0,
        goalsFor: (json['goalsFor'] as num?)?.toInt() ?? 0,
        goalsAgainst: (json['goalsAgainst'] as num?)?.toInt() ?? 0,
        bttsRate: (json['bttsRate'] as num?)?.toDouble() ?? 0,
        over25Rate: (json['over25Rate'] as num?)?.toDouble() ?? 0,
      );
}

class StandingRow {
  const StandingRow({
    required this.rank,
    required this.team,
    required this.played,
    required this.won,
    required this.drawn,
    required this.lost,
    required this.goalsFor,
    required this.goalsAgainst,
    required this.points,
  });

  final int rank;
  final Team team;
  final int played;
  final int won;
  final int drawn;
  final int lost;
  final int goalsFor;
  final int goalsAgainst;
  final int points;

  int get goalDifference => goalsFor - goalsAgainst;

  factory StandingRow.fromJson(Map<String, dynamic> json) => StandingRow(
        rank: (json['rank'] as num?)?.toInt() ?? 0,
        team: Team.fromJson(json['team'] as Map<String, dynamic>? ?? const {}),
        played: (json['played'] as num?)?.toInt() ?? 0,
        won: (json['won'] as num?)?.toInt() ?? 0,
        drawn: (json['drawn'] as num?)?.toInt() ?? 0,
        lost: (json['lost'] as num?)?.toInt() ?? 0,
        goalsFor: (json['goalsFor'] as num?)?.toInt() ?? 0,
        goalsAgainst: (json['goalsAgainst'] as num?)?.toInt() ?? 0,
        points: (json['points'] as num?)?.toInt() ?? 0,
      );
}

/// A fixture with everything the match centre shows, and an explicit record of what is missing.
class MatchDetail {
  const MatchDetail({
    required this.fixture,
    required this.events,
    required this.coverage,
    required this.unavailable,
    required this.fetchedAt,
    this.homeForm,
    this.awayForm,
    this.headToHead = const [],
    this.standings,
    this.busy = false,
  });

  final Fixture fixture;
  final List<MatchEvent> events;

  /// Null when the provider's plan did not return form for this competition.
  final TeamForm? homeForm;
  final TeamForm? awayForm;

  /// Previous meetings, most recent first. Empty when there are none on record.
  final List<Fixture> headToHead;

  /// The table. Null for a cup or a friendly, which have none.
  final List<StandingRow>? standings;

  /// Some sections hit the provider's per-minute limit. A refresh shortly will fill them, and
  /// saying so is better than showing a gap that looks permanent.
  final bool busy;

  /// Null when the provider did not say what this competition carries.
  final Coverage? coverage;

  /// Sections the provider's plan did not return this time - a temporary gap, as distinct from a
  /// competition that never publishes them.
  final List<String> unavailable;

  /// When this was read. Shown on screen, so cached data is never passed off as current.
  final DateTime fetchedAt;

  factory MatchDetail.fromJson(Map<String, dynamic> json, {DateTime? fetchedAt}) {
    final form = json['form'] as Map<String, dynamic>?;
    return MatchDetail(
      fixture: Fixture.fromJson(json['match'] as Map<String, dynamic>),
      events: (json['events'] as List<dynamic>? ?? const [])
          .map((e) => MatchEvent.fromJson(e as Map<String, dynamic>))
          .toList(growable: false),
      coverage: json['coverage'] == null ? null : Coverage.fromJson(json['coverage'] as Map<String, dynamic>),
      unavailable: (json['unavailable'] as List<dynamic>? ?? const []).cast<String>(),
      fetchedAt: fetchedAt ?? DateTime.now().toUtc(),
      homeForm: form?['home'] == null ? null : TeamForm.fromJson(form!['home'] as Map<String, dynamic>),
      awayForm: form?['away'] == null ? null : TeamForm.fromJson(form!['away'] as Map<String, dynamic>),
      headToHead: (json['h2h'] as List<dynamic>? ?? const [])
          .map((m) => Fixture.fromJson(m as Map<String, dynamic>))
          .toList(growable: false),
      standings: json['standings'] == null
          ? null
          : (json['standings'] as List<dynamic>)
              .map((r) => StandingRow.fromJson(r as Map<String, dynamic>))
              .toList(growable: false),
      busy: json['busy'] == true,
    );
  }
}

/// A day's fixtures, grouped by competition the way the server ordered them.
///
/// The grouping is the server's decision, not the app's: it knows which competitions matter and
/// caps a day's list at a size a phone can actually render. [total] and [shown] are kept so the
/// screen can say "150 of 1,284" rather than implying the day had 150 games.
class MatchDay {
  const MatchDay({
    required this.date,
    required this.groups,
    required this.total,
    required this.shown,
  });

  final String date;
  final List<LeagueGroup> groups;

  /// Fixtures played that day, which is usually far more than [shown].
  final int total;
  final int shown;

  bool get isTrimmed => total > shown;

  factory MatchDay.fromJson(Map<String, dynamic> json) => MatchDay(
        date: json['date'] as String? ?? '',
        groups: (json['groups'] as List<dynamic>? ?? const [])
            .map((g) => LeagueGroup.fromJson(g as Map<String, dynamic>))
            .toList(growable: false),
        total: (json['total'] as num?)?.toInt() ?? 0,
        shown: (json['shown'] as num?)?.toInt() ?? 0,
      );
}

class LeagueGroup {
  const LeagueGroup({required this.competition, required this.fixtures});
  final Competition competition;
  final List<Fixture> fixtures;

  factory LeagueGroup.fromJson(Map<String, dynamic> json) => LeagueGroup(
        competition: Competition.fromJson(json['league'] as Map<String, dynamic>? ?? const {}),
        fixtures: (json['matches'] as List<dynamic>? ?? const [])
            .map((m) => Fixture.fromJson(m as Map<String, dynamic>))
            .toList(growable: false),
      );
}

enum PickStatus { pending, won, lost, voided }

extension PickStatusX on PickStatus {
  bool get isSettled => this == PickStatus.won || this == PickStatus.lost;

  static PickStatus parse(String? raw) => switch (raw?.toUpperCase()) {
        'WON' => PickStatus.won,
        'LOST' => PickStatus.lost,
        'VOID' => PickStatus.voided,
        _ => PickStatus.pending,
      };
}

/// One leg of a published slip.
class PickLeg {
  const PickLeg({
    required this.position,
    required this.home,
    required this.away,
    required this.competition,
    required this.kickoffUtc,
    required this.marketLabel,
    required this.pickLabel,
    required this.odds,
    required this.reason,
    required this.status,
    required this.resultText,
  });

  final int position;
  final String home;
  final String away;
  final String? competition;
  final DateTime kickoffUtc;
  final String marketLabel;
  final String pickLabel;
  final double odds;

  /// Why this leg was chosen, in the server's own words. Shown in full - a truncated reason is
  /// how a researched pick starts looking like a guess.
  final String reason;
  final PickStatus status;

  /// How it actually finished, once it has.
  final String? resultText;

  factory PickLeg.fromJson(Map<String, dynamic> json) => PickLeg(
        position: (json['position'] as num?)?.toInt() ?? 0,
        home: json['home'] as String? ?? '',
        away: json['away'] as String? ?? '',
        competition: json['competition'] as String?,
        kickoffUtc: DateTime.parse(json['kickoffAt'] as String).toUtc(),
        marketLabel: json['marketLabel'] as String? ?? '',
        pickLabel: json['pickLabel'] as String? ?? '',
        odds: (json['odds'] as num?)?.toDouble() ?? 0,
        reason: json['reason'] as String? ?? '',
        status: PickStatusX.parse(json['status'] as String?),
        resultText: json['resultText'] as String?,
      );
}

/// A published slip.
///
/// [unlocked] is false when the viewer's plan does not include picks, and the legs then arrive
/// empty. The screen shows the header and says what is behind the plan rather than rendering an
/// empty slip, and nothing is invented to fill the gap.
class DailyPick {
  const DailyPick({
    required this.id,
    required this.forDate,
    required this.target,
    required this.totalOdds,
    required this.confidence,
    required this.chance,
    required this.status,
    required this.legs,
    required this.unlocked,
  });

  final String id;
  final String forDate;

  /// The odds this slip was built to reach - the user picks a target, not a number of games.
  final int target;
  final double totalOdds;
  final String confidence;

  /// An estimated chance in words, as the server phrased it. Never presented as a certainty.
  final String chance;
  final PickStatus status;
  final List<PickLeg> legs;
  final bool unlocked;

  factory DailyPick.fromJson(Map<String, dynamic> json) => DailyPick(
        id: json['id'] as String? ?? '',
        forDate: json['forDate'] as String? ?? '',
        target: (json['target'] as num?)?.toInt() ?? 0,
        totalOdds: (json['totalOdds'] as num?)?.toDouble() ?? 0,
        confidence: json['confidence'] as String? ?? '',
        chance: json['chance'] as String? ?? '',
        status: PickStatusX.parse(json['status'] as String?),
        legs: (json['legs'] as List<dynamic>? ?? const [])
            .map((l) => PickLeg.fromJson(l as Map<String, dynamic>))
            .toList(growable: false),
        unlocked: json['unlocked'] == true,
      );
}

/// The published record, losses included.
///
/// [winRate] and [roi] are null until something has settled, because a rate over zero settled
/// picks is not 0% - it is not a number yet.
class TrackRecord {
  const TrackRecord({
    required this.total,
    required this.won,
    required this.lost,
    required this.pending,
    required this.winRate,
    required this.roi,
    required this.picks,
  });

  final int total;
  final int won;
  final int lost;
  final int pending;
  final double? winRate;
  final double? roi;
  final List<DailyPick> picks;

  int get settled => won + lost;

  factory TrackRecord.fromJson(Map<String, dynamic> json) => TrackRecord(
        total: (json['total'] as num?)?.toInt() ?? 0,
        won: (json['won'] as num?)?.toInt() ?? 0,
        lost: (json['lost'] as num?)?.toInt() ?? 0,
        pending: (json['pending'] as num?)?.toInt() ?? 0,
        winRate: (json['winRate'] as num?)?.toDouble(),
        roi: (json['roi'] as num?)?.toDouble(),
        picks: (json['picks'] as List<dynamic>? ?? const [])
            .map((p) => DailyPick.fromJson(p as Map<String, dynamic>))
            .toList(growable: false),
      );
}

/// A pick on a slip, as the bookmaker's catalogue resolved it.
///
/// [status] is the part that matters. A selection the bookmaker does not offer, or whose game has
/// already kicked off, is kept on the slip and shown as unbookable rather than silently dropped:
/// a slip that quietly loses two legs between being read and being booked is worse than one that
/// says what it could not carry over.
enum SelectionStatus { ok, eventNotFound, marketNotFound, eventStarted, unsupportedMarket }

extension SelectionStatusX on SelectionStatus {
  bool get isOk => this == SelectionStatus.ok;

  /// The server sends its own wording for a problem; this is the fallback.
  String get reason => switch (this) {
        SelectionStatus.ok => '',
        SelectionStatus.eventNotFound => 'Game not found on this bookmaker',
        SelectionStatus.marketNotFound => "Game found, but this market isn't offered",
        SelectionStatus.eventStarted => "Game already started, so it can't be booked",
        SelectionStatus.unsupportedMarket => 'Market not supported yet',
      };

  static SelectionStatus parse(String? raw) => switch (raw) {
        'EVENT_NOT_FOUND' => SelectionStatus.eventNotFound,
        'MARKET_NOT_FOUND' => SelectionStatus.marketNotFound,
        'EVENT_STARTED' => SelectionStatus.eventStarted,
        'UNSUPPORTED_MARKET' => SelectionStatus.unsupportedMarket,
        _ => SelectionStatus.ok,
      };
}

class Selection {
  const Selection({
    required this.position,
    required this.home,
    required this.away,
    required this.competition,
    required this.kickoffUtc,
    required this.marketLabel,
    required this.pickLabel,
    required this.odds,
    required this.status,
    required this.started,
    this.reason,
  });

  final int position;
  final String home;
  final String away;
  final String? competition;
  final DateTime kickoffUtc;
  final String marketLabel;
  final String pickLabel;

  /// Null when the bookmaker did not price it. Never shown as 0 - an unpriced pick has no price,
  /// and a 0 would multiply a slip's odds to nothing.
  final double? odds;
  final SelectionStatus status;
  final bool started;

  /// Why this pick is on the slip, for slips we built.
  final String? reason;

  factory Selection.fromJson(Map<String, dynamic> json) => Selection(
        position: (json['position'] as num?)?.toInt() ?? 0,
        home: json['home'] as String? ?? '',
        away: json['away'] as String? ?? '',
        competition: json['competition'] as String?,
        kickoffUtc: DateTime.parse(json['kickoffAt'] as String).toUtc(),
        marketLabel: json['marketLabel'] as String? ?? '',
        pickLabel: json['pickLabel'] as String? ?? '',
        odds: (json['odds'] as num?)?.toDouble(),
        status: SelectionStatusX.parse(json['status'] as String?),
        started: json['started'] == true,
        reason: json['reason'] as String?,
      );
}

class SlipWarning {
  const SlipWarning({required this.code, required this.message});
  final String code;
  final String message;

  factory SlipWarning.fromJson(Map<String, dynamic> json) => SlipWarning(
        code: json['code'] as String? ?? '',
        message: json['message'] as String? ?? '',
      );
}

/// A booking code on a bookmaker, and the picks behind it.
class Slip {
  const Slip({
    required this.id,
    required this.bookmakerName,
    required this.bookmakerSlug,
    required this.code,
    required this.totalOdds,
    required this.selectionCount,
    required this.selections,
    required this.warnings,
    required this.demo,
    required this.expiresAtUtc,
  });

  final String id;
  final String bookmakerName;
  final String bookmakerSlug;

  /// Null when the slip was built but not booked. Shown as "not booked", never as an empty box
  /// that looks like a code failed to render.
  final String? code;
  final double? totalOdds;
  final int selectionCount;
  final List<Selection> selections;
  final List<SlipWarning> warnings;

  /// True when the bookmaker adapter is the sample one: the code is real-looking but will not work
  /// on the bookmaker's site, and the screen has to say so.
  final bool demo;

  final DateTime? expiresAtUtc;

  factory Slip.fromJson(Map<String, dynamic> json) {
    final bookmaker = json['bookmaker'] as Map<String, dynamic>? ?? const {};
    return Slip(
      id: json['id'] as String? ?? '',
      bookmakerName: bookmaker['name'] as String? ?? '',
      bookmakerSlug: bookmaker['slug'] as String? ?? '',
      code: json['code'] as String?,
      totalOdds: (json['totalOdds'] as num?)?.toDouble(),
      selectionCount: (json['selectionCount'] as num?)?.toInt() ?? 0,
      selections: (json['selections'] as List<dynamic>? ?? const [])
          .map((s) => Selection.fromJson(s as Map<String, dynamic>))
          .toList(growable: false),
      warnings: (json['warnings'] as List<dynamic>? ?? const [])
          .map((w) => SlipWarning.fromJson(w as Map<String, dynamic>))
          .toList(growable: false),
      demo: json['demo'] == true,
      expiresAtUtc: json['expiresAt'] == null ? null : DateTime.parse(json['expiresAt'] as String).toUtc(),
    );
  }
}

/// What the user has left today.
class AiAllowance {
  const AiAllowance({
    required this.planName,
    required this.remaining,
    required this.kind,
    required this.allowDailyPicks,
  });

  /// Null on no plan at all.
  final String? planName;

  /// Messages left today, or trial credits on the free plan.
  final int remaining;

  /// 'plan' or 'trial'.
  final String kind;
  final bool allowDailyPicks;

  factory AiAllowance.fromJson(Map<String, dynamic> json) => AiAllowance(
        planName: (json['plan'] as Map<String, dynamic>?)?['name'] as String?,
        remaining: (json['remaining'] as num?)?.toInt() ?? 0,
        kind: json['kind'] as String? ?? 'trial',
        allowDailyPicks: json['allowDailyPicks'] == true,
      );
}

class QuickReply {
  const QuickReply({required this.label, required this.message});
  final String label;
  final String message;

  factory QuickReply.fromJson(Map<String, dynamic> json) => QuickReply(
        label: json['label'] as String? ?? '',
        message: json['message'] as String? ?? '',
      );
}

/// One answer from the assistant.
class ChatResult {
  const ChatResult({
    required this.reply,
    required this.slips,
    required this.allowance,
    required this.quickReplies,
  });

  final String reply;
  final List<Slip> slips;
  final AiAllowance? allowance;
  final List<QuickReply> quickReplies;

  factory ChatResult.fromJson(Map<String, dynamic> json) => ChatResult(
        reply: json['reply'] as String? ?? '',
        slips: (json['slips'] as List<dynamic>? ?? const [])
            .map((s) => Slip.fromJson(s as Map<String, dynamic>))
            .toList(growable: false),
        allowance: json['allowance'] == null
            ? null
            : AiAllowance.fromJson(json['allowance'] as Map<String, dynamic>),
        quickReplies: (json['quickReplies'] as List<dynamic>? ?? const [])
            .map((q) => QuickReply.fromJson(q as Map<String, dynamic>))
            .toList(growable: false),
      );
}
