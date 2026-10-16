import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/domain/models.dart';

/// A lifetime figure built on a handful of slips describes a period nobody is betting in any
/// more, in both directions. The 30-day view is the same settled slips, bounded.
void main() {
  Map<String, dynamic> body({
    required String window,
    required int total,
    required int won,
    required int lost,
    bool smallSample = false,
  }) => {
    'window': window,
    'smallSample': smallSample,
    'total': total,
    'won': won,
    'lost': lost,
    'pending': total - won - lost,
    'winRate': won + lost == 0 ? null : (won / (won + lost)) * 100,
    'roi': won + lost == 0 ? null : -35.1,
    'picks': <dynamic>[],
  };

  test('reads which window the server answered for', () {
    expect(
      TrackRecord.fromJson(body(window: '30d', total: 4, won: 1, lost: 3)).window,
      RecordWindow.last30,
    );
    expect(
      TrackRecord.fromJson(body(window: 'all', total: 9, won: 1, lost: 7)).window,
      RecordWindow.all,
    );
  });

  test('an unknown window falls back to all time rather than throwing', () {
    expect(
      TrackRecord.fromJson(body(window: 'quarterly', total: 1, won: 1, lost: 0)).window,
      RecordWindow.all,
    );
  });

  test('carries the small-sample warning the server worked out', () {
    expect(
      TrackRecord.fromJson(
        body(window: '30d', total: 4, won: 1, lost: 3, smallSample: true),
      ).smallSample,
      isTrue,
    );
    expect(
      TrackRecord.fromJson(body(window: 'all', total: 40, won: 12, lost: 28)).smallSample,
      isFalse,
    );
  });

  // Zero settled slips is not a 0% win rate, and never shows as one.
  test('nothing settled leaves the rates null, not zero', () {
    final record = TrackRecord.fromJson(body(window: '30d', total: 2, won: 0, lost: 0));
    expect(record.settled, 0);
    expect(record.winRate, isNull);
    expect(record.roi, isNull);
  });

  test('each window has a label and its own query value', () {
    expect(RecordWindow.all.query, 'all');
    expect(RecordWindow.last30.query, '30d');
    for (final w in RecordWindow.values) {
      expect(w.label, isNotEmpty);
    }
  });
}
