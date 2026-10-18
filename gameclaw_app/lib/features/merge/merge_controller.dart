import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api_client.dart';
import '../../data/providers.dart';
import '../../domain/models.dart';

/// Building one slip out of several.
///
/// The state is deliberately two lists and nothing clever: the source slips as they were read,
/// and the legs the user has ticked. Everything shown - the combined count, which legs are in,
/// what a destination could carry - is derived from those. A separate "merged list" kept alongside
/// them would be a second copy of the truth, and the two would drift the first time a leg was
/// removed from one and not the other.
class MergeState {
  const MergeState({
    this.sources = const [],
    this.picked = const {},
    this.result,
    this.duplicates = const [],
    this.pendingCode,
    this.busy = false,
    this.error,
    this.candidates = const [],
  });

  /// Slips the user has added, in the order they added them.
  final List<Slip> sources;

  /// Legs ticked for inclusion. Holds every tick the user made, including ones that will turn out
  /// to be duplicates - they are told about those rather than prevented from choosing them.
  final Set<MergePick> picked;

  /// The draft the destination produced. Null until a merge has actually run: an empty slip
  /// rendered optimistically is a claim that a merge happened.
  final Slip? result;

  /// Chosen legs that collapsed into one. Shown after a merge, never silently applied.
  final List<MergeDuplicate> duplicates;

  final bool busy;
  final ApiFailure? error;

  /// Bookmakers a refusal named as possible sources of the pasted code.
  ///
  /// SportyBet and Football.com share a coupon namespace, so a code valid on both comes back as a
  /// question rather than a slip. Carrying the candidates through is what turns that from a dead
  /// end - an error with no way to answer it - into a choice.
  final List<Bookmaker> candidates;

  /// The code the user was adding when the question was asked, so answering it can retry.
  final String? pendingCode;

  /// How many legs the user has chosen, before the destination has had its say.
  int get chosen => picked.length;

  /// Slips contributing at least one chosen leg. A merge needs two.
  int get contributingSlips => picked.map((p) => p.slipId).toSet().length;

  /// Whether a merge can be attempted at all.
  ///
  /// Two legs from two different slips. One slip is a conversion, which already has a screen, and
  /// offering "merge" for it would be the same operation under a second name.
  bool get canMerge => chosen >= 2 && contributingSlips >= 2 && !busy;

  bool isPicked(String slipId, int position) =>
      picked.contains(MergePick(slipId: slipId, position: position));

  MergeState copyWith({
    List<Slip>? sources,
    Set<MergePick>? picked,
    Slip? result,
    List<MergeDuplicate>? duplicates,
    bool? busy,
    ApiFailure? error,
    List<Bookmaker>? candidates,
    String? pendingCode,
    bool clearError = false,
    bool clearResult = false,
  }) => MergeState(
    sources: sources ?? this.sources,
    picked: picked ?? this.picked,
    result: clearResult ? null : (result ?? this.result),
    duplicates: clearResult ? const [] : (duplicates ?? this.duplicates),
    busy: busy ?? this.busy,
    error: clearError ? null : (error ?? this.error),
    candidates: clearError ? const [] : (candidates ?? this.candidates),
    pendingCode: clearError ? null : (pendingCode ?? this.pendingCode),
  );
}

class MergeController extends Notifier<MergeState> {
  @override
  MergeState build() => const MergeState();

