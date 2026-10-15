import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/data/api_client.dart';
import 'package:gameclaw_app/data/retry.dart';

/// The policy these pin down was written after watching a real device: a 401 against the local
/// server was re-requested eleven times, because Riverpod retries a failed provider by default and
/// nothing about "please sign in" tells it not to.
void main() {
  test('a signed-out user is not retried at the server', () {
    expect(gcRetry(0, const UnauthorizedFailure()), isNull);
  });

  test('being offline is worth another go', () {
    expect(gcRetry(0, const OfflineFailure()), isNotNull);
    expect(gcRetry(0, const TimeoutFailure()), isNotNull);
  });

  test('the server having a bad moment is retried; the server having decided is not', () {
    expect(gcRetry(0, const ServerFailure('busy', status: 503)), isNotNull);
    expect(gcRetry(0, const ServerFailure('no such match', status: 404)), isNull);
    expect(gcRetry(0, const ServerFailure('bad request', status: 400)), isNull);
  });

  test('it gives up, rather than retrying for as long as the screen is open', () {
    expect(gcRetry(2, const OfflineFailure()), isNotNull);
    expect(gcRetry(3, const OfflineFailure()), isNull);
  });

  test('the wait grows, so a struggling server is not hammered', () {
    final first = gcRetry(0, const OfflineFailure())!;
    final second = gcRetry(1, const OfflineFailure())!;
    expect(second, greaterThan(first));
  });

  test('a bug in our own parsing is not retried', () {
    // Running the same broken parse again produces the same broken parse.
    expect(gcRetry(0, const UnknownFailure()), isNull);
    expect(gcRetry(0, ArgumentError('type cast')), isNull);
  });
}
