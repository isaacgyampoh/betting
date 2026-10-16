import 'api_client.dart';

/// When a failed read is worth attempting again, and when it is not.
///
/// Riverpod retries a failed provider on its own, up to ten times with a backoff. Left at its
/// default that is wrong here in both directions: a 401 was retried eleven times against the
/// server - once for the answer and ten more to be told the same thing - while the user sat
/// looking at a spinner that could never resolve. Watching the dev server's log is what showed it;
/// nothing on screen suggested anything was happening.
///
/// So the rule is the same one the cache uses: a transport problem may be worth another go, and
/// anything the server actually decided is not.
Duration? gcRetry(int attempt, Object error) {
  // Four tries in total. Beyond that the user is better served by a retry button they control
  // than by an app quietly hammering a server that is evidently struggling.
  if (attempt >= 3) return null;

  final worthRetrying = switch (error) {
    OfflineFailure() || TimeoutFailure() => true,
    // 5xx is the server having a bad moment. 4xx is the server having decided.
    ServerFailure(:final status) => status >= 500,
    // All three of these are the server having decided something about this user. Asking again
    // with the same session gets the same answer.
    UnauthorizedFailure() || AgeNotConfirmedFailure() || ForbiddenFailure() => false,
    // Anything unrecognised is most likely a bug in our own parsing, and a bug does not get better
    // by being run again.
    _ => false,
  };
  if (!worthRetrying) return null;

  // 400ms, 800ms, 1600ms.
  return Duration(milliseconds: 400 * (1 << attempt));
}
