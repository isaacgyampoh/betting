import 'package:flutter/material.dart';

import '../motion.dart';
import 'package:intl/intl.dart';

import '../../domain/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'gc_crest.dart';
import 'gc_live.dart';

/// One match in a list. The most-repeated row in the product, so it is the one worth getting right.
///
/// Three fixed columns rather than a Row of whatever each part needs: a status column on the left,
/// the teams taking the rest, and a score column on the right. With intrinsic widths every row's
/// score sits somewhere slightly different and the eye has to re-find it on every line; fixed
/// columns are what let thirty fixtures be scanned rather than read.
class GcFixtureRow extends StatelessWidget {
  const GcFixtureRow({
    super.key,
    required this.fixture,
    this.onTap,
    this.isFavourite = false,
    this.onToggleFavourite,
  });

  final Fixture fixture;
  final VoidCallback? onTap;
  final bool isFavourite;
  final VoidCallback? onToggleFavourite;

  static const _statusWidth = 38.0;
  static const _scoreWidth = 22.0;

  @override
  Widget build(BuildContext context) {
    final live = fixture.status.isLive;
    final decided = fixture.status.isDone && fixture.hasScore;
    final homeLost = decided && fixture.homeGoals! < fixture.awayGoals!;
    final awayLost = decided && fixture.awayGoals! < fixture.homeGoals!;

    return Semantics(
      button: onTap != null,
      label: _spoken(),
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: GcSize.fixtureRow),
          padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.md),
          child: Row(
            children: [
              SizedBox(
                width: _statusWidth,
                child: _Status(fixture: fixture, live: live),
              ),
              const SizedBox(width: GcSpace.sm),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _TeamLine(team: fixture.home, dimmed: homeLost),
                    const SizedBox(height: GcSpace.sm),
                    _TeamLine(team: fixture.away, dimmed: awayLost),
                  ],
                ),
              ),
              const SizedBox(width: GcSpace.sm),
              SizedBox(
                width: _scoreWidth,
                child: _Score(fixture: fixture, live: live, homeLost: homeLost, awayLost: awayLost),
              ),
              if (onToggleFavourite != null) ...[
                const SizedBox(width: GcSpace.xs),
                _Star(on: isFavourite, onTap: onToggleFavourite!),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// What a screen reader says instead of walking the columns one cell at a time.
  String _spoken() {
    final score = fixture.hasScore ? '${fixture.homeGoals} ${fixture.awayGoals}' : 'no score';
    final when = fixture.status.isLive
        ? 'live, ${fixture.statusLabel}'
        : fixture.status.isDone
        ? 'finished'
        : 'kicks off ${DateFormat.Hm().format(fixture.kickoffUtc.toLocal())}';
    return '${fixture.home.name} versus ${fixture.away.name}, $when, $score';
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.fixture, required this.live});

  final Fixture fixture;
  final bool live;

  @override
  Widget build(BuildContext context) {
    if (live) {
      return Row(
        children: [
          const GcLiveDot(size: 5),
          const SizedBox(width: GcSpace.xs),
          Expanded(
            child: Text(
              // The provider's own clock. Re-deriving a minute on the device gets it wrong the
              // moment a half is added to, and wrong by a minute is worse than not shown.
              shortLiveLabel(fixture.statusLabel),
              style: GcType.figureSm.copyWith(color: gc(context).live, fontSize: 11.5),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      );
    }

    final (text, colour) = switch (fixture.status) {
      MatchStatus.finished => ('FT', gc(context).inkFaint),
      MatchStatus.postponed => ('PP', gc(context).warn),
      MatchStatus.cancelled => ('CA', gc(context).warn),
      _ => (DateFormat.Hm().format(fixture.kickoffUtc.toLocal()), gc(context).inkMuted),
    };

    return Text(
      text,
      style: GcType.figureSm.copyWith(color: colour, fontSize: 12),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }
}

class _TeamLine extends StatelessWidget {
  const _TeamLine({required this.team, required this.dimmed});

  final Team team;

  /// A finished match dims the side that lost, which is how a result reads at a glance without
  /// adding a word. Only ever once there is a score to judge.
  final bool dimmed;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        GcCrest(url: team.logoUrl, name: team.name),
        const SizedBox(width: GcSpace.sm + 2),
        Expanded(
          child: Text(
            team.name,
            style: GcType.bodyStrong.copyWith(
              fontSize: 14.5,
              color: dimmed ? gc(context).inkMuted : gc(context).ink,
              fontWeight: dimmed ? FontWeight.w500 : FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _Score extends StatelessWidget {
  const _Score({
    required this.fixture,
    required this.live,
    required this.homeLost,
    required this.awayLost,
  });

  final Fixture fixture;
  final bool live;
  final bool homeLost;
  final bool awayLost;

  @override
  Widget build(BuildContext context) {
    // No score reported is a dash, not a zero. The difference between "nothing published" and
    // "nil-nil" is the one the whole product rests on.
    if (!fixture.hasScore) {
      return Text(
        '–',
        textAlign: TextAlign.right,
        style: GcType.score.copyWith(color: gc(context).inkFaint),
      );
    }

    // A goal is the one thing on this screen somebody is waiting for, so the number does not
    // simply swap underneath them: the old one leaves upward and the new one arrives from below,
    // the way a flip board moves. Keyed on the value, so nothing moves unless the score changed -
    // a refresh that returns the same score is still a silent, still frame.
    Widget line(int goals, bool lost) {
      Widget text({Key? key}) => Text(
        '$goals',
        key: key,
        textAlign: TextAlign.right,
        style: GcType.score.copyWith(
          fontSize: 15,
          color: live ? gc(context).live : (lost ? gc(context).inkMuted : gc(context).ink),
        ),
      );
      // The key belongs inside the switcher and nowhere else. Both sides of a 0-0 produce the
      // same value, and two siblings keyed ValueKey(0) in one Column is a duplicate-key crash -
      // on every level score in every live match. The existing nil-nil test caught it.
      if (!live || !gcMotionAllowed(context)) return text();
      return AnimatedSwitcher(
        duration: GcMotion.base,
        switchInCurve: GcMotion.emphasis,
        transitionBuilder: (child, animation) => ClipRect(
          child: SlideTransition(
            position: Tween(begin: const Offset(0, 0.6), end: Offset.zero).animate(animation),
            child: FadeTransition(opacity: animation, child: child),
          ),
        ),
        child: text(key: ValueKey(goals)),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        line(fixture.homeGoals!, homeLost),
        const SizedBox(height: GcSpace.sm),
        line(fixture.awayGoals!, awayLost),
      ],
    );
  }
}

class _Star extends StatelessWidget {
  const _Star({required this.on, required this.onTap});

  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: on ? 'Remove from favourites' : 'Add to favourites',
      child: InkResponse(
        onTap: onTap,
        radius: 20,
        child: SizedBox(
          width: 34,
          height: 34,
          child: Icon(
            on ? Icons.star_rounded : Icons.star_outline_rounded,
            size: 18,
            color: on ? gc(context).accentInk : gc(context).inkFaint,
          ),
        ),
      ),
    );
  }
}

/// The heading above a competition's fixtures. Pinned while its own fixtures scroll past.
class GcCompetitionHeader extends StatelessWidget {
  const GcCompetitionHeader({super.key, required this.competition, this.trailing});

  final Competition competition;
  final Widget? trailing;

  static const height = 34.0;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      color: gc(context).canvas,
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter),
      child: Row(
        children: [
          GcCrest(url: competition.logoUrl, name: competition.name, size: 14),
          const SizedBox(width: GcSpace.sm),
          Expanded(
            child: Text(
              competition.country.isEmpty
                  ? competition.name
                  : '${competition.country} · ${competition.name}',
              style: GcType.overline.copyWith(color: gc(context).inkMuted, fontSize: 10.5),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// A pinned sliver header. Flutter has no sticky sliver header in the framework, and a package for
/// one line of layout is a dependency to keep updated for ever.
class GcPinnedHeader extends SliverPersistentHeaderDelegate {
  const GcPinnedHeader({required this.child, this.height = GcCompetitionHeader.height});

  final Widget child;
  final double height;

  @override
  double get minExtent => height;

  @override
  double get maxExtent => height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) =>
      SizedBox(height: height, child: child);

  @override
  bool shouldRebuild(GcPinnedHeader old) => old.child != child || old.height != height;
}
