import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/patient_experience.dart';
import '../core/phone.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

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
  final _latitude = TextEditingController();
  final _longitude = TextEditingController();
  final _lookupId = TextEditingController();
  String? _category;
  Map<String, dynamic>? _request;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _latitude.dispose();
    _longitude.dispose();
    _lookupId.dispose();
    super.dispose();
  }

  Future<void> _report() async {
    final lat = double.tryParse(_latitude.text.trim());
    final lng = double.tryParse(_longitude.text.trim());
    if (_category == null || !isValidEmergencyCoordinates(lat, lng)) {
      setState(
        () => _error =
            'Weka aina ya dharura na koordineti halali. 0,0 hairuhusiwi.',
      );
      return;
    }
    if (!await Api.online) {
      if (mounted) {
        setState(() {
          _error = 'ONLINE REQUEST UNAVAILABLE. Hakuna ombi lililotumwa.';
        });
      }
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await Api.post(
        '/emergency-requests',
        emergencyRequestBody(
          category: _category!,
          latitude: lat!,
          longitude: lng!,
        ),
        idempotencyKey: newOpId(),
      );
      if (!mounted) return;
      setState(() {
        _request = emergencyRequestFromJson(response);
        _lookupId.text = _request!['id'] as String;
        _busy = false;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.status == 0
              ? 'Ombi la AHP halijathibitishwa. Unganisha mtandao na angalia hali kabla ya kujaribu tena.'
              : e.message;
          _busy = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error =
              'Ombi la AHP halijathibitishwa. Hali yake haijulikani; usidhani msaada umetumwa.';
          _busy = false;
        });
      }
    }
  }

  Future<void> _refreshStatus({String? requestId}) async {
    final id = requestId ?? _request?['id'] as String?;
    if (id == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await Api.get('/emergency-requests/$id');
      if (mounted) {
        setState(() {
          _request = emergencyRequestFromJson(response);
          _lookupId.text = _request!['id'] as String;
          _busy = false;
        });
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _busy = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Hali haikuweza kusomwa.';
          _busy = false;
        });
      }
    }
  }

  Future<void> _lookupExistingStatus() async {
    final id = _lookupId.text.trim();
    if (id.isEmpty) {
      setState(() => _error = 'Weka namba ya ombi ulilohifadhi.');
      return;
    }
    await _refreshStatus(requestId: id);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Dharura / SOS')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const Notice(
              'AHP emergency request needs internet. Ukiwa offline: ONLINE REQUEST UNAVAILABLE; hakuna ombi linalotumwa au kuwekwa foleni. AHP haitumi gari la dharura. Kwa hatari ya sasa tumia namba rasmi za eneo lako.',
              tone: NoticeTone.attention,
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Notice(_error!)
            ],
            if (_request case final request?) ...[
              const SizedBox(height: 16),
              const SectionTitle('Ombi lililorekodiwa'),
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Namba ya ombi: ${request['id']}'),
                    Text('Hali: ${request['status']}'),
                  ],
                ),
              ),
              OutlinedButton.icon(
                onPressed: _busy ? null : _refreshStatus,
                icon: const Icon(Icons.refresh),
                label: const Text('Soma hali tena'),
              ),
            ] else ...[
              const SizedBox(height: 20),
              const SectionTitle('Tuma ombi la dharura'),
              const Text('Chagua aina ya tukio:'),
              const SizedBox(height: 8),
              RadioGroup<String>(
                groupValue: _category,
                onChanged: (value) {
                  if (!_busy && value != null) {
                    setState(() => _category = value);
                  }
                },
                child: Column(
                  children: [
                    for (final item in _categories)
                      RadioListTile<String>(
                        value: item.$1,
                        key: ValueKey('emergency-category-${item.$1}'),
                        title: Text(item.$2),
                        activeColor: AppColors.clay,
                        contentPadding: EdgeInsets.zero,
                        enabled: !_busy,
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Huduma iliyopo inahitaji koordineti. Ingiza latitudo na longitudo sahihi za tukio; programu haitumii GPS wala kubuni eneo.',
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _latitude,
                key: const Key('emergency-latitude'),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                  signed: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Latitudo',
                  hintText: '−90 hadi 90',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _longitude,
                key: const Key('emergency-longitude'),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                  signed: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Longitudo',
                  hintText: '−180 hadi 180',
                ),
              ),
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: _busy ? null : _report,
                icon: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.warning_amber_rounded),
                label: const Text('Tuma ombi'),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.clay,
                  minimumSize: const Size.fromHeight(52),
                ),
              ),
            ],
            const SizedBox(height: 24),
            const SectionTitle('Angalia ombi lililopo'),
            TextField(
              key: const Key('emergency-request-id'),
              controller: _lookupId,
              decoration: const InputDecoration(labelText: 'Namba ya ombi'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _busy ? null : _lookupExistingStatus,
              icon: const Icon(Icons.search),
              label: const Text('Angalia hali'),
            ),
          ],
        ),
      );
}
