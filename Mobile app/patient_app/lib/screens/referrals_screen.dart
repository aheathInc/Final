import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class ReferralsScreen extends StatefulWidget {
  const ReferralsScreen({super.key, this.loadReferrals});

  @visibleForTesting
  final Future<List<Map<String, dynamic>>> Function()? loadReferrals;

  @visibleForTesting
  static List<Map<String, dynamic>> parseResponse(dynamic result) {
    final rows = result is Map ? result['data'] : null;
    if (rows is! List) {
      throw ApiException(
        502,
        'INVALID_RESPONSE',
        'Rufaa hazikuweza kusomwa. Jaribu tena.',
      );
    }
    return rows
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
  }

  @override
  State<ReferralsScreen> createState() => _ReferralsScreenState();
}

class _ReferralsScreenState extends State<ReferralsScreen> {
  List<Map<String, dynamic>> _referrals = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<List<Map<String, dynamic>>> _fetch() async {
    final loader = widget.loadReferrals;
    if (loader != null) return loader();
    return ReferralsScreen.parseResponse(await Api.get('/referrals'));
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _referrals = [];
    });
    try {
      final rows = await _fetch();
      if (!mounted) return;
      setState(() {
        _referrals = rows;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error is ApiException
            ? error.message
            : 'Rufaa hazikuweza kusomwa. Jaribu tena.';
        _loading = false;
      });
    }
  }

  String _status(String value) => switch (value) {
        'submitted' => 'Imetumwa — kituo bado hakijathibitisha kupokea',
        'received' => 'Imepokelewa — uamuzi wa clinician unasubiri',
        'accepted' => 'Imekubaliwa — huduma bado haijaanza',
        'in_care' => 'Huduma imeanza',
        'completed' => 'Rufaa imekamilika',
        'declined' => 'Rufaa imekataliwa',
        'cancelled' => 'Rufaa imeghairiwa',
        'expired' => 'Rufaa imeisha muda',
        _ => 'Rufaa inaandaliwa',
      };

  String _outcome(String value) => switch (value) {
        'care_provided' => 'Huduma imetolewa',
        'redirected' => 'Ameelekezwa kwenye huduma nyingine',
        'unable_to_complete' => 'Huduma haikuweza kukamilika',
        _ => 'Matokeo yamehifadhiwa',
      };

  String _date(dynamic value) {
    if (value is! String) return '—';
    final parsed = DateTime.tryParse(value)?.toLocal();
    if (parsed == null) return '—';
    return '${parsed.day.toString().padLeft(2, '0')}/${parsed.month.toString().padLeft(2, '0')}/${parsed.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rufaa Zangu')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Notice(
                'Kutumwa kwa rufaa hakumaanishi imekubaliwa. Hali ya kituo na hatua ya huduma huonyeshwa tofauti.'),
            const SizedBox(height: 12),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null) ...[
              Notice(_error!),
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Jaribu tena'),
                ),
              ),
            ] else if (_referrals.isEmpty)
              const Empty(
                  'Bado hakuna rufaa. Rufaa itakayoanzishwa na clinician wako itaonekana hapa.')
            else
              ..._referrals.map(_referralCard),
          ],
        ),
      ),
    );
  }

  Widget _referralCard(Map<String, dynamic> referral) {
    final destination = referral['destination'] is Map
        ? Map<String, dynamic>.from(referral['destination'] as Map)
        : <String, dynamic>{};
    final source = referral['source'] is Map
        ? Map<String, dynamic>.from(referral['source'] as Map)
        : <String, dynamic>{};
    final destinationFacility = destination['facility'] is Map
        ? Map<String, dynamic>.from(destination['facility'] as Map)
        : <String, dynamic>{};
    final sourceFacility = source['facility'] is Map
        ? Map<String, dynamic>.from(source['facility'] as Map)
        : <String, dynamic>{};
    final status = referral['status'] as String? ?? 'draft';
    final outcome = referral['outcome'] is Map
        ? Map<String, dynamic>.from(referral['outcome'] as Map)
        : null;
    final tone = status == 'completed' ||
            status == 'in_care' ||
            status == 'accepted'
        ? AppColors.petrol
        : status == 'declined' || status == 'cancelled' || status == 'expired'
            ? AppColors.clay
            : AppColors.inkSoft;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        leading: Icon(Icons.alt_route, color: tone),
        title:
            Text(destinationFacility['name'] as String? ?? 'Kituo cha rufaa'),
        subtitle: Text(_status(status), style: TextStyle(color: tone)),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          _detail(
              'Kituo kilichotuma', sourceFacility['name'] as String? ?? '—'),
          _detail('Kituo kinachopokea',
              destinationFacility['name'] as String? ?? '—'),
          _detail('Sababu ya rufaa', referral['purpose'] as String? ?? '—'),
          _detail('Tarehe ya kutuma', _date(referral['submitted_at'])),
          _detail('Tarehe ya kupokea', _date(referral['received_at'])),
          _detail('Tarehe ya kukubali', _date(referral['accepted_at'])),
          _detail('Huduma ilianza', _date(referral['care_started_at'])),
          _detail('Tarehe ya kukamilika', _date(referral['completed_at'])),
          if (referral['decline_reason'] is String)
            _detail(
                'Maelezo ya kukataliwa', referral['decline_reason'] as String),
          if (outcome != null) ...[
            const Divider(),
            _detail('Matokeo', _outcome(outcome['status'] as String? ?? '')),
            if (outcome['follow_up_recommendation'] is String)
              _detail(
                  'Ufuatiliaji', outcome['follow_up_recommendation'] as String),
            if (outcome['patient_instructions'] is String)
              _detail('Maelekezo', outcome['patient_instructions'] as String),
          ],
        ],
      ),
    );
  }

  Widget _detail(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
                width: 140,
                child: Text(label,
                    style: const TextStyle(color: AppColors.inkSoft))),
            Expanded(child: Text(value)),
          ],
        ),
      );
}
