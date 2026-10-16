import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../data/api_client.dart';
import '../../theme/tokens.dart';
import 'gc_button.dart';

/// Nothing to show, and why. Never a blank screen.
class GcEmpty extends StatelessWidget {
  const GcEmpty({
    super.key,
    required this.title,
    required this.note,
    this.icon,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String note;
  final IconData? icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.xxl, vertical: GcSpace.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Container(
                width: 56,
                height: 56,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: GcColors.surface,
                  borderRadius: BorderRadius.circular(GcRadius.lg),
                  border: Border.all(color: GcColors.border),
                ),
                child: Icon(icon, size: 24, color: GcColors.inkFaint),
              ),
              const SizedBox(height: GcSpace.lg),
            ],
            Text(title, style: GcType.heading, textAlign: TextAlign.center),
            const SizedBox(height: GcSpace.sm),
            Text(note, style: GcType.caption, textAlign: TextAlign.center),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: GcSpace.xl),
              GcButton(
                label: actionLabel!,
                onPressed: onAction,
                kind: GcButtonKind.secondary,
                size: GcButtonSize.small,
                expand: false,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A failure, with the one action that can actually resolve it.
///
/// Which action that is depends on the failure, and offering the wrong one is worse than offering
/// none: a Try again under "please sign in" invites the user to tap it until they give up. So
/// signing in gets a sign-in button, the 18+ refusal gets the gate, a self-exclusion gets nothing
/// to press, and only a transport problem gets a retry.
class GcError extends StatelessWidget {
  const GcError({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiFailure
        ? (error as ApiFailure).message
        : 'Something went wrong. Please try again.';

    final (icon, label, action) = switch (error) {
      OfflineFailure() => (Icons.cloud_off_rounded, 'Try again', onRetry),
      TimeoutFailure() => (Icons.schedule_rounded, 'Try again', onRetry),
      UnauthorizedFailure() => (
        Icons.lock_outline_rounded,
        'Sign in',
        () => context.push('/signin'),
      ),
      AgeNotConfirmedFailure() => (Icons.shield_outlined, 'Confirm', () => context.push('/age')),
      // A self-exclusion the user set themselves. There is deliberately nothing here to press.
      ForbiddenFailure() => (Icons.block_rounded, null, null),
      _ => (Icons.error_outline_rounded, 'Try again', onRetry),
    };

    return GcEmpty(
      title: switch (error) {
        OfflineFailure() => 'No connection',
        TimeoutFailure() => 'That took too long',
        UnauthorizedFailure() => 'Sign in to continue',
        AgeNotConfirmedFailure() => 'One thing first',
        _ => "That didn't work",
      },
      note: message,
      icon: icon,
      actionLabel: label,
      onAction: action,
    );
  }
}

/// A strip saying this screen is showing what was last downloaded.
///
/// Only appears when the data came off disk. Without it a cached live score is indistinguishable
/// from a current one, which is the single most misleading thing a football app can do.
class GcStaleBar extends StatelessWidget {
  const GcStaleBar({super.key, required this.fetchedAt});

  final DateTime fetchedAt;

  static String ago(DateTime at) {
    final age = DateTime.now().toUtc().difference(at);
    if (age.inMinutes < 1) return 'just now';
    if (age.inMinutes < 60) return '${age.inMinutes} min ago';
    if (age.inHours < 24) return '${age.inHours} hr ago';
    return '${age.inDays} days ago';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: GcColors.warn.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.sm),
      child: Row(
        children: [
          const Icon(Icons.cloud_off_rounded, size: 14, color: GcColors.warn),
          const SizedBox(width: GcSpace.sm),
          Expanded(
            child: Text(
              'Offline — saved ${ago(fetchedAt)}. Scores may have moved on.',
              style: GcType.caption.copyWith(color: GcColors.warn, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

/// A section heading. All-caps and small, so it reads as furniture and the content stays loudest.
class GcSectionHeader extends StatelessWidget {
  const GcSectionHeader({super.key, required this.title, this.trailing, this.dense = false});

  final String title;
  final Widget? trailing;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        GcSpace.gutter,
        dense ? GcSpace.lg : GcSpace.xl,
        GcSpace.gutter,
        GcSpace.md,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title.toUpperCase(),
              style: GcType.overline.copyWith(color: GcColors.inkFaint),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// A line of explanation where content would be. Used wherever something is genuinely absent, and
/// always says which kind of absent.
class GcNote extends StatelessWidget {
  const GcNote(this.text, {super.key, this.icon});

  final String text;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(GcSpace.md),
      decoration: BoxDecoration(
        color: GcColors.surface,
        borderRadius: BorderRadius.circular(GcRadius.md),
        border: Border.all(color: GcColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 15, color: GcColors.inkFaint),
            const SizedBox(width: GcSpace.sm),
          ],
          Expanded(child: Text(text, style: GcType.caption)),
        ],
      ),
    );
  }
}
