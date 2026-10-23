import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../data/repository.dart';
import '../claw/claw_controller.dart';

/// A conversation about one match, kept separate from the slip assistant.
///
/// The server has always accepted a `matchId` alongside the conversation and nothing in the app
/// ever sent one, so there was no way to ask a question about the game you were looking at: the
/// only chat in the product is Claw, which builds and converts slips and lives on its own tab.
/// Opening it from a fixture lost the fixture.
///
/// Keyed by match id, so two matches are two threads and going back to one you were reading
/// returns you to what was said about it.
class MatchAnalystController extends Notifier<ChatState> {
  MatchAnalystController(this.matchId);

  /// The fixture this thread is about. Sent with every turn so the server can load it.
  final int matchId;

  @override
  ChatState build() {
    // Riverpod disposes a provider once nothing watches it, and the sheet is the only watcher -
    // so closing the sheet threw the conversation away, and reopening it started again from the
    // suggested questions. Someone who closes the sheet to look at the timeline and comes back to
    // ask a follow-up is the normal case, not an edge one.
    //
    // Session-lifetime only. Nothing is written to disk: these answers describe a scoreline and a
    // team sheet that move, and a thread restored tomorrow would read as current.
    ref.keepAlive();
    return const ChatState();
  }

  /// The last thing the user said, so a failed send can be retried without retyping it.
  String? get _lastQuestion {
    for (final turn in state.turns.reversed) {
      if (turn.isUser) return turn.text;
    }
    return null;
  }

  Future<void> ask(String text) async {
    final question = text.trim();
    if (question.isEmpty || state.sending) return;

    state = state.copyWith(
      turns: [...state.turns, ChatTurn(role: 'user', text: question)],
      sending: true,
      quickReplies: const [],
      clearError: true,
    );

    try {
      final result = await ref
          .read(chatRepositoryProvider)
          .send(
            // Only turns the server actually received. Replaying a failed one would answer it
            // twice and bill the allowance for both.
            history: [
              for (final t in state.turns)
                if (!t.failed) t,
            ],
            matchId: matchId,
          );
      state = state.copyWith(
        turns: [
          ...state.turns,
          ChatTurn(role: 'assistant', text: result.reply, slips: result.slips),
        ],
        sending: false,
        quickReplies: result.quickReplies,
        allowance: result.allowance,
      );
    } on ApiFailure catch (failure) {
      // The question stays in the thread, marked unsent. Losing what someone typed because the
      // network dropped is the one failure that makes people stop trusting a chat.
      state = state.copyWith(
        turns: [
          for (final t in state.turns)
            if (t.isUser && t.text == question && !t.failed) t.copyWith(failed: true) else t,
        ],
        sending: false,
        error: failure,
      );
    }
  }

  /// Re-sends the last question, dropping the failed copy so it is not asked twice.
  Future<void> retry() async {
    final question = _lastQuestion;
    if (question == null || state.sending) return;
    state = state.copyWith(
      turns: [
        for (final t in state.turns)
          if (!(t.isUser && t.text == question && t.failed)) t,
      ],
      clearError: true,
    );
    await ask(question);
  }
}

final matchAnalystProvider = NotifierProvider.family<MatchAnalystController, ChatState, int>(
  MatchAnalystController.new,
);
