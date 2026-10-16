import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/api_client.dart';
import '../data/repository.dart';
import '../theme/tokens.dart';

/// The three states every data-backed screen has, rendered the same way each time.
///
/// Centralised because the loss here is silent: one screen showing a spinner for an error, another
/// showing an empty list for a failed request, and the user cannot tell "nothing today" from
/// "something broke". Each state says which it is, and only the retryable ones get a retry.
class GcAsyncView<T> extends StatelessWidget {
  const GcAsyncView({
    super.key,
    required this.value,
    required this.onRetry,
    required this.builder,
    this.loading,
  });

  final AsyncValue<Cached<T>> value;
  final VoidCallback onRetry;
  final Widget Function(BuildContext, Cached<T>) builder;

  /// Shown on the first load. A skeleton of the real layout where there is one, because a spinner
  /// in the middle of an empty screen tells the user nothing about what is coming.
  final Widget? loading;

  @override
  Widget build(BuildContext context) {
    return value.when(
      // Keep showing the last good data while a refresh is in flight: a pull-to-refresh that
      // blanks the screen looks like a failure.
      skipLoadingOnRefresh: true,
      data: (cached) => builder(context, cached),
      loading: () => loading ?? const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      error: (error, _) => GcErrorView(error: error, onRetry: onRetry),
    );
  }
}

/// A failure, with the one action that can actually resolve it.
///
/// Which action that is depends on the failure, and offering the wrong one is worse than offering
/// none: a Try again under "please sign in" invites the user to tap it until they give up. So
/// signing in gets a sign-in button, the 18+ refusal gets the gate, a self-exclusion gets nothing
/// to press, and only a transport problem gets a retry.
class GcErrorView extends StatelessWidget {
  const GcErrorView({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiFailure
        ? (error as ApiFailure).message
        : 'Something went wrong. Please try again.';

    final (icon, action) = switch (error) {
      OfflineFailure() => (Icons.wifi_off_rounded, _Action('Try again', onRetry)),
      TimeoutFailure() => (Icons.schedule_rounded, _Action('Try again', onRetry)),
      UnauthorizedFailure() => (
          Icons.lock_outline_rounded,
          _Action('Sign in', () => context.push('/signin')),
        ),
      AgeNotConfirmedFailure() => (
          Icons.verified_user_outlined,
          _Action('Confirm', () => context.push('/age')),
        ),
      // A self-exclusion the user set themselves. There is deliberately nothing here to press.
      ForbiddenFailure() => (Icons.block_rounded, null),
      _ => (Icons.error_outline_rounded, _Action('Try again', onRetry)),
    };

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(GcSpace.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: GcColors.inkFaint, size: 32),
            const SizedBox(height: GcSpace.md),
            Text(message, style: GcType.body, textAlign: TextAlign.center),
            if (action != null) ...[
              const SizedBox(height: GcSpace.lg),
              FilledButton(onPressed: action.onTap, child: Text(action.label)),
            ],
          ],
        ),
      ),
    );
  }
}

class _Action {
  const _Action(this.label, this.onTap);
  final String label;
  final VoidCallback onTap;
}

/// Nothing to show, and why. Never a blank screen.
class GcEmptyView extends StatelessWidget {
  const GcEmptyView({super.key, required this.title, required this.note, this.icon});

  final String title;
  final String note;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(GcSpace.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, color: GcColors.inkFaint, size: 32),
              const SizedBox(height: GcSpace.md),
            ],
            Text(title, style: GcType.heading, textAlign: TextAlign.center),
            const SizedBox(height: GcSpace.xs),
            Text(note, style: GcType.caption, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

/// A strip saying this screen is showing what was last downloaded.
///
/// Only appears when the data came off disk. Without it a cached live score is indistinguishable
/// from a current one, which is the single most misleading thing a football app can do.
class GcStaleBanner extends StatelessWidget {
  const GcStaleBanner({super.key, required this.fetchedAt});

  final DateTime fetchedAt;

  @override
  Widget build(BuildContext context) {
    final age = DateTime.now().toUtc().difference(fetchedAt);
    final when = age.inMinutes < 1
        ? 'just now'
        : age.inMinutes < 60
            ? '${age.inMinutes} min ago'
            : age.inHours < 24
                ? '${age.inHours} hr ago'
                : '${age.inDays} days ago';

    return Container(
      width: double.infinity,
      color: GcColors.warn.withValues(alpha: 0.14),
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.lg, vertical: GcSpace.sm),
      child: Row(
        children: [
          const Icon(Icons.cloud_off_rounded, size: 14, color: GcColors.warn),
          const SizedBox(width: GcSpace.sm),
          Expanded(
            child: Text(
              "Offline. Showing what was saved $when - scores may have moved on.",
              style: GcType.caption.copyWith(color: GcColors.warn),
            ),
          ),
        ],
      ),
    );
  }
}
