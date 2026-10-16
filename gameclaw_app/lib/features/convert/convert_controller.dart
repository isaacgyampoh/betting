import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../domain/models.dart';

/// Where the user is in the import-and-convert flow.
enum ConvertStage { entry, loaded, converted }

class ConvertState {
  const ConvertState({
    this.stage = ConvertStage.entry,
    this.source,
    this.result,
    this.busy = false,
    this.error,
  });

  final ConvertStage stage;

  /// The slip read from the pasted code.
  final Slip? source;

  /// What the destination bookmaker actually produced. Null until a conversion has run and come
  /// back - never pre-filled, because an empty result rendered optimistically is a claim that a
  /// conversion happened.
  final Slip? result;

  final bool busy;
  final ApiFailure? error;

  ConvertState copyWith({
    ConvertStage? stage,
    Slip? source,
    Slip? result,
    bool? busy,
    ApiFailure? error,
    bool clearError = false,
  }) => ConvertState(
    stage: stage ?? this.stage,
    source: source ?? this.source,
    result: result ?? this.result,
    busy: busy ?? this.busy,
    error: clearError ? null : (error ?? this.error),
  );
}

class ConvertController extends Notifier<ConvertState> {
  @override
  ConvertState build() => const ConvertState();

  /// Reads a pasted booking code.
  ///
  /// The bookmaker is left to the server to detect unless the user picked one: codes have
  /// recognisable shapes, and making someone identify their own bookmaker before they can paste
  /// is a question the product can usually answer itself.
  Future<void> load(String code, {String? bookmaker}) async {
    final trimmed = code.trim();
    if (trimmed.isEmpty || state.busy) return;

    state = state.copyWith(busy: true, clearError: true);
    try {
      final slip = await ref
          .read(slipsRepositoryProvider)
          .load(code: trimmed, bookmaker: bookmaker);
      state = ConvertState(stage: ConvertStage.loaded, source: slip);
    } on ApiFailure catch (failure) {
      // The server's own wording is better than anything here: it knows whether the code was
      // malformed, expired, for a bookmaker we cannot read, or simply not found.
      state = state.copyWith(busy: false, error: failure);
    }
  }

  Future<void> convert(String target) async {
    final source = state.source;
    if (source == null || state.busy) return;

    state = state.copyWith(busy: true, clearError: true);
    try {
      final converted = await ref
          .read(slipsRepositoryProvider)
          .convert(slipId: source.id, target: target);
      state = ConvertState(stage: ConvertStage.converted, source: source, result: converted);
    } on ApiFailure catch (failure) {
      // Stay on the loaded slip. The source is still good and the user may want another
      // destination; throwing them back to an empty box would lose the code they pasted.
      state = state.copyWith(busy: false, error: failure);
    }
  }

  /// Back to the loaded slip, keeping it, so another destination can be tried.
  void tryAnother() {
    if (state.source == null) return;
    state = ConvertState(stage: ConvertStage.loaded, source: state.source);
  }

  void reset() => state = const ConvertState();
}

final convertProvider = NotifierProvider<ConvertController, ConvertState>(ConvertController.new);
