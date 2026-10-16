import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/api_client.dart';
import 'package:gameclaw_app/data/local/cache.dart';
import 'package:gameclaw_app/data/repository.dart';

/// What the cache is for, and what it is deliberately not for.
///
/// The rule under test: a connection failure falls back to what was last seen, and anything the
/// server actually answered does not. Showing yesterday's list to someone whose session expired
/// hides the one thing they need to fix.
void main() {
  late CacheDb cache;

  setUp(() => cache = CacheDb.memory());
  tearDown(() => cache.close());

  Map<String, dynamic> matchDayBody({required int total}) => {
    'data': {
      'date': '2026-10-15',
      'total': total,
      'shown': 2,
      'groups': [
        {
          'league': {'id': 39, 'name': 'Premier League', 'country': 'England', 'season': 2026},
          'matches': [
            {
              'id': 1,
              'kickoffAt': '2026-10-15T14:00:00.000Z',
              'status': 'FINISHED',
              'statusLabel': 'Match Finished',
              'league': {'id': 39, 'name': 'Premier League', 'country': 'England', 'season': 2026},
              'home': {'id': 1, 'name': 'Arsenal'},
              'away': {'id': 2, 'name': 'Chelsea'},
              'goals': {'home': 2, 'away': 1},
            },
            {
              'id': 2,
              'kickoffAt': '2026-10-15T16:30:00.000Z',
              'status': 'SCHEDULED',
              'statusLabel': 'Not Started',
              'league': {'id': 39, 'name': 'Premier League', 'country': 'England', 'season': 2026},
              'home': {'id': 3, 'name': 'Everton'},
              'away': {'id': 4, 'name': 'Fulham'},
            },
          ],
        },
      ],
    },
  };

  FootballRepository repoThat(_Reply reply) => FootballRepository(
    api: ApiClient(
      config: const ApiConfig(baseUrl: 'https://example.invalid/api/v1'),
      dio: Dio(BaseOptions(baseUrl: 'https://example.invalid/api/v1', validateStatus: (_) => true))
        ..httpClientAdapter = _FakeAdapter(reply),
    ),
    cache: cache,
  );

  test('a successful read is marked current and stored', () async {
    final result = await repoThat(_Reply.json(matchDayBody(total: 1284))).matchDay('2026-10-15');

    expect(result.fromCache, isFalse);
    expect(result.value.groups.single.fixtures, hasLength(2));
    expect(result.value.isTrimmed, isTrue, reason: '2 shown of 1284 is a trimmed list');

    final stored = await cache.read('matches:2026-10-15');
    expect(stored, isNotNull);
  });

  test('offline falls back to what was last seen, and says so', () async {
    await repoThat(_Reply.json(matchDayBody(total: 2))).matchDay('2026-10-15');

    final result = await repoThat(_Reply.offline()).matchDay('2026-10-15');

    expect(result.fromCache, isTrue);
    expect(result.value.groups.single.fixtures.first.homeGoals, 2);
    // The timestamp is the original read's, not now: that is what the banner shows the user.
    expect(
      result.fetchedAt.isBefore(DateTime.now().toUtc().add(const Duration(seconds: 1))),
      isTrue,
    );
  });

  test('offline with nothing cached fails rather than inventing a day', () async {
    await expectLater(
      repoThat(_Reply.offline()).matchDay('2026-10-15'),
      throwsA(isA<OfflineFailure>()),
    );
  });

  test('a refusal from the server is never papered over with cached data', () async {
    await repoThat(_Reply.json(matchDayBody(total: 2))).matchDay('2026-10-15');

    // The session expired. The user has to know - a cached list here hides it.
    await expectLater(
      repoThat(_Reply.status(401)).matchDay('2026-10-15'),
      throwsA(isA<UnauthorizedFailure>()),
    );
  });

  test('the server\'s own wording survives a refusal', () async {
    await expectLater(
      repoThat(
        _Reply.json({
          'error': {'code': 'STATS_UNAVAILABLE', 'message': 'Match stats are busy right now.'},
        }, status: 503),
      ).matchDay('2026-10-15'),
      throwsA(isA<ServerFailure>().having((e) => e.message, 'message', contains('busy'))),
    );
  });

  test('a cached payload the app can no longer read is treated as absent', () async {
    // What an older build left behind after the response shape changed.
    await cache.write(
      'matches:2026-10-15',
      jsonEncode({'groups': 'not a list'}),
      DateTime.now().toUtc(),
    );

    await expectLater(
      repoThat(_Reply.offline()).matchDay('2026-10-15'),
      throwsA(isA<OfflineFailure>()),
    );
  });

  test('a response that cannot be parsed is not cached as if it could', () async {
    final repo = repoThat(
      _Reply.json({
        'data': {'groups': 'not a list'},
      }),
    );

    await expectLater(repo.matchDay('2026-10-15'), throwsA(isA<Object>()));
    expect(await cache.read('matches:2026-10-15'), isNull);
  });
}

/// A canned HTTP response, so a repository test exercises the real Dio path - interceptors,
/// status handling, envelope unwrapping - without a server.
class _Reply {
  _Reply.json(Map<String, dynamic> body, {this.status = 200})
    : body = jsonEncode(body),
      error = null;
  _Reply.status(this.status) : body = '{}', error = null;
  _Reply.offline() : body = '', status = 0, error = DioExceptionType.connectionError;

  final String body;
  final int status;
  final DioExceptionType? error;
}

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.reply);

  final _Reply reply;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) async {
    if (reply.error != null) {
      throw DioException(requestOptions: options, type: reply.error!);
    }
    return ResponseBody.fromString(
      reply.body,
      reply.status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
