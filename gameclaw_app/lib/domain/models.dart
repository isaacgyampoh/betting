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

/// A fixture with everything the match centre shows, and an explicit record of what is missing.
class MatchDetail {
  const MatchDetail({
    required this.fixture,
    required this.events,
    required this.coverage,
    required this.unavailable,
    required this.fetchedAt,
  });

  final Fixture fixture;
  final List<MatchEvent> events;

  /// Null when the provider did not say what this competition carries.
  final Coverage? coverage;

  /// Sections the provider's plan did not return this time - a temporary gap, as distinct from a
  /// competition that never publishes them.
  final List<String> unavailable;

  /// When this was read. Shown on screen, so cached data is never passed off as current.
  final DateTime fetchedAt;

  factory MatchDetail.fromJson(Map<String, dynamic> json, {DateTime? fetchedAt}) => MatchDetail(
        fixture: Fixture.fromJson(json['match'] as Map<String, dynamic>),
        events: (json['events'] as List<dynamic>? ?? const [])
            .map((e) => MatchEvent.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
        coverage: json['coverage'] == null ? null : Coverage.fromJson(json['coverage'] as Map<String, dynamic>),
        unavailable: (json['unavailable'] as List<dynamic>? ?? const []).cast<String>(),
        fetchedAt: fetchedAt ?? DateTime.now().toUtc(),
      );
}
