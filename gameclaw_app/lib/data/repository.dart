import 'dart:convert';

import '../domain/models.dart';
import 'api_client.dart';
import 'local/cache.dart';

/// A value, and whether it is current.
///
/// Carried everywhere rather than unwrapped early, because "this is what we had at 14:32" and
/// "this is what is true now" are different claims and only the screen can phrase the difference.
/// A live score read ten minutes ago is worse than no score if the user is not told.
class Cached<T> {
  const Cached({required this.value, required this.fetchedAt, required this.fromCache});

  final T value;
  final DateTime fetchedAt;

  /// True when the network failed and this came off disk.
  final bool fromCache;

  Cached<R> map<R>(R Function(T) f) =>
      Cached<R>(value: f(value), fetchedAt: fetchedAt, fromCache: fromCache);
}

/// Reads football data, preferring the network and falling back to what was last seen.
///
/// The fallback is deliberately narrow: only a connection failure or a timeout reaches for the
/// cache. A refusal from the server - unauthorised, not found, rate limited - is passed through,
/// because showing yesterday's list to someone whose session expired hides the thing they need to
/// fix. The cache covers being on a bad connection, not covering up errors.
class FootballRepository {
  FootballRepository({required ApiClient api, CacheDb? cache}) : _api = api, _cache = cache;

  final ApiClient _api;
  final CacheDb? _cache;

  /// A day's fixtures. [date] is YYYY-MM-DD in UTC, which is how the server groups a matchday.
  Future<Cached<MatchDay>> matchDay(String date) => _read(
    key: 'matches:$date',
    fetch: () => _api.get<Map<String, dynamic>>('/matches', query: {'date': date}),
    parse: MatchDay.fromJson,
  );

  Future<Cached<MatchDetail>> matchDetail(int id, {String? dateHint}) => _read(
    key: 'match:$id',
    fetch: () => _api.get<Map<String, dynamic>>(
      '/matches/$id',
      query: dateHint == null ? null : {'date': dateHint},
    ),
    // The fetch time is the detail's own, so a cached match centre dates itself.
    parse: (json) => MatchDetail.fromJson(json),
  );

  Future<Cached<List<DailyPick>>> todaysPicks() => _read(
    key: 'picks:today',
    fetch: () => _api.get<List<dynamic>>('/picks'),
    parse: (list) =>
        list.map((p) => DailyPick.fromJson(p as Map<String, dynamic>)).toList(growable: false),
  );

  /// Everything a team page shows, in one request: profile, recent results, upcoming fixtures,
  /// form and squad. One round trip rather than five, because on a slow connection the difference
  /// is the page arriving at once or in pieces.
  Future<Cached<TeamPage>> team(int id) => _read(
    key: 'team:$id',
    fetch: () => _api.get<Map<String, dynamic>>('/teams/$id'),
    parse: TeamPage.fromJson,
  );

  Future<Cached<CompetitionPage>> competition(int id) => _read(
    key: 'competition:$id',
    fetch: () => _api.get<Map<String, dynamic>>('/competitions/$id'),
    parse: CompetitionPage.fromJson,
  );

  /// The competition catalogue, filtered on the server. About 1,250 competitions across 171
  /// countries exist, so the filtering has to happen where the whole list is.
  Future<Cached<CompetitionDirectory>> competitions({String? country, String? search}) => _read(
    key: 'competitions:${country ?? ''}:${search ?? ''}',
    fetch: () => _api.get<Map<String, dynamic>>(
      '/competitions',
      query: {
        if (country != null) 'country': country,
        if (search != null && search.isNotEmpty) 'search': search,
      },
    ),
    parse: CompetitionDirectory.fromJson,
  );

  Future<Cached<TrackRecord>> trackRecord({RecordWindow window = RecordWindow.all}) => _read(
    key: 'record:${window.query}',
    fetch: () =>
        _api.get<Map<String, dynamic>>('/picks/track-record', query: {'window': window.query}),
    parse: TrackRecord.fromJson,
  );

  /// Network first, disk second, and the disk only for a connection problem.
  Future<Cached<T>> _read<J, T>({
    required String key,
    required Future<J> Function() fetch,
    required T Function(J) parse,
  }) async {
    try {
      final json = await fetch();
      final at = DateTime.now().toUtc();
      // Written after parsing, so a response the app cannot read is never cached as if it could.
      final value = parse(json);
      await _cache?.write(key, jsonEncode(json), at);
      return Cached(value: value, fetchedAt: at, fromCache: false);
    } on OfflineFailure {
      return await _fromCache(key, parse) ?? (throw const OfflineFailure());
    } on TimeoutFailure {
      return await _fromCache(key, parse) ?? (throw const TimeoutFailure());
    }
  }

  Future<Cached<T>?> _fromCache<J, T>(String key, T Function(J) parse) async {
    final row = await _cache?.read(key);
    if (row == null) return null;
    try {
      return Cached(
        value: parse(jsonDecode(row.payload) as J),
        fetchedAt: row.fetchedAt,
        fromCache: true,
      );
    } on Object {
      // A payload written by an older build whose shape has since changed. Treat it as absent
      // rather than crashing the screen; the next successful fetch overwrites it.
      return null;
    }
  }
}

/// The assistant.
///
/// Separate from [FootballRepository] because none of it is cacheable: a conversation turn is not
/// a thing to re-read off disk, and a slip's prices go stale in minutes. Asking offline fails, and
/// says so, rather than replaying an old answer as if it were new.
class ChatRepository {
  ChatRepository({required ApiClient api}) : _api = api;

