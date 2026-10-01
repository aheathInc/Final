import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/patient_care.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class DiagnosticsScreen extends StatefulWidget {
  const DiagnosticsScreen({super.key});
  @override
  State<DiagnosticsScreen> createState() => _DiagnosticsScreenState();
}

class _DiagnosticsScreenState extends State<DiagnosticsScreen> {
  final _care = PatientCareRepository();
  List<Map<String, dynamic>> _orders = [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = await _care.investigationOrders();
      if (mounted)
        setState(() {
          _orders = rows;
          _loading = false;
          _error = null;
        });
    } catch (e) {
      if (mounted)
        setState(() {
          _loading = false;
          _error = e is ApiException
              ? e.message
              : 'Imeshindikana kupakia majibu.';
        });
    }
  }

  String _date(String? value) {
    final date = DateTime.tryParse(value ?? '');
    return date == null
        ? 'Tarehe haijulikani'
        : DateFormat('d MMM yyyy, HH:mm').format(date.toLocal());
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Vipimo na majibu')),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_error != null) Notice(_error!),
                if (_orders.isEmpty)
                  const Empty(
                    'Hakuna kipimo kilichoagizwa kwenye rekodi zako.',
                  ),
                ..._orders.map(
                  (o) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Panel(
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) =>
                              _DiagnosticDetail(orderId: o['id'] as String),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            o['investigation_code'] as String? ??
                                o['investigation_type'] as String? ??
                                'Kipimo',
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          Text(
                            '${o['status'] ?? 'haijulikani'} • ${_date(o['ordered_at'] as String?)}',
                            style: const TextStyle(color: AppColors.inkSoft),
                          ),
                          if (o['resulted_at'] != null)
                            Text('Jibu: ${_date(o['resulted_at'] as String?)}'),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
  );
}

class _DiagnosticDetail extends StatefulWidget {
  const _DiagnosticDetail({required this.orderId});
  final String orderId;
  @override
  State<_DiagnosticDetail> createState() => _DiagnosticDetailState();
}

class _DiagnosticDetailState extends State<_DiagnosticDetail> {
  Map<String, dynamic>? _order;
  String? _error;
  @override
  void initState() {
    super.initState();
    PatientCareRepository()
        .investigationOrder(widget.orderId)
        .then((v) {
          if (mounted) setState(() => _order = v);
        })
        .catchError((Object e) {
          if (mounted)
            setState(
              () => _error = e is ApiException
                  ? e.message
                  : 'Imeshindikana kupakia kipimo.',
            );
        });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Maelezo ya kipimo')),
    body: _order == null
        ? Center(
            child: _error == null
                ? const CircularProgressIndicator()
                : Notice(_error!),
          )
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                _order!['investigation_code'] as String? ?? 'Kipimo',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                'Hali: ${_order!['status'] ?? ''} • ${_order!['investigation_type'] ?? ''}',
              ),
              if (_order!['narrative'] != null) ...[
                const SectionTitle('Maelezo ya matokeo'),
                Text(_order!['narrative'] as String),
              ],
              const SizedBox(height: 16),
              const SectionTitle('Vipimo'),
              ...((_order!['values'] as List? ?? []).whereType<Map>().map(
                (v) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    '${v['analyte'] ?? 'Kipimo'}: ${v['value'] ?? '—'} ${v['unit'] ?? ''}',
                  ),
                  subtitle: Text(
                    'Kiwango cha rejea: ${v['reference_low'] ?? '—'}–${v['reference_high'] ?? '—'} • ${v['flag'] ?? ''}',
                  ),
                ),
              )),
              if ((_order!['values'] as List? ?? []).isEmpty &&
                  _order!['narrative'] == null)
                const Empty('Matokeo bado hayajawekwa.'),
            ],
          ),
  );
}
