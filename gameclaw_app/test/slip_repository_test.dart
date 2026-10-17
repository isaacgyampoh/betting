import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/api_client.dart';
import 'package:gameclaw_app/data/repository.dart';

/// The shapes the slip endpoints actually answer with.
///
/// Converting and booking are separate calls on purpose, and the edit endpoint answers with a
/// list because one of its operations splits a slip into several. Getting either wrong is quiet:
/// a slip renders with no selections and no code, and looks like a server fault.
void main() {
  late List<RequestOptions> sent;

  SlipsRepository repoThat(Object body, {int status = 200}) {
    sent = [];
    final dio = Dio(
      BaseOptions(baseUrl: 'https://example.invalid/api/v1', validateStatus: (_) => true),
    )..httpClientAdapter = _Spy(sent, status, jsonEncode(body));
    return SlipsRepository(
      api: ApiClient(
        config: const ApiConfig(baseUrl: 'https://example.invalid/api/v1'),
        dio: dio,
      ),
    );
  }

  Map<String, dynamic> slipBody({String? code, int picks = 3}) => {
    'id': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'bookmaker': {'slug': 'footballcom', 'name': 'Football.com'},
    'code': code,
    'demo': false,
    'totalOdds': 2.93,
    'selectionCount': picks,
    'selections': [
      for (var i = 1; i <= picks; i++)
        {
          'position': i,
          'home': 'Home $i',
          'away': 'Away $i',
          'kickoffAt': '2026-10-18T19:00:00.000Z',
          'marketLabel': '1X2',
          'pickLabel': 'Home $i',
          'odds': 1.4,
          'status': 'OK',
        },
    ],
    'warnings': <dynamic>[],
  };

  group('converting', () {
    test('asks for a draft rather than booking, and says so in the body', () async {
      await repoThat({'data': slipBody()}).convert(slipId: 'abc', target: 'footballcom');

      expect(sent.single.path, '/slips/convert');
      final body = sent.single.data as Map<String, dynamic>;
      expect(body['book'], false, reason: 'nothing may be booked before the user has seen it');
      expect(body['target'], 'footballcom');
    });

    test('a draft with no code is a slip, not an error', () async {
      final slip = await repoThat({
        'data': slipBody(),
      }).convert(slipId: 'abc', target: 'footballcom');
      expect(slip.code, isNull);
      expect(slip.selections, hasLength(3));
    });

    // The conversion reads every game at the destination; twenty seconds is not enough for it.
    test('is given longer than an ordinary read', () async {
      await repoThat({'data': slipBody()}).convert(slipId: 'abc', target: 'footballcom');
      expect(sent.single.receiveTimeout!.inSeconds, greaterThan(20));
    });
  });

  group('booking', () {
    test('posts to the slip it was given, with no body', () async {
      await repoThat({'data': slipBody(code: 'BZJPR0')}).book(slipId: 'xyz');
      expect(sent.single.path, '/slips/xyz/book');
      expect(sent.single.method, 'POST');
    });

    test('returns the code the server reported, and nothing else', () async {
      final slip = await repoThat({'data': slipBody(code: 'BZJPR0')}).book(slipId: 'xyz');
      expect(slip.code, 'BZJPR0');
    });
  });

  group('removing a selection', () {
    // The edit endpoint answers with a list, because `split` makes several slips. Reading it as
    // an object produced a slip with no selections and no code - a silent, confusing failure.
    test('reads the list the edit endpoint answers with', () async {
      final slip = await repoThat({
        'data': [slipBody(picks: 2)],
      }).removeSelections(slipId: 'abc', positions: [1]);

      expect(slip.selections, hasLength(2));
      expect(slip.code, isNull);
    });

    test('sends the position the user pointed at', () async {
      await repoThat({
        'data': [slipBody(picks: 2)],
      }).removeSelections(slipId: 'abc', positions: [3]);

      final body = sent.single.data as Map<String, dynamic>;
      expect(body['op'], {
        'type': 'remove',
        'positions': [3],
      });
      expect(body['book'], false, reason: 'an edit must not book behind the user');
    });

    test('an empty list is reported rather than rendered as an empty slip', () async {
      await expectLater(
        repoThat({'data': <dynamic>[]}).removeSelections(slipId: 'abc', positions: [1]),
        throwsA(isA<ApiFailure>()),
      );
    });
  });
}

class _Spy implements HttpClientAdapter {
  _Spy(this.sent, this.status, this.body);
  final List<RequestOptions> sent;
  final int status;
  final String body;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) async {
    sent.add(options);
    return ResponseBody.fromString(
      body,
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