  final ApiClient _api;

  Future<ChatResult> send({
    required List<ChatTurn> history,
    int? matchId,
    List<String> seenSlipIds = const [],
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/ai/chat',
      body: {
        // The server keeps its own window; sending the whole conversation each time is what lets it.
        'messages': [
          for (final turn in history) {'role': turn.role, 'content': turn.text},
        ],
        if (matchId != null) 'matchId': matchId,
        if (seenSlipIds.isNotEmpty) 'seenSlipIds': seenSlipIds,
      },
      // Claw reads fixtures, prices and form before it answers, and the route is declared
      // `maxDuration = 60` for that reason. Anything shorter here throws away finished work.
      receiveTimeout: const Duration(seconds: 70),
    );
    return ChatResult.fromJson(json);
  }

  Future<AiAllowance> allowance() async =>
      AiAllowance.fromJson(await _api.get<Map<String, dynamic>>('/ai/allowance'));
}

/// One message in a conversation.
class ChatTurn {
  const ChatTurn({
    required this.role,
    required this.text,
    this.slips = const [],
    this.failed = false,
  });

  /// 'user' or 'assistant'. The server rejects anything else, and rightly.
  final String role;
  final String text;

  /// Slips the assistant produced with this turn.
  final List<Slip> slips;

  /// A turn that could not be sent. Kept in the list so the user's words are not lost, and marked
  /// so they can retry rather than retype.
  final bool failed;

  bool get isUser => role == 'user';

  ChatTurn copyWith({bool? failed}) =>
      ChatTurn(role: role, text: text, slips: slips, failed: failed ?? this.failed);
}

/// Reading a booking code, and converting one bookmaker's slip to another.
///
/// Nothing here is cacheable. A slip's prices go stale in minutes and a booking code is issued
/// once, so a cached conversion would be a code that may no longer price what it says it does.
class SlipsRepository {
  SlipsRepository({required ApiClient api}) : _api = api;

  final ApiClient _api;

  /// Every bookmaker the server has enabled, with what each can do.
  Future<List<Bookmaker>> bookmakers() async {
    final list = await _api.get<List<dynamic>>('/bookmakers');
    return list.map((b) => Bookmaker.fromJson(b as Map<String, dynamic>)).toList(growable: false);
  }

  /// Reads an existing booking code. [bookmaker] may be omitted, and the server detects it from
  /// the code's own shape - which is what lets a user paste a code without knowing or caring
  /// which bookmaker issued it.
  Future<Slip> load({required String code, String? bookmaker}) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/slips/load',
      body: {'code': code, if (bookmaker != null) 'bookmaker': bookmaker},
    );
    return Slip.fromJson(json);
  }

  /// Merges chosen legs from several slips onto one destination.
  ///
  /// [picks] names each leg by the slip it came from and its position on that slip, so the server
  /// never has to re-identify a selection from its wording. `book: false` stops at a draft: every
  /// leg is found at the destination and priced there, and nothing is booked until the user says
  /// so - the same two-step shape a conversion uses.
  ///
  /// Returns the draft and any duplicates that collapsed, which the screen must show. A leg that
  /// silently disappears between choosing and booking is the one thing a merge must never do.
  Future<MergeResult> merge({
    required List<MergePick> picks,
    required String target,
    bool book = false,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/slips/merge',
      body: {
        'target': target,
        'book': book,
        'picks': [
          for (final p in picks) {'slipId': p.slipId, 'position': p.position},
        ],
      },
      receiveTimeout: const Duration(seconds: 90),
    );
    return MergeResult.fromJson(json);
  }

  /// Works out what a destination can carry, without booking anything.
  ///
  /// Every expensive part still happens - each game is found at the destination and its own price
  /// read - and then it stops. What comes back is a real draft: how many selections that
  /// bookmaker can take, which ones it cannot, and why. Nobody should have to commit to a move to
  /// find out they were going to lose three legs.
  Future<Slip> convert({required String slipId, required String target}) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/slips/convert',
      body: {'slipId': slipId, 'target': target, 'book': false},
      receiveTimeout: const Duration(seconds: 70),
    );
    return Slip.fromJson(json);
  }

  /// Asks the bookmaker to issue a code for a draft that has already been converted.
  ///
  /// Books exactly the selections the draft holds - nothing is re-matched or re-priced - so "the
  /// code is these selections" is a true statement rather than a hope. Booking the same draft
  /// twice returns the code it already has rather than issuing a second one.
  Future<Slip> book({required String slipId}) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/slips/$slipId/book',
      receiveTimeout: const Duration(seconds: 70),
    );
    return Slip.fromJson(json);
  }

  /// Removes selections from a slip, by position.
  ///
  /// The server re-books what is left. Positions are the user's own numbering, so removing leg 3
  /// removes the one labelled 3 - not the third surviving one.
  Future<Slip> removeSelections({required String slipId, required List<int> positions}) async {
    // The edit endpoint answers with a list, because one of its operations splits a slip into
    // several. Removing never does, so there is exactly one slip here - but it is a list, and
    // reading it as an object silently produced a slip with no selections and no code.
    final list = await _api.post<List<dynamic>>(
      '/slips/$slipId/edit',
      body: {
        'op': {'type': 'remove', 'positions': positions},
        'book': false,
      },
      receiveTimeout: const Duration(seconds: 70),
    );
    if (list.isEmpty) {
      throw const UnknownFailure('That edit left nothing on the slip.');
    }
    return Slip.fromJson(list.first as Map<String, dynamic>);
  }
}
