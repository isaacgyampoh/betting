import 'package:flutter/material.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// A club crest, or the space where one would be.
///
/// The space is reserved whether or not the image loads, so a competition where half the crests
/// are missing still lines its team names up. A failure leaves the initial rather than a broken
/// image icon, and nothing is ever substituted from elsewhere - an invented crest is an invented
/// fact about a club.
class GcCrest extends StatelessWidget {
  const GcCrest({super.key, required this.url, required this.name, this.size = GcSize.crestSm});

  final String? url;
  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    final initial = name.trim().isEmpty ? '?' : name.trim().characters.first.toUpperCase();

    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: gc(context).surfaceRaised,
        borderRadius: BorderRadius.circular(size / 4),
      ),
      child: Text(
        initial,
        style: GcType.figureSm.copyWith(fontSize: size * 0.46, color: gc(context).inkFaint),
      ),
    );

    if (url == null || url!.isEmpty) return fallback;

    return SizedBox(
      width: size,
      height: size,
      child: Image.network(
        url!,
        fit: BoxFit.contain,
        // No fade: twenty crests fading in at different moments is visual noise on a list.
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => fallback,
        loadingBuilder: (context, child, progress) => progress == null ? child : fallback,
      ),
    );
  }
}