  /// Adds a slip read from a booking code.
  ///
  /// Re-adding a slip already present is not an error and does not duplicate it: the same code
  /// pasted twice is a user checking their work, not a request for sixteen legs. Its legs stay
  /// ticked as they were, because silently clearing them would lose work the user did.
  Future<void> addCode(String code, {String? bookmaker}) async {
    final trimmed = code.trim().toUpperCase();
    if (trimmed.isEmpty || state.busy) return;
    state = state.copyWith(busy: true, clearError: true);
    try {
      final slip = await ref.read(slipsRepositoryProvider).load(code: trimmed, bookmaker: bookmaker);
      if (state.sources.any((s) => s.id == slip.id)) {
        state = state.copyWith(busy: false);
        return;
      }
      // Every leg the destination could use starts ticked. The common case is wanting all of
      // them, and unticking is easier than hunting for the ones worth keeping.
      final newPicks = {
        ...state.picked,
        for (final sel in slip.selections.where((s) => s.status.isOk))
          MergePick(slipId: slip.id, position: sel.position),
      };
      state = state.copyWith(
        sources: [...state.sources, slip],
        picked: newPicks,
        busy: false,
        clearResult: true,
      );
    } on ApiFailure catch (failure) {
      // One refusal is a question, not a failure: a code valid at more than one bookmaker comes
      // back asking which. Keeping the candidates and the code is what lets the user answer.
      state = state.copyWith(
        busy: false,
        error: failure,
        candidates: _candidatesIn(failure),
        pendingCode: trimmed,
      );
    }
  }

  /// The bookmakers a refusal named as possible sources, if it named any.
  List<Bookmaker> _candidatesIn(ApiFailure failure) {
    if (failure is! ServerFailure || failure.code != 'AMBIGUOUS_BOOKMAKER') return const [];
    final raw = failure.details?['candidates'];
    if (raw is! List) return const [];
    return [
      for (final c in raw)
        if (c is Map<String, dynamic>)
          Bookmaker(
            slug: c['slug'] as String? ?? '',
            name: c['name'] as String? ?? '',
            canLoad: true,
            canBook: false,
          ),
    ];
  }

  /// Answers "which bookmaker is this code from" and retries the add.
  Future<void> addFrom(String slug) async {
    final code = state.pendingCode;
    if (code == null) return;
    state = state.copyWith(clearError: true);
    await addCode(code, bookmaker: slug);
  }

  /// Ticks or unticks one leg.
  void toggle(String slipId, int position) {
    final pick = MergePick(slipId: slipId, position: position);
    final next = {...state.picked};
    if (!next.remove(pick)) next.add(pick);
    // Any previous result describes a different set of legs, so it stops being true here.
    state = state.copyWith(picked: next, clearResult: true, clearError: true);
  }

  /// Removes a whole source slip and every leg it contributed.
  void removeSlip(String slipId) {
    state = state.copyWith(
      sources: state.sources.where((s) => s.id != slipId).toList(growable: false),
      picked: state.picked.where((p) => p.slipId != slipId).toSet(),
      clearResult: true,
      clearError: true,
    );
  }

  /// Merges the chosen legs onto a destination, stopping at a draft.
  Future<void> merge(String target) async {
    if (!state.canMerge) return;
    state = state.copyWith(busy: true, clearError: true, clearResult: true);
    try {
      final merged = await ref
          .read(slipsRepositoryProvider)
          .merge(picks: state.picked.toList(growable: false), target: target, book: false);
      state = state.copyWith(busy: false, result: merged.slip, duplicates: merged.duplicates);
    } on ApiFailure catch (failure) {
      // The draft is gone but the user's chosen legs are not. Nothing they did is lost.
      state = state.copyWith(busy: false, error: failure);
    }
  }

  /// Asks the destination for a code for the merged draft.
  ///
  /// Separate from [merge] on purpose: the expensive half has already happened and a code is the
  /// one step the bookmaker can refuse. A refusal leaves the draft intact rather than throwing
  /// away the matching and pricing that succeeded.
  Future<void> book() async {
    final draft = state.result;
    if (draft == null || state.busy) return;
    state = state.copyWith(busy: true, clearError: true);
    try {
      final booked = await ref.read(slipsRepositoryProvider).book(slipId: draft.id);
      state = state.copyWith(busy: false, result: booked);
    } on ApiFailure catch (failure) {
      state = state.copyWith(busy: false, error: failure);
    }
  }

  void reset() => state = const MergeState();
}

final mergeProvider = NotifierProvider<MergeController, MergeState>(MergeController.new);
