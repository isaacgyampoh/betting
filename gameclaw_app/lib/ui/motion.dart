import 'package:flutter/material.dart';

/// Whether this phone wants movement.
///
/// Android's "Remove animations" setting is not a preference about polish - it is set by people
/// who get motion sickness or vestibular symptoms from movement on screen, and by people running
/// the phone on a budget where every dropped frame is felt. A pulsing dot that never stops is
/// exactly the kind of thing it exists to switch off.
///
/// Everything that moves in this app asks here first. Nothing is removed when it is off: the live
/// dot still marks a live match, the score still changes, the mark is still drawn. They simply
/// arrive rather than animate.
bool gcMotionAllowed(BuildContext context) => !MediaQuery.disableAnimationsOf(context);

/// A duration that collapses to nothing when the phone has asked for no movement.
Duration gcDuration(BuildContext context, Duration duration) =>
    gcMotionAllowed(context) ? duration : Duration.zero;
