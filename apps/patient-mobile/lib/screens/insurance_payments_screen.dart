import '../core/l10n.dart';
import 'package:flutter/material.dart';
import 'payment_bills_screen.dart';

import '../core/api.dart';
import '../core/consent_feedback_finance.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class InsurancePaymentsScreen extends StatefulWidget {
  const InsurancePaymentsScreen({super.key});

  @override
  State<InsurancePaymentsScreen> createState() =>
      _InsurancePaymentsScreenState();
}

class _InsurancePaymentsScreenState extends State<InsurancePaymentsScreen> {
  final _repository = ConsentFeedbackFinanceRepository();
  Map<String, dynamic>? _coverage;
  List<Map<String, dynamic>> _claims = [];
  List<Map<String, dynamic>> _payments = [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final results = await Future.wait<Object?>(
      [
        _repository.coverage(),
        _repository.claims(),
        _repository.payments(),
      ].map((future) async {
        try {
          return await future;
        } catch (error) {
          return error;
        }
      }),
    );
    if (!mounted) return;
    final coverage = results[0];
    final claims = results[1];
    final payments = results[2];
    final failures = [coverage, claims, payments]
        .whereType<Object>()
        .where((value) => value is ApiException || value is FormatException)
        .toList();
    setState(() {
      _coverage = coverage is Map<String, dynamic> ? coverage : null;
      _claims = claims is List<Map<String, dynamic>> ? claims : [];
      _payments = payments is List<Map<String, dynamic>> ? payments : [];
      _error = failures.isEmpty
          ? null
          : L.tr('Baadhi ya taarifa hazikuweza kusomwa.');
      _loading = false;
    });
  }

  String _date(Object? value) {
    final date = DateTime.tryParse(value as String? ?? '');
    if (date == null) return '—';
    final local = date.toLocal();
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(L.tr('Bima na malipo'))),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Notice(
              L.tr(
                  'Taarifa hizi zinasomwa kutoka rekodi za huduma. Hali ya payment record haithibitishi yenyewe kuwa pesa zimehamishwa au insurer amelipa.'),
              tone: NoticeTone.attention,
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Notice(_error!)
            ],
            const SizedBox(height: 20),
            FilledButton.icon(
                onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                        builder: (_) => const PaymentBillsScreen())),
                icon: const Icon(Icons.receipt_long_outlined),
                label: Text(L.tr('Fungua bili na lipia huduma'))),
            const SizedBox(height: 16),
            SectionTitle(L.tr('Bima yangu')),
            if (_loading && _coverage == null)
              const Center(child: CircularProgressIndicator())
            else if (_coverage == null)
              Empty(L.tr('Taarifa za bima hazipatikani sasa.'))
            else if ((_coverage!['schemes'] as List).isEmpty)
              Empty(L.tr('Hakuna bima iliyohusishwa na wasifu huu.'))
            else
              ...((_coverage!['schemes'] as List)
                  .cast<Map<String, dynamic>>()
                  .map(_coverageCard)),
            const SizedBox(height: 20),
            SectionTitle(L.tr('Madai ya bima')),
            if (_loading && _claims.isEmpty)
              const Center(child: CircularProgressIndicator())
            else if (_claims.isEmpty)
              Empty(L.tr('Hakuna dai lililorudishwa kwa wasifu huu.')),
            ..._claims.map(_claimCard),
            Text(
              L.tr(
                  'Kutuma dai kunafanywa na clinician aliyehudumia au Admin; huduma haijaidhinisha mgonjwa kuwasilisha dai.'),
            ),
            const SizedBox(height: 20),
            SectionTitle(L.tr('Rekodi za malipo')),
            if (_loading && _payments.isEmpty)
              const Center(child: CircularProgressIndicator())
            else if (_payments.isEmpty)
              Empty(L.tr('Hakuna rekodi ya malipo iliyopatikana.')),
            ..._payments.map(_paymentCard),
            const SizedBox(height: 8),
            Text(
              L.tr(
                  'Tumia Bili Zangu kuomba malipo ya bili iliyotolewa na mtoa huduma. Kiasi huamuliwa na staff mwenye ruhusa.'),
            ),
            Text(
              L.tr(
                  'Mtoa huduma wa maendeleo anaweza kuwa console/mock; status ya processing au succeeded si uthibitisho wa uhamisho wa fedha kwa nje.'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _coverageCard(Map<String, dynamic> scheme) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                scheme['scheme_name'] as String,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              Text(L.tr("Hali: {0}", [scheme['status']])),
              if (scheme['membership_number'] != null)
                Text(L.tr(
                    "Namba ya mwanachama: {0}", [scheme['membership_number']])),
              Text(
                L.tr("Huduma zilizo kwenye rekodi: {0}",
                    [((scheme['covered_services'] as List?) ?? []).join(', ')]),
              ),
              Text(L.tr("Inatumika hadi: {0}",
                  [scheme['valid_until'] ?? 'haijawekwa'])),
              Text(
                L.tr("Kituo kinachokubali: {0}", [
                  scheme['accepted_at_facility'] ?? 'haijathibitishwa na huduma'
                ]),
              ),
            ],
          ),
        ),
      );

  Widget _claimCard(Map<String, dynamic> claim) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(L.tr("Dai {0}", [claim['id']])),
              Text(L.tr("Hali: {0}", [claim['status']])),
              Text(L.tr("Ombi: {0}", [claim['consultation_id']])),
              Text(L.tr("Imetumwa: {0}", [_date(claim['submitted_at'])])),
              if (claim['decided_at'] != null)
                Text(L.tr("Uamuzi: {0}", [_date(claim['decided_at'])])),
              if (claim['rejection_reason'] != null)
                Text(L.tr(
                    "Sababu iliyorudishwa: {0}", [claim['rejection_reason']])),
            ],
          ),
        ),
      );

  Widget _paymentCard(Map<String, dynamic> payment) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Panel(
          accent: payment['status'] == 'succeeded'
              ? AppColors.petrol
              : AppColors.amber,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${payment['amount']} ${payment['currency']}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              Text(L.tr("Hali: {0}", [payment['status']])),
              Text(L.tr("Njia: {0} · Madhumuni: {1}",
                  [payment['method'], payment['purpose']])),
              if (payment['provider'] != null)
                Text(L.tr("Provider: {0}", [payment['provider']])),
              if (payment['provider_reference'] != null)
                Text(L.tr(
                    "Rejea ya provider: {0}", [payment['provider_reference']])),
              Text(L.tr("Imerekodiwa: {0}", [_date(payment['settled_at'])])),
            ],
          ),
        ),
      );
}
