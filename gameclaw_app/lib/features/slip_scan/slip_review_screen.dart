import 'dart:io';

import 'package:flutter/material.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_states.dart';
import '../../domain/models.dart';
import 'fixture_matcher.dart';
import 'slip_parser.dart';

/// What was read, before anything is done with it.
///
/// The screen exists because the parser is reading a photograph and will sometimes be wrong. It
/// shows what it found, what it could not read, and which fixtures it is unsure about - and it
/// will not let a slip be used until the uncertain parts have been looked at.
///
/// The thing it must never do is present a guess as a fact. An unread price shows as "not
/// readable" and the user types it; it does not show as 0.00, and it does not quietly become the
/// most common price on a slip.
class SlipReviewScreen extends StatefulWidget {
  const SlipReviewScreen({
    super.key,
    required this.imagePath,
    required this.slip,
    required this.matches,
    required this.onConfirm,
    required this.onRetake,
    required this.onDiscard,
    this.candidates = const [],
    this.onConvertCode,
  });

  final String imagePath;
  final ParsedSlip slip;
  final List<FixtureMatch> matches;

  /// Every fixture the app could offer, so a selection that matched nothing can still be
  /// attached to the right game by hand instead of being a dead end.
  final List<Fixture> candidates;

  /// Offered only when the slip printed a booking code. Null otherwise, and the button is not
  /// shown at all rather than shown and refusing.
  final void Function(String code, String? bookmaker)? onConvertCode;

  /// Called with whatever the user settled on.
  final ValueChanged<List<FixtureMatch>> onConfirm;
  final VoidCallback onRetake;
  final VoidCallback onDiscard;

  @override
  State<SlipReviewScreen> createState() => _SlipReviewScreenState();
}

class _SlipReviewScreenState extends State<SlipReviewScreen> {
  late final List<FixtureMatch> _matches = List.of(widget.matches);
  bool _imageExpanded = false;

  void _replace(int index, FixtureMatch next) => setState(() => _matches[index] = next);

  void _remove(int index) => setState(() => _matches.removeAt(index));

  /// Anything still unresolved. The confirm button says how many, rather than being disabled
  /// with no explanation.
  int get _unresolved => _matches.where((m) => m.needsReview).length;

  @override
  Widget build(BuildContext context) {
    final code = widget.slip.bookingCode;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Check the slip'),
        actions: [
          IconButton(
            onPressed: widget.onDiscard,
            icon: const Icon(Icons.close_rounded),
            tooltip: 'Discard',
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
        children: [
          _ImageStrip(
            path: widget.imagePath,
            expanded: _imageExpanded,
            onToggle: () => setState(() => _imageExpanded = !_imageExpanded),
            onRetake: widget.onRetake,
          ),

          // A booking code outranks everything the parser worked out, so it is offered first and
          // described plainly: loading the real slip through the bookmaker's own interface is
          // exact, where anything read off an image is a reading.
          if (code != null) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.md, GcSpace.gutter, 0),
              child: GcNote(
                'This slip shows booking code $code. Loading it from '
                '${widget.slip.bookmaker ?? 'the bookmaker'} is exact, where reading the image '
                'is not.',
                icon: Icons.confirmation_number_outlined,
              ),
            ),
            if (widget.onConvertCode != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  GcSpace.gutter,
                  GcSpace.sm,
                  GcSpace.gutter,
                  0,
                ),
                child: GcButton(
                  label: 'Load $code and convert',
                  onPressed: () => widget.onConvertCode!(code, widget.slip.bookmaker),
                ),
              ),
          ],

