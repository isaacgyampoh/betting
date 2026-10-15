import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../data/repository.dart';
import '../../domain/models.dart';

/// A conversation.
///
/// The turns are the screen's state rather than the server's: the server is stateless and is sent
/// the whole history each time, which is what lets a conversation survive the app being killed
/// mid-answer without a session on the server to resume.
class ChatState {
  const ChatState({
    this.turns = const [],
    this.sending = false,
    this.quickReplies = const [],
    this.allowance,
    this.error,
  });

  final List<ChatTurn> turns;
  final bool sending;
  final List<QuickReply> quickReplies;
  final AiAllowance? allowance;

  /// The last failure, shown as a line in the thread rather than as a dialog over it: a dialog
  /// hides the conversation the user is trying to continue.
  final ApiFailure? error;

  ChatState copyWith({
    List<ChatTurn>? turns,
    bool? sending,
    List<QuickReply>? quickReplies,
    AiAllowance? allowance,
    ApiFailure? error,
    bool clearError = false,
  }) =>
      ChatState(
        turns: turns ?? this.turns,
        sending: sending ?? this.sending,
        quickReplies: quickReplies ?? this.quickReplies,
        allowance: allowance ?? this.allowance,
        error: clearError ? null : (error ?? this.error),
      );
}

class ChatController extends Notifier<ChatState> {
  @override
  ChatState build() => const ChatState();

  /// Slips already shown, so the server does not send the same card twice in one conversation.
  List<String> get _seen => [
        for (final turn in state.turns)
          for (final slip in turn.slips) slip.id,
      ];

  Future<void> send(String text) async {
    final message = text.trim();
    if (message.isEmpty || state.sending) return;

    final turn = ChatTurn(role: 'user', text: message);
    state = state.copyWith(
      turns: [...state.turns, turn],
      sending: true,
      quickReplies: const [],
      clearError: true,
    );

    try {
      final result = await ref.read(chatRepositoryProvider).send(
            // Only turns that were actually delivered: a failed turn was never seen by the server,
            // and replaying it as history would answer it twice.
            history: [for (final t in state.turns) if (!t.failed) t],
            seenSlipIds: _seen,
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
      // The user's words stay on screen, marked unsent, so a retry is one tap and not a retype.
      final turns = [...state.turns];
      turns[turns.length - 1] = turns.last.copyWith(failed: true);
      state = state.copyWith(turns: turns, sending: false, error: failure);
    }
  }

  /// Re-sends the last message that failed.
  Future<void> retry() async {
    final last = state.turns.lastOrNull;
    if (last == null || !last.failed) return;
    state = state.copyWith(turns: state.turns.sublist(0, state.turns.length - 1), clearError: true);
    await send(last.text);
  }

  void clear() => state = const ChatState();
}

final chatProvider = NotifierProvider<ChatController, ChatState>(ChatController.new);
