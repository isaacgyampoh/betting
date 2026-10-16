import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers.dart';
import '../../domain/models.dart';
import '../../theme/tokens.dart';
import '../../ui/components/gc_button.dart';
import '../../ui/components/gc_chip.dart';
import '../../ui/components/gc_crest.dart';
import '../../ui/components/gc_input.dart';
import '../../ui/components/gc_sheet.dart';
import '../../ui/components/gc_skeleton.dart';
import '../../ui/components/gc_states.dart';

/// Browse every competition the provider carries.
///
/// The catalogue is about 1,250 competitions across 171 countries, so the filtering happens on
/// the server where the whole list is. No country is promoted over another: a global product with
/// a hard-coded home country is a local one wearing a global coat.
class CompetitionsScreen extends ConsumerStatefulWidget {
  const CompetitionsScreen({super.key});

  @override
  ConsumerState<CompetitionsScreen> createState() => _CompetitionsScreenState();
}

class _CompetitionsScreenState extends ConsumerState<CompetitionsScreen> {
  final _search = TextEditingController();
  String? _country;
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _pickCountry(List<CompetitionCountry> countries) async {
    final chosen = await showGcSheet<String>(
      context: context,
      title: 'Country',
      subtitle: '${countries.length} with competitions',
      child: ListView.builder(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: GcSpace.sm),
        itemCount: countries.length + 1,
        itemBuilder: (context, i) {
          if (i == 0) {
            return InkWell(
              onTap: () => Navigator.of(context).pop(''),
              child: const Padding(
                padding: EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.md),
                child: Text('All countries', style: GcType.bodyStrong),
              ),
            );
          }
          final country = countries[i - 1];
          return InkWell(
            onTap: () => Navigator.of(context).pop(country.name),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: GcSpace.gutter, vertical: GcSpace.md),
              child: Row(
                children: [
                  GcCrest(url: country.flagUrl, name: country.name, size: 18),
                  const SizedBox(width: GcSpace.md),
                  Expanded(child: Text(country.name, style: GcType.body.copyWith(fontSize: 14.5))),
                  Text(
                    '${country.competitions}',
                    style: GcType.figureSm.copyWith(color: GcColors.inkFaint),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
    if (chosen != null && mounted) {
      setState(() => _country = chosen.isEmpty ? null : chosen);
    }
  }

  @override
  Widget build(BuildContext context) {
    final request = ref.watch(
      competitionsProvider((country: _country, search: _query.isEmpty ? null : _query)),
    );

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Row(
              children: [
                GcIconButton(
                  icon: Icons.arrow_back_rounded,
                  colour: GcColors.ink,
                  tooltip: 'Back',
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
                Expanded(child: Text('Competitions', style: GcType.title)),
                const SizedBox(width: GcSpace.gutter),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                GcSpace.gutter,
                GcSpace.sm,
                GcSpace.gutter,
                GcSpace.md,
              ),
              child: Column(
                children: [
                  GcTextField(
                    controller: _search,
                    label: 'Search competitions',
                    icon: Icons.search_rounded,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (v) => setState(() => _query = v.trim()),
                  ),
                  const SizedBox(height: GcSpace.sm),
                  Row(
                    children: [
                      GcFilterChip(
                        label: _country ?? 'All countries',
                        icon: Icons.public_rounded,
                        selected: _country != null,
                        onTap: () => request.whenData((c) => _pickCountry(c.value.countries)),
                      ),
                      if (_query.isNotEmpty) ...[
                        const SizedBox(width: GcSpace.sm),
                        GcFilterChip(
                          label: 'Clear search',
                          selected: false,
                          onTap: () {
                            _search.clear();
                            setState(() => _query = '');
                          },
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            Expanded(
              child: request.when(
                skipLoadingOnRefresh: true,
                loading: () => const GcFixtureSkeleton(rows: 7),
                error: (error, _) =>
                    GcError(error: error, onRetry: () => ref.invalidate(competitionsProvider)),
                data: (cached) {
                  final list = cached.value.competitions;
                  if (list.isEmpty) {
                    return const GcEmpty(
                      icon: Icons.search_off_rounded,
                      title: 'No competitions match',
                      note: 'Try a different search, or clear the country filter.',
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.only(bottom: GcSpace.xxxl),
                    itemCount: list.length + 1,
                    separatorBuilder: (_, __) =>
                        const Divider(height: 1, indent: GcSpace.gutter, endIndent: GcSpace.gutter),
                    itemBuilder: (context, i) {
                      if (i == list.length) {
                        return Padding(
                          padding: const EdgeInsets.all(GcSpace.gutter),
                          child: Text(
                            // The honest count: how many matched, not how many are on screen.
                            cached.value.total > list.length
                                ? 'Showing ${list.length} of ${cached.value.total} matching. '
                                      'Search to narrow it.'
                                : '${list.length} competitions.',
                            style: GcType.caption.copyWith(color: GcColors.inkFaint),
                            textAlign: TextAlign.center,
                          ),
                        );
                      }
                      final c = list[i];
                      return InkWell(
                        onTap: () => context.push('/home/competition/${c.id}'),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: GcSpace.gutter,
                            vertical: GcSpace.md,
                          ),
                          child: Row(
                            children: [
                              GcCrest(url: c.logoUrl, name: c.name, size: GcSize.crestMd),
                              const SizedBox(width: GcSpace.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      c.name,
                                      style: GcType.bodyStrong.copyWith(fontSize: 14.5),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    Text(
                                      '${c.country} · ${c.type}',
                                      style: GcType.caption.copyWith(fontSize: 11.5),
                                    ),
                                  ],
                                ),
                              ),
                              const Icon(
                                Icons.chevron_right_rounded,
                                size: 18,
                                color: GcColors.inkFaint,
                              ),
                            ],
                          ),
                        ),
                      );
                    },
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
