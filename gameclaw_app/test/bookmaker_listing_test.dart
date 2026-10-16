import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';

/// A bookmaker refusing our servers is not the same as one we never built. The Convert screen
/// lists them apart, because telling somebody that their perfectly valid MSport code is from an
/// unsupported bookmaker sends them looking for a problem at their end that is not there.
void main() {
  Bookmaker from(Map<String, dynamic> json) => Bookmaker.fromJson(json);

  test('a working bookmaker carries no refusal', () {
    final b = from({'slug': 'sportybet', 'name': 'SportyBet', 'canLoad': true, 'canBook': true});
    expect(b.canLoad, isTrue);
    expect(b.canBook, isTrue);
    expect(b.refusedReason, isNull);
  });

  test('one with no integration is unavailable and gives no reason', () {
    final b = from({'slug': 'betway', 'name': 'Betway', 'canLoad': false, 'canBook': false});
    expect(b.refusedReason, isNull);
  });

  test('one that is turning us away says so', () {
    final b = from({
      'slug': 'msport',
      'name': 'MSport',
      'canLoad': false,
      'canBook': false,
      'refusedReason': 'MSport is not accepting requests from our servers at the moment.',
    });
    expect(b.canBook, isFalse);
    expect(b.refusedReason, contains('not accepting requests'));
  });

  // An older server, or a cached payload from before the field existed, must not break the screen.
  test('a payload with no refusedReason key still parses', () {
    expect(
      from({
        'slug': 'betpawa',
        'name': 'betPawa',
        'canLoad': false,
        'canBook': false,
      }).refusedReason,
      isNull,
    );
  });

  test('the two groups the screen draws are disjoint', () {
    final all = [
      from({'slug': 'sportybet', 'name': 'SportyBet', 'canLoad': true, 'canBook': true}),
      from({'slug': 'betway', 'name': 'Betway', 'canLoad': false, 'canBook': false}),
      from({
        'slug': 'msport',
        'name': 'MSport',
        'canLoad': false,
        'canBook': false,
        'refusedReason': 'MSport is not accepting requests from our servers at the moment.',
      }),
    ];
    final unusable = all.where((b) => !b.canLoad && !b.canBook).toList();
    final refused = unusable.where((b) => b.refusedReason != null).map((b) => b.slug);
    final unbuilt = unusable.where((b) => b.refusedReason == null).map((b) => b.slug);

    expect(refused, ['msport']);
    expect(unbuilt, ['betway']);
    expect(refused.toSet().intersection(unbuilt.toSet()), isEmpty);
  });
}
