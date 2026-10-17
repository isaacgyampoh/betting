import 'api_client.dart';

/// What the server knows about what this user follows.
///
/// Three kinds, because they are different intentions: a **team** means every game it plays, a
/// **fixture** means one match and then nothing, a **competition** means everything in it.
enum FollowKind { fixture, team, competition }

extension FollowKindWire on FollowKind {
  String get wire => switch (this) {
    FollowKind.fixture => 'FIXTURE',
    FollowKind.team => 'TEAM',
    FollowKind.competition => 'COMPETITION',
  };

  static FollowKind? parse(String? value) => switch (value) {
    'FIXTURE' => FollowKind.fixture,
    'TEAM' => FollowKind.team,
    'COMPETITION' => FollowKind.competition,
    _ => null,
  };
}

/// Which events a follow should produce an alert for.
class AlertPrefs {
  const AlertPrefs({
    this.kickoff = true,
    this.goals = true,
    this.redCards = true,
    this.halfTime = false,
    this.fullTime = true,
  });

  final bool kickoff;
  final bool goals;
  final bool redCards;
  final bool halfTime;
  final bool fullTime;

  factory AlertPrefs.fromJson(Map<String, dynamic> json) => AlertPrefs(
    kickoff: json['kickoff'] as bool? ?? true,
    goals: json['goals'] as bool? ?? true,
    redCards: json['redCards'] as bool? ?? true,
    halfTime: json['halfTime'] as bool? ?? false,
    fullTime: json['fullTime'] as bool? ?? true,
  );

  Map<String, dynamic> toJson() => {
    'kickoff': kickoff,
    'goals': goals,
    'redCards': redCards,
    'halfTime': halfTime,
    'fullTime': fullTime,
  };

  AlertPrefs copyWith({
    bool? kickoff,
    bool? goals,
    bool? redCards,
    bool? halfTime,
    bool? fullTime,
  }) => AlertPrefs(
    kickoff: kickoff ?? this.kickoff,
    goals: goals ?? this.goals,
    redCards: redCards ?? this.redCards,
    halfTime: halfTime ?? this.halfTime,
    fullTime: fullTime ?? this.fullTime,
  );
}

class Follow {
  const Follow({
    required this.kind,
    required this.targetId,
    required this.label,
    required this.muted,
    required this.alerts,
  });

  final FollowKind kind;
  final int targetId;
  final String? label;
  final bool muted;
  final AlertPrefs alerts;

  static Follow? fromJson(Map<String, dynamic> json) {
    final kind = FollowKindWire.parse(json['kind'] as String?);
    final target = (json['targetId'] as num?)?.toInt();
    if (kind == null || target == null) return null;
    return Follow(
      kind: kind,
      targetId: target,
      label: json['label'] as String?,
      muted: json['muted'] as bool? ?? false,
      alerts: AlertPrefs.fromJson(
        (json['alerts'] as Map<String, dynamic>?) ?? const <String, dynamic>{},
      ),
    );
  }
}

/// Reads and writes follows on the server.
///
/// Every call needs a session; the API answers 401 without one. The caller decides what that
/// means - signed out, following is a local preference and the server is simply not told.
class FollowsClient {
  const FollowsClient(this._api);

  final ApiClient _api;

  Future<List<Follow>> list() async {
    final body = await _api.get<Map<String, dynamic>>('/follows');
    final rows = (body['follows'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(Follow.fromJson)
        .whereType<Follow>()
        .toList();
    return rows;
  }

  /// Follows, or updates the label, alerts or mute state of a follow that already exists.
  ///
  /// One call rather than three. The client's intent is "this is how I want this follow to be",
  /// and splitting it into follow-then-configure invites the half-done state where the second
  /// request fails and the user is following something with the wrong alerts.
  Future<void> set(
    FollowKind kind,
    int targetId, {
    String? label,
    AlertPrefs? alerts,
    bool? muted,
  }) => _api.post<Map<String, dynamic>>(
    '/follows',
    body: {
      'kind': kind.wire,
      'targetId': targetId,
      if (label != null) 'label': label,
      if (alerts != null) 'alerts': alerts.toJson(),
      if (muted != null) 'muted': muted,
    },
  );

  Future<void> remove(FollowKind kind, int targetId) => _api.delete<Map<String, dynamic>>(
    '/follows',
    body: {'kind': kind.wire, 'targetId': targetId},
  );
}
