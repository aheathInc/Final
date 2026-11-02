import '../core/l10n.dart';
import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Keep the call entry visible while matching, without bypassing acceptance.
class ConsultationCallAction extends StatelessWidget {
  const ConsultationCallAction(
      {super.key, required this.consultation, required this.onJoin});

  final Map<String, dynamic> consultation;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final modality = consultation['modality'];
    final status = consultation['status'];
    if (consultation['consultation_mode'] != 'remote' ||
        !['video', 'voice'].contains(modality) ||
        !['pending', 'offered', 'escalated', 'matched', 'in_progress']
            .contains(status)) {
      return const SizedBox.shrink();
    }
    final ready = ['matched', 'in_progress'].contains(status);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        FilledButton.icon(
          onPressed: ready ? onJoin : null,
          icon: Icon(modality == 'video'
              ? Icons.videocam_outlined
              : Icons.call_outlined),
          label: Text(modality == 'video'
              ? L.tr('Jiunge na video call')
              : L.tr('Jiunge na audio call')),
        ),
        if (!ready) ...[
          const SizedBox(height: 8),
          Text(
              L.tr(
                  'Inasubiri daktari kukubali ombi. Kitufe kitawashwa ombi likikubaliwa.'),
              style: TextStyle(color: AppPalette.of(context).inkSoft)),
        ],
        if (ready) ...[
          const SizedBox(height: 8),
          Text(L.tr('Ingia kwenye chumba cha call. Daktari ndiye atakupigia.'),
              style: TextStyle(color: AppPalette.of(context).inkSoft)),
        ],
      ]),
    );
  }
}
