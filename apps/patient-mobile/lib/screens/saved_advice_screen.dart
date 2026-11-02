import '../core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/profile_card.dart';

class SavedAdviceScreen extends StatelessWidget {
  const SavedAdviceScreen(
      {super.key,
      required this.notes,
      required this.identity,
      this.syncedAt,
      this.available = true});
  final List<Map<String, Object?>> notes;
  final int identity;
  final DateTime? syncedAt;
  final bool available;
  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(L.tr('Ushauri uliohifadhiwa'))),
      body: ValueListenableBuilder<int>(
          valueListenable: Session.identityChanges,
          builder: (context, current, _) {
            if (current != identity) {
              return Center(
                  child: Text(
                      L.tr('Account imebadilika. Fungua tena ushauri wako.')));
            }
            return ListView(padding: const EdgeInsets.all(20), children: [
              Notice(
                  syncedAt == null
                      ? L.tr(
                          'Hii ni nakala iliyohifadhiwa kwenye simu; si taarifa mpya za moja kwa moja.')
                      : L.tr(
                          "Nakala ya mwisho: {0}. Inaweza kusomwa bila intaneti.",
                          [
                              DateFormat('d MMM y, HH:mm')
                                  .format(syncedAt!.toLocal())
                            ]),
                  tone: NoticeTone.attention),
              const SizedBox(height: 20),
              if (!available)
                Empty(L.tr(
                    'Nakala za ushauri hazikupatikana kwenye kifaa. Jaribu tena baadaye.'))
              else if (notes.isEmpty)
                Empty(L.tr(
                    'Hakuna ushauri wa daktari uliohifadhiwa kwenye simu hii.'))
              else
                ...notes.map((note) => Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _AdviceCard(note: note))),
            ]);
          }),
    );
  }
}

class _AdviceCard extends StatelessWidget {
  const _AdviceCard({required this.note});
  final Map<String, Object?> note;
  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final p = AppPalette.of(context);
    final date = DateTime.tryParse(note['created_at'] as String? ?? '');
    final flags = (note['red_flags'] as String? ?? '')
        .split('\n')
        .where((line) => line.trim().isNotEmpty);
    return ProfileCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (date != null)
        Text(DateFormat('d MMM y').format(date),
            style: TextStyle(color: p.inkSoft, fontSize: 14)),
      if (note['diagnosis_text'] != null) ...[
        const SizedBox(height: 8),
        Text(note['diagnosis_text'] as String,
            style: Theme.of(context).textTheme.titleMedium)
      ],
      if (note['advice_text'] != null) ...[
        const SizedBox(height: 8),
        Text(note['advice_text'] as String)
      ],
      if (flags.isNotEmpty) ...[
        const SizedBox(height: 16),
        Text(L.tr('Rudi haraka ukiona:'),
            style: TextStyle(color: p.clay, fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        ...flags.map((flag) => Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('• $flag', style: TextStyle(color: p.clay)))),
      ],
    ]));
  }
}
