import '../core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// Vaccination record and schedule for the active patient profile.
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
        setState(() {
          _loading = false;
        });
        return;
      }
      final data = await Api.get('/patient-profiles/$ppid/vaccinations');
      if (!mounted) return;
      setState(() {
        _rows = ((data['data'] as List?) ?? []).cast<Map<String, dynamic>>();
        _error = null;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = S.errorOffline;
          _loading = false;
        });
      }
    }
  }

  String _date(Object? raw) {
    final value = DateTime.tryParse(raw as String? ?? '');
    return value == null
        ? L.tr('Tarehe haijatajwa')
        : DateFormat('d MMM y').format(value.toLocal());
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final due = _rows
        .where((v) => v['status'] == 'due' || v['status'] == 'overdue')
        .toList();
    final given = _rows.where((v) => v['status'] == 'administered').toList();

    return Scaffold(
      appBar: AppBar(title: Text(S.vaccinations)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (_error != null) ...[
                    Notice(_error!),
                    const SizedBox(height: 16),
                  ],
                  SectionTitle(L.tr('Zinazosubiri')),
                  if (due.isEmpty)
                    Empty(L.tr('Hakuna chanjo inayosubiri.'))
                  else
                    ...due.map(
                      (v) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Panel(
                          accent: v['status'] == 'overdue'
                              ? AppColors.clay
                              : AppColors.amber,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                L.tr("{0} · dozi {1}",
                                    [v['vaccine_code'], v['dose_number']]),
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              Text(
                                v['status'] == 'overdue'
                                    ? L.tr(
                                        'Muda umepita — nenda kituo cha afya')
                                    : L.tr('Inasubiri'),
                                style: TextStyle(
                                  color: v['status'] == 'overdue'
                                      ? AppColors.clay
                                      : AppColors.amber,
                                ),
                              ),
                              Text(
                                L.tr("Inahitajika: {0}", [_date(v['due_at'])]),
                                style: const TextStyle(
                                  color: AppColors.inkSoft,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  if (given.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    SectionTitle(L.tr('Ulizopata')),
                    ...given.map((v) {
                      final at = DateTime.tryParse(
                        v['administered_at'] as String? ?? '',
                      );
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.check,
                              size: 18,
                              color: AppColors.petrol,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                L.tr("{0} · dozi {1}",
                                    [v['vaccine_code'], v['dose_number']]),
                              ),
                            ),
                            if (at != null)
                              Text(
                                DateFormat('d MMM y').format(at.toLocal()),
                                style: const TextStyle(
                                  color: AppColors.inkSoft,
                                  fontSize: 13,
                                ),
                              ),
                          ],
                        ),
                      );
                    }),
                  ],
                ],
              ),
            ),
    );
  }
}
