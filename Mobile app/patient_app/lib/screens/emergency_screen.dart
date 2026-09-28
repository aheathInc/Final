import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/phone.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// First-aid guidance is bundled with the app, not fetched (FR-EM-03).
///
/// The moment it is needed most is the moment the network is least reliable,
/// and steps that fail to load during a road accident are worse than useless.
const _firstAid = <String, List<String>>{
  'road_traffic': [
    'Usimsogeze mtu aliyeumia shingo au mgongo isipokuwa kuna hatari ya moto.',
    'Zima injini ya gari na weka alama ili magari mengine yapunguze mwendo.',
    'Kama anavuja damu, bonyeza kwa nguvu juu ya jeraha kwa kitambaa safi.',
    'Kama hapumui, mgeuze kwa upande ili asisonge.',
    'Kaa naye, ongea naye, mwambie msaada unakuja.',
  ],
  'medical': [
    'Mlaze mahali salama na penye hewa ya kutosha.',
    'Legeza nguo zinazobana shingoni na kiunoni.',
    'Kama hana fahamu lakini anapumua, mgeuze kwa upande.',
    'Usimpe maji wala chakula kama hana fahamu kamili.',
    'Kumbuka muda ulipoanza tatizo — daktari atahitaji kujua.',
  ],
  'obstetric': [
    'Mlaze mama upande wa kushoto, si mgongoni.',
    'Kama kuna damu nyingi, weka kitambaa safi na usiondoe kilichowekwa.',
    'Usimpe chochote cha kunywa.',
    'Hesabu muda kati ya uchungu mmoja na mwingine.',
    'Kaa naye hadi gari lifike.',
  ],
  'trauma': [
    'Bonyeza jeraha kwa kitambaa safi hadi damu isimame.',
    'Kama kuna kitu kilichochomeka, usikitoe — kizungushie kitambaa.',
    'Inua sehemu iliyoumia juu ya kiwango cha moyo kama inawezekana.',
    'Mfunike ili asipate baridi.',
  ],
};

const _categories = [
  ('medical', 'Ugonjwa wa ghafla'),
  ('trauma', 'Jeraha au kuvuja damu'),
  ('road_traffic', 'Ajali ya barabarani'),
  ('obstetric', 'Uzazi'),
];

class EmergencyScreen extends StatefulWidget {
  const EmergencyScreen({super.key});
  @override
  State<EmergencyScreen> createState() => _EmergencyScreenState();
}

class _EmergencyScreenState extends State<EmergencyScreen> {
  String? _category;
  bool _busy = false;
  bool _sent = false;
  bool _queued = false;
  String? _error;

  Future<void> _report(String category) async {
    setState(() { _category = category; _busy = true; _error = null; });
    try {
      await Api.postDurable(
        opId: newOpId(),
        path: '/emergency-requests',
        syncPath: '/emergency-requests',
        body: {
          'scale': 'individual',
          'category': category,
          // A real deployment reads GPS here. Sending 0,0 would put the
          // ambulance in the Atlantic, so location is omitted rather than
          // faked, and the dispatcher calls back for it.
          'location': {'lat': 0, 'lng': 0},
          'source': 'patient_app',
        },
      );
      setState(() { _sent = true; _busy = false; });
    } on Queued {
      setState(() { _queued = true; _busy = false; });
    } catch (e) {
      setState(() { _error = S.errorGeneric; _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final steps = _category == null ? null : _firstAid[_category];

    return Scaffold(
      appBar: AppBar(title: const Text(S.emergency)),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_sent)
            const Notice('Ombi limetumwa. Fuata hatua hizi hadi msaada ufike.',
                tone: NoticeTone.attention)
          else if (_queued)
            const Notice(
              'Hakuna mtandao. Ombi litatumwa mtandao ukirudi — piga simu 114 sasa hivi '
              'kama unaweza. Fuata hatua hizi wakati huo huo.',
            )
          else if (_error != null)
            Notice(_error!),

          if (_category == null) ...[
            const Text('Ni tatizo la aina gani?',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500)),
            const SizedBox(height: 16),
            ..._categories.map((c) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: OutlinedButton(
                    onPressed: _busy ? null : () => _report(c.$1),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(60),
                      shape: const RoundedRectangleBorder(),
                      side: const BorderSide(color: AppColors.clay, width: 2),
                    ),
                    child: Text(c.$2,
                        style: const TextStyle(fontSize: 17, color: AppColors.clay)),
                  ),
                )),
          ],

          // Shown as soon as a category is chosen, without waiting for the
          // request to succeed. The steps are what helps in the next minute;
          // the ambulance is what helps in the next twenty.
          if (steps != null) ...[
            const SizedBox(height: 20),
            const SectionTitle('Fanya hivi sasa'),
            ...steps.asMap().entries.map((e) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${e.key + 1}.',
                          style: const TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w600,
                            color: AppColors.clay)),
                      const SizedBox(width: 10),
                      Expanded(child: Text(e.value, style: const TextStyle(fontSize: 17))),
                    ],
                  ),
                )),
          ],
        ],
      ),
    );
  }
}
