import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// Vaccination record and schedule (FR-PS-04), for the patient and any
/// dependants under the same guardian account.
class VaccinationsScreen extends StatefulWidget {
  const VaccinationsScreen({super.key});
  @override
  State<VaccinationsScreen> createState() => _VaccinationsScreenState();
}

class _VaccinationsScreenState extends State<VaccinationsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final user = await Session.user();
      final ppid = user?['patient_profile_id'] as String?;
      if (ppid == null) {
        setState(() { _loading = false; });
        return;
      }
      final data = await Api.get('/patient-profiles/$ppid/vaccinations');
      if (!mounted) return;
      setState(() {
        _rows = ((data['data'] as List?) ?? []).cast<Map<String, dynamic>>();
        _error = null; _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = S.errorOffline; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final due = _rows.where((v) => v['status'] == 'due' || v['status'] == 'overdue').toList();
    final given = _rows.where((v) => v['status'] == 'administered').toList();

    return Scaffold(
      appBar: AppBar(title: const Text(S.vaccinations)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (_error != null) ...[Notice(_error!), const SizedBox(height: 16)],
                  const SectionTitle('Zinazosubiri'),
                  if (due.isEmpty)
                    const Empty('Hakuna chanjo inayosubiri.')
                  else
                    ...due.map((v) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Panel(
                            accent: v['status'] == 'overdue' ? AppColors.clay : AppColors.amber,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${v['vaccine_code']} · dozi ${v['dose_number']}',
                                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
                                Text(
                                  v['status'] == 'overdue'
                                      ? 'Muda umepita — nenda kituo cha afya'
                                      : 'Inasubiri',
                                  style: TextStyle(
                                    color: v['status'] == 'overdue' ? AppColors.clay : AppColors.amber),
                                ),
                              ],
                            ),
                          ),
                        )),
                  if (given.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    const SectionTitle('Ulizopata'),
                    ...given.map((v) {
                      final at = DateTime.tryParse(v['administered_at'] as String? ?? '');
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(children: [
                          const Icon(Icons.check, size: 18, color: AppColors.petrol),
                          const SizedBox(width: 10),
                          Expanded(child: Text('${v['vaccine_code']} · dozi ${v['dose_number']}')),
                          if (at != null)
                            Text(DateFormat('MMM y').format(at),
                                style: const TextStyle(color: AppColors.inkSoft, fontSize: 13)),
                        ]),
                      );
                    }),
                  ],
                ],
              ),
            ),
    );
  }
}
