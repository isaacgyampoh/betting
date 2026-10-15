import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../domain/models.dart';
import '../theme/tokens.dart';

/// One match in a list.
///
/// The layout is a three-column grid rather than a Row of whatever each part needs: a fixed status
/// column on the left, the teams taking the rest, and a fixed score column on the right. That is
/// what makes a list of thirty fixtures scan as columns - with intrinsic widths every row's score
/// sits somewhere slightly different and the eye has to re-find it each time.
class GcFixtureTile extends StatelessWidget {
  const GcFixtureTile({super.key, required this.fixture, this.onTap});

  final Fixture fixture;
  final VoidCallback? onTap;

  static const _statusWidth = 52.0;
  static const _scoreWidth = 34.0;

  @override
  Widget build(BuildContext context) {
    final live = fixture.status.isLive;
    // Local time: a kickoff is a time of day where the user is, not in UTC.
    final kickoff = DateFormat.Hm().format(fixture.kickoffUtc.toLocal());

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: GcSpace.lg, vertical: GcSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            SizedBox(
              width: _statusWidth,
              child: _Status(fixture: fixture, kickoff: kickoff, live: live),
            ),
            const SizedBox(width: GcSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _TeamLine(team: fixture.home, dim: _losing(home: true)),
                  const SizedBox(height: GcSpace.xs),
                  _TeamLine(team: fixture.away, dim: _losing(home: false)),
                ],
              ),
            ),
            const SizedBox(width: GcSpace.sm),
            SizedBox(
              width: _scoreWidth,
              child: _Score(fixture: fixture, live: live),
            ),
          ],
        ),
      ),
    );
  }

  /// A finished match dims the side that lost, which is how a result reads at a glance without
  /// adding a word. Only ever applied once there is a score to judge: a goalless first minute is
  /// not a team losing.
  bool _losing({required bool home}) {
    if (!fixture.status.isDone || !fixture.hasScore) return false;
    final h = fixture.homeGoals!, a = fixture.awayGoals!;
    if (h == a) return false;
    return home ? h < a : a < h;
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.fixture, required this.kickoff, required this.live});

  final Fixture fixture;
  final String kickoff;
  final bool live;

  @override
  Widget build(BuildContext context) {
    if (live) {
      return Row(
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: const BoxDecoration(color: GcColors.live, shape: BoxShape.circle),
          ),
          const SizedBox(width: GcSpace.xs),
          Expanded(
            child: Text(
              // The provider's own label - "45+2'", "HT". Re-deriving a minute on the device gets
              // it wrong the moment a half is added to.
              fixture.statusLabel,
              style: GcType.figure.copyWith(color: GcColors.live, fontSize: 12),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      );
    }

    final (text, colour) = switch (fixture.status) {
      MatchStatus.finished => ('FT', GcColors.inkFaint),
      MatchStatus.postponed => ('Post.', GcColors.warn),
      MatchStatus.cancelled => ('Canc.', GcColors.warn),
      _ => (kickoff, GcColors.inkMuted),
    };

    return Text(
      text,
      style: GcType.figure.copyWith(color: colour, fontSize: 12),
      overflow: TextOverflow.ellipsis,
    );
  }
}

class _TeamLine extends StatelessWidget {
  const _TeamLine({required this.team, required this.dim});

  final Team team;
  final bool dim;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _Crest(url: team.logoUrl),
        const SizedBox(width: GcSpace.sm),
        Expanded(
          child: Text(
            team.name,
            style: GcType.body.copyWith(
              fontSize: 14,
              color: dim ? GcColors.inkMuted : GcColors.ink,
              fontWeight: dim ? FontWeight.w400 : FontWeight.w500,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

/// A team crest, or a reserved space where one would be.
///
/// The space is reserved whether or not the image loads, so a league where half the crests are
/// missing still lines its names up. A failed load leaves the gap rather than a broken-image icon.
class _Crest extends StatelessWidget {
  const _Crest({required this.url});

  final String? url;

  static const _size = 18.0;

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) return const SizedBox(width: _size, height: _size);
    return SizedBox(
      width: _size,
      height: _size,
      child: Image.network(
        url!,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
        // No fade: a list of twenty crests fading in at different moments is visual noise.
        gaplessPlayback: true,
      ),
    );
  }
}

class _Score extends StatelessWidget {
  const _Score({required this.fixture, required this.live});

  final Fixture fixture;
  final bool live;

  @override
  Widget build(BuildContext context) {
    // No score reported is a dash, not a zero. The difference is the whole point.
    if (!fixture.hasScore) {
      return Text(
        '–',
        textAlign: TextAlign.right,
        style: GcType.score.copyWith(color: GcColors.inkFaint, fontSize: 15),
      );
    }

    final colour = live ? GcColors.live : GcColors.ink;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text('${fixture.homeGoals}', style: GcType.score.copyWith(fontSize: 14, color: colour)),
        const SizedBox(height: GcSpace.xs),
        Text('${fixture.awayGoals}', style: GcType.score.copyWith(fontSize: 14, color: colour)),
      ],
    );
  }
}

/// The heading above a competition's fixtures.
class GcCompetitionHeader extends StatelessWidget {
  const GcCompetitionHeader({super.key, required this.competition});

  final Competition competition;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: GcColors.surface,
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.lg, vertical: GcSpace.sm),
      child: Row(
        children: [
          Expanded(
            child: Text(
              competition.country.isEmpty
                  ? competition.name
                  : '${competition.country} · ${competition.name}',
              style: GcType.label.copyWith(color: GcColors.inkMuted, fontSize: 12),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