          if (_matches.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: GcSpace.xxl),
              child: GcEmpty(
                icon: Icons.document_scanner_outlined,
                title: 'No selections found',
                note:
                    'Nothing on the image looked like a fixture. A straighter photo with the '
                    'whole slip in frame usually reads better.',
              ),
            )
          else ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(
                GcSpace.gutter,
                GcSpace.lg,
                GcSpace.gutter,
                GcSpace.sm,
              ),
              child: Text(
                '${_matches.length} ${_matches.length == 1 ? 'selection' : 'selections'}'
                '${_unresolved > 0 ? ' · $_unresolved need checking' : ''}',
                style: GcType.label.copyWith(color: gc(context).inkMuted),
              ),
            ),
            for (var i = 0; i < _matches.length; i++)
              _SelectionCard(
                match: _matches[i],
                candidates: widget.candidates,
                onChanged: (next) => _replace(i, next),
                onRemove: () => _remove(i),
              ),
          ],

          Padding(
            padding: const EdgeInsets.all(GcSpace.gutter),
            child: Column(
              children: [
                GcButton(
                  label: _matches.isEmpty
                      ? 'Try another photo'
                      : _unresolved > 0
                      ? 'Use anyway ($_unresolved unchecked)'
                      : 'Use these ${_matches.length}',
                  size: GcButtonSize.large,
                  onPressed: _matches.isEmpty ? widget.onRetake : () => widget.onConfirm(_matches),
                ),
                const SizedBox(height: GcSpace.sm),
                GcButton(
                  label: 'Take another photo',
                  kind: GcButtonKind.ghost,
                  onPressed: widget.onRetake,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The photograph, collapsed by default.
///
/// Shown small because the point of the screen is the parsed result, and tappable because the
/// one time it matters is when a field looks wrong and the user wants to check what was actually
/// on the slip.
class _ImageStrip extends StatelessWidget {
  const _ImageStrip({
    required this.path,
    required this.expanded,
    required this.onToggle,
    required this.onRetake,
  });

  final String path;
  final bool expanded;
  final VoidCallback onToggle;
  final VoidCallback onRetake;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(GcSpace.gutter, GcSpace.md, GcSpace.gutter, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: onToggle,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(GcRadius.md),
              child: Image.file(
                File(path),
                height: expanded ? 420 : 120,
                width: double.infinity,
                fit: expanded ? BoxFit.contain : BoxFit.cover,
                alignment: Alignment.topCenter,
                // A file that cannot be decoded must not take the screen down with it; the
                // parsed result is still worth showing.
                errorBuilder: (context, _, _) => Container(
                  height: 120,
                  color: gc(context).surfaceRaised,
                  alignment: Alignment.center,
                  child: Text(
                    'Preview unavailable',
                    style: GcType.caption.copyWith(color: gc(context).inkFaint),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: GcSpace.xs),
          Row(
            children: [
              TextButton(onPressed: onToggle, child: Text(expanded ? 'Hide photo' : 'Show photo')),
              const Spacer(),
              TextButton(onPressed: onRetake, child: const Text('Replace')),
            ],
          ),
        ],
      ),
    );
  }
}

/// One parsed selection, editable.
class _SelectionCard extends StatelessWidget {
  const _SelectionCard({
    required this.match,
    required this.candidates,
    required this.onChanged,
    required this.onRemove,
  });

  final FixtureMatch match;

  /// Every fixture that could be offered, so a selection the matcher could not settle is not a
  /// dead end.
  final List<Fixture> candidates;
  final ValueChanged<FixtureMatch> onChanged;
  final VoidCallback onRemove;

  /// Lets the user attach this selection to a fixture by hand.
  ///
  /// The way out of every case the matcher cannot settle: a name OCR mangled beyond recognition,
  /// a competition the app has not loaded, two clubs that genuinely read alike. Searching is
  /// better than guessing and far better than silently dropping the leg.
  Future<void> _chooseFixture(BuildContext context) async {
    final chosen = await showModalBottomSheet<Fixture>(
      context: context,
      isScrollControlled: true,
      backgroundColor: gc(context).surface,
      showDragHandle: true,
      builder: (sheetContext) => _FixturePicker(
        candidates: candidates,
        initialQuery: [match.parsed.home, match.parsed.away].whereType<String>().join(' ').trim(),
      ),
    );
    if (chosen != null) {
      onChanged(
        FixtureMatch(
          parsed: match.parsed,
          fixture: chosen,
          // Picked by a person, so it is settled however the strings compare.
          score: 1,
          ambiguous: false,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final parsed = match.parsed;
    final fixture = match.fixture;

    return Container(
      margin: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.sm),
      padding: const EdgeInsets.all(GcSpace.md),
      decoration: BoxDecoration(
        color: gc(context).surface,
        borderRadius: BorderRadius.circular(GcRadius.md),
        border: Border.all(
          color: match.needsReview ? gc(context).warn.withValues(alpha: 0.5) : gc(context).border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  fixture != null
                      ? '${fixture.home.name} v ${fixture.away.name}'
                      : '${parsed.home ?? '?'} v ${parsed.away ?? '?'}',
                  style: GcType.bodyStrong,
                ),
              ),
              _ConfidenceChip(confidence: match.confidence),
              IconButton(
                onPressed: onRemove,
                icon: const Icon(Icons.close_rounded, size: 18),
                tooltip: 'Remove this selection',
              ),
            ],
          ),

          // What the image said, separated from what it was matched to. The two are different
          // kinds of information and conflating them is how a wrong match goes unnoticed.
          if (fixture != null && match.needsReview)
            Padding(
              padding: const EdgeInsets.only(top: GcSpace.xs),
              child: Text(
                'Read as "${parsed.home} v ${parsed.away}"',
                style: GcType.caption.copyWith(color: gc(context).inkFaint),
              ),
            ),

          if (fixture == null) ...[
            Padding(
              padding: const EdgeInsets.only(top: GcSpace.xs),
              child: Text(
                'No fixture matched this. It will be left out unless you pick one.',
                style: GcType.caption.copyWith(color: gc(context).warn),
              ),
            ),
            const SizedBox(height: GcSpace.xs),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => _chooseFixture(context),
                icon: const Icon(Icons.search_rounded, size: 16),
                label: const Text('Find the match'),
              ),
            ),
          ],

          if (match.ambiguous && match.alternatives.isNotEmpty) ...[
            const SizedBox(height: GcSpace.sm),
            Text('Could also be', style: GcType.caption.copyWith(color: gc(context).inkFaint)),
            const SizedBox(height: GcSpace.xs),
            Wrap(
              spacing: GcSpace.xs,
              runSpacing: GcSpace.xs,
              children: [
                for (final other in match.alternatives)
                  ActionChip(
                    label: Text('${other.home.name} v ${other.away.name}', style: GcType.caption),
                    onPressed: () => onChanged(
                      FixtureMatch(
                        parsed: parsed,
                        fixture: other,
                        score: match.score,
                        // Chosen by a person, so it is no longer a coin toss.
                        ambiguous: false,
                      ),
                    ),
                  ),
              ],
            ),
          ],

          const SizedBox(height: GcSpace.sm),
          Row(
            children: [
              _Field(
                label: 'Market',
                value: parsed.market,
                onEdit: (v) => onChanged(
                  FixtureMatch(
                    parsed: parsed.copyWith(market: v),
                    fixture: fixture,
                    score: match.score,
                    alternatives: match.alternatives,
                    ambiguous: match.ambiguous,
                  ),
                ),
              ),
              const SizedBox(width: GcSpace.md),
              _Field(
                label: 'Pick',
                value: parsed.pick,
                onEdit: (v) => onChanged(
                  FixtureMatch(
                    parsed: parsed.copyWith(pick: v),
                    fixture: fixture,
                    score: match.score,
                    alternatives: match.alternatives,
                    ambiguous: match.ambiguous,
                  ),
                ),
              ),
              const SizedBox(width: GcSpace.md),
              _Field(
                label: 'Odds',
                value: parsed.odds?.toStringAsFixed(2),
                numeric: true,
                onEdit: (v) {
                  final parsedOdds = double.tryParse(v.replaceAll(',', '.'));
                  onChanged(
                    FixtureMatch(
                      parsed: parsed.copyWith(odds: parsedOdds),
                      fixture: fixture,
                      score: match.score,
                      alternatives: match.alternatives,
                      ambiguous: match.ambiguous,
                    ),
                  );
                },
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One editable field, which says plainly when it has no value.
class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.value,
    required this.onEdit,
    this.numeric = false,
  });

  final String label;
  final String? value;
  final ValueChanged<String> onEdit;
  final bool numeric;

  @override
  Widget build(BuildContext context) {
    final missing = value == null || value!.isEmpty;
    return Expanded(
      child: GestureDetector(
        onTap: () async {
          final controller = TextEditingController(text: value ?? '');
          final result = await showDialog<String>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: Text(label),
              content: TextField(
                controller: controller,
                autofocus: true,
                keyboardType: numeric
                    ? const TextInputType.numberWithOptions(decimal: true)
                    : TextInputType.text,
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('Cancel'),
                ),
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
                  child: const Text('Save'),
                ),
              ],
            ),
          );
          if (result != null) onEdit(result);
        },
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: GcType.caption.copyWith(color: gc(context).inkFaint)),
            const SizedBox(height: 2),
            Text(
              // Never a zero or a blank: the difference between "the provider said nothing" and
              // "the value is nothing" is the whole point of this screen.
              missing ? 'not readable' : value!,
              style: GcType.body.copyWith(
                color: missing ? gc(context).warn : gc(context).ink,
                fontStyle: missing ? FontStyle.italic : FontStyle.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConfidenceChip extends StatelessWidget {
  const _ConfidenceChip({required this.confidence});

  final Confidence confidence;

  @override
  Widget build(BuildContext context) {
    final (label, colour) = switch (confidence) {
      Confidence.high => ('sure', gc(context).accentInk),
      Confidence.medium => ('check', gc(context).warn),
      Confidence.low => ('unsure', gc(context).loss),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: GcSpace.sm, vertical: 2),
      decoration: BoxDecoration(
        color: colour.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(GcRadius.sm),
      ),
      child: Text(label, style: GcType.caption.copyWith(color: colour)),
    );
  }
}

/// Search the day's fixtures and pick one.
///
/// Seeded with whatever OCR read, because that is usually close enough to find the game even
/// when it was not close enough to match automatically.
class _FixturePicker extends StatefulWidget {
  const _FixturePicker({required this.candidates, required this.initialQuery});

  final List<Fixture> candidates;
  final String initialQuery;

  @override
  State<_FixturePicker> createState() => _FixturePickerState();
}

class _FixturePickerState extends State<_FixturePicker> {
  late final TextEditingController _query = TextEditingController(text: widget.initialQuery);

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  List<Fixture> get _results {
    final text = _query.text.trim();
    if (text.isEmpty) return widget.candidates.take(40).toList();
    // Ranked by the same similarity the matcher uses, so what the user sees at the top is what
    // the matcher thought was closest - just without the threshold that rejected it.
    final scored =
        widget.candidates
            .map(
              (f) => (
                f,
                [
                  similarity(text, '${f.home.name} ${f.away.name}'),
                  similarity(text, f.home.name),
                  similarity(text, f.away.name),
                ].reduce((a, b) => a > b ? a : b),
              ),
            )
            .where((r) => r.$2 > 0.2)
            .toList()
          ..sort((a, b) => b.$2.compareTo(a.$2));
    return scored.take(40).map((r) => r.$1).toList();
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.7,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(GcSpace.gutter, 0, GcSpace.gutter, GcSpace.sm),
              child: TextField(
                controller: _query,
                autofocus: true,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  hintText: 'Search teams',
                  prefixIcon: Icon(Icons.search_rounded),
                  isDense: true,
                ),
              ),
            ),
            Expanded(
              child: results.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(GcSpace.gutter),
                        child: Text(
                          widget.candidates.isEmpty
                              ? 'No fixtures loaded to choose from.'
                              : 'Nothing matched that. The game may be on a day the app has '
                                    'not loaded.',
                          textAlign: TextAlign.center,
                          style: GcType.caption.copyWith(color: gc(context).inkFaint),
                        ),
                      ),
                    )
                  : ListView.builder(
                      itemCount: results.length,
                      itemBuilder: (listContext, i) {
                        final f = results[i];
                        return ListTile(
                          dense: true,
                          title: Text('${f.home.name} v ${f.away.name}', style: GcType.body),
                          subtitle: Text(
                            f.competition.name,
                            style: GcType.caption.copyWith(color: gc(listContext).inkFaint),
                          ),
                          onTap: () => Navigator.pop(listContext, f),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
