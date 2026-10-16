import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/api_client.dart';
import 'package:gameclaw_app/data/local/cache.dart';
import 'package:gameclaw_app/data/providers.dart';
import 'package:gameclaw_app/data/repository.dart';
import 'package:gameclaw_app/domain/models.dart';

/// Two things the app got wrong about the shape of its own requests, both found on the device
/// against production rather than in a unit test, and both invisible from the server's side.
void main() {
  late _Spy spy;
  late CacheDb cache;

  setUp(() {
    spy = _Spy();
    cache = CacheDb.memory();
  });
  tearDown(() => cache.close());

  /// Mirrors what ApiClient builds for itself, sharing the one timeout constant so this test
  /// fails if production's default ever moves.
  ApiClient clientThat(String body) => ApiClient(
    config: const ApiConfig(baseUrl: 'https://example.invalid/api/v1'),
    dio: Dio(
      BaseOptions(
        baseUrl: 'https://example.invalid/api/v1',
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: kGcReceiveTimeout,
        validateStatus: (_) => true,
      ),
    )..httpClientAdapter = (spy..body = body),
  );

  group('Claw is given room to think', () {
    // The server declares `maxDuration = 60` for the conversation and a real reply measured
    // 20.07 seconds against production. The client's blanket 20-second receive timeout fired
    // 69 milliseconds earlier and the finished answer was thrown away as "that took too long".
    test('the chat request outlasts the default twenty seconds', () async {
      final repo = ChatRepository(api: clientThat(jsonEncode({'data': _chatBody})));
      await repo.send(
        history: [const ChatTurn(role: 'user', text: 'a slip for tonight')],
      );

      expect(spy.last!.path, '/ai/chat');
      expect(
        spy.last!.receiveTimeout!.inSeconds,
        greaterThan(60),
        reason: 'must outlast the route\'s own maxDuration of 60s',
      );
    });

    test('an ordinary football read keeps the short timeout', () async {
      final repo = FootballRepository(
        api: clientThat(jsonEncode({'data': _picksBody})),
        cache: cache,
      );
      await repo.todaysPicks();

      expect(spy.last!.path, '/picks');
      expect(
        spy.last!.receiveTimeout,
        kGcReceiveTimeout,
        reason: 'raising the global timeout would hang every screen on a dead connection',
      );
    });
  });

  group('a match carries the day it was opened from', () {
    // Without the hint the server has to ask the provider for this one fixture by id, which is a
    // separate upstream call that can be refused on its own. On the Pixel that is exactly what
    // happened: the day list loaded, and tapping a row in it returned 503.
    test('the detail request sends ?date= when the caller knew it', () async {
      final repo = FootballRepository(
        api: clientThat(jsonEncode({'data': _detailBody})),
        cache: cache,
      );
      await repo.matchDetail(1570415, dateHint: '2026-10-16');

      expect(spy.last!.path, '/matches/1570415');
      expect(spy.last!.queryParameters['date'], '2026-10-16');
    });

    test('a deep link with no hint still opens the match', () async {
      final repo = FootballRepository(
        api: clientThat(jsonEncode({'data': _detailBody})),
        cache: cache,
      );
      await repo.matchDetail(1570415);

      expect(spy.last!.queryParameters.containsKey('date'), isFalse);
    });

    test('MatchRef takes the day from the fixture itself, in UTC', () {
      // 00:30 UTC on the 17th is the evening of the 16th in Accra and the morning of the 17th in
      // Tokyo. The server groups days in UTC, so that is the only answer that finds the fixture.
      final fixture = Fixture(
        id: 7,
        kickoffUtc: DateTime.utc(2026, 10, 17, 0, 30),
        status: MatchStatus.scheduled,
        statusLabel: 'Not Started',
        competition: const Competition(id: 39, name: 'Premier League', country: 'England'),
        home: const Team(id: 1, name: 'Arsenal'),
        away: const Team(id: 2, name: 'Chelsea'),
      );

      expect(matchDayOf(fixture), '2026-10-17');
      expect(MatchRef.of(fixture), const MatchRef(7, '2026-10-17'));
    });

    test('a MatchRef is keyed by both parts, so one day does not serve another', () {
      expect(const MatchRef(1, '2026-10-16'), equals(const MatchRef(1, '2026-10-16')));
      expect(const MatchRef(1, '2026-10-16'), isNot(equals(const MatchRef(1, '2026-10-17'))));
      expect(const MatchRef(1, '2026-10-16'), isNot(equals(const MatchRef(1))));
    });
  });
}

const _chatBody = {'reply': 'Here is a slip.', 'slips': [], 'quickReplies': []};
const _picksBody = <Map<String, dynamic>>[];
const _detailBody = {
  'match': {
    'id': 1570415,
    'kickoffAt': '2026-10-16T19:00:00.000Z',
    'status': 'SCHEDULED',
    'statusLabel': 'Not Started',
    'league': {'id': 140, 'name': 'La Liga', 'country': 'Spain', 'season': 2026},
    'home': {'id': 1, 'name': 'Deportivo La Coruna'},
    'away': {'id': 2, 'name': 'Levante'},
  },
  'h2h': [],
  'events': [],
  'statistics': [],
  'lineups': [],
  'unavailable': [],
  'busy': false,
};

/// Records the request Dio was about to make, which is the thing under test here.
class _Spy implements HttpClientAdapter {
  String body = '{}';
  RequestOptions? last;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) async {
    last = options;
    return ResponseBody.fromString(
      body,
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
