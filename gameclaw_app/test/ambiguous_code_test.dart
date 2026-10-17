import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/api_client.dart';

/// SportyBet and Football.com share a coupon namespace, so a code valid on both comes back as a
/// question: "that code works on more than one bookmaker, which one is it from?". The candidates
/// arrive alongside it. Dropping them means the screen asks a question it gives no way to answer,
/// which is worse than not asking.
void main() {
  ApiClient clientReturning(int status, Map<String, dynamic> body) {
    final dio = Dio(BaseOptions(baseUrl: 'https://x.invalid', validateStatus: (_) => true))
      ..httpClientAdapter = _Canned(status, jsonEncode(body));
    return ApiClient(
      config: const ApiConfig(baseUrl: 'https://x.invalid'),
      dio: dio,
    );
  }

  /// Runs the call and hands back whatever it threw. `expectLater` cannot be used here: it
  /// attaches an error handler to a typed future and Dart refuses the mismatched return.
  Future<Object?> failureFrom(ApiClient client, Map<String, dynamic> body) async {
    try {
      await client.post<Map<String, dynamic>>('/slips/load', body: body);
      return null;
    } catch (e) {
      return e;
    }
  }

  test('an ambiguous code carries its candidates through', () async {
    final client = clientReturning(409, {
      'error': {
        'code': 'AMBIGUOUS_BOOKMAKER',
        'message': 'That code works on more than one bookmaker. Which one is it from?',
        'details': {
          'candidates': [
            {'slug': 'sportybet', 'name': 'SportyBet'},
            {'slug': 'footballcom', 'name': 'Football.com'},
          ],
        },
      },
    });

    final failure = await failureFrom(client, {'code': 'C92AY5'});

    expect(failure, isA<ServerFailure>());
    final server = failure! as ServerFailure;
    expect(server.code, 'AMBIGUOUS_BOOKMAKER');
    final candidates = server.details?['candidates'] as List<dynamic>;
    expect(candidates.map((c) => (c as Map)['slug']), ['sportybet', 'footballcom']);
    expect(candidates.map((c) => (c as Map)['name']), ['SportyBet', 'Football.com']);
  });

  test('a refusal with no details is still a clean failure', () async {
    final client = clientReturning(404, {
      'error': {'code': 'NOT_FOUND', 'message': 'No slip for that code.'},
    });

    final failure = await failureFrom(client, {'code': 'ZZZZ'});

    final server = failure! as ServerFailure;
    expect(server.code, 'NOT_FOUND');
    expect(server.details, isNull);
    // The server's own wording survives: it knows why, and anything invented here would be worse.
    expect(server.message, 'No slip for that code.');
  });

  test('a refusal with no error envelope at all does not crash the parser', () async {
    final client = clientReturning(500, <String, dynamic>{});
    final failure = await failureFrom(client, {'code': 'ZZZZ'});

    expect(failure, isA<ServerFailure>());
    expect((failure! as ServerFailure).details, isNull);
  });
}

class _Canned implements HttpClientAdapter {
  _Canned(this.status, this.body);
  final int status;
  final String body;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) async => ResponseBody.fromString(
    body,
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

  @override
  void close({bool force = false}) {}
}
