import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/patient_care.dart';
import '../core/phone.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class AppointmentsScreen extends StatefulWidget {
  const AppointmentsScreen({super.key});
  @override
  State<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends State<AppointmentsScreen> {
  final _care = PatientCareRepository();
  List<Map<String, dynamic>> _appointments = [];
  List<Map<String, dynamic>> _clinicians = [];
  String? _error;
  bool _loading = true, _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final values = await Future.wait([
        _care.appointments(),
        _care.clinicians(),
      ]);
      if (!mounted) return;
      setState(() {
        _appointments = values[0] as List<Map<String, dynamic>>;
        _clinicians = ((values[1] as Map)['data'] as List? ?? [])
            .cast<Map<String, dynamic>>();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted)
        setState(() {
          _error =
              e is ApiException ? e.message : 'Imeshindikana kupakia miadi.';
          _loading = false;
        });
    }
  }

  Future<void> _book(Map<String, dynamic> clinician) async {
    if (_busy) return;
    setState(() => _busy = true);
    final now = DateTime.now();
    List<Map<String, dynamic>> slots;
    try {
      slots = await _care.slots(
        clinician['id'] as String,
        now,
        now.add(const Duration(days: 30)),
      );
    } catch (e) {
      if (mounted)
        setState(() {
          _busy = false;
          _error = e is ApiException ? e.message : 'Nafasi hazikupatikana.';
        });
      return;
    }
    if (!mounted) return;
    if (slots.isEmpty) {
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Hakuna nafasi zinazopatikana kwa siku 30 zijazo.'),
        ),
      );
      return;
    }
    final selected = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(
              title: Text('Chagua muda'),
              subtitle: Text('Nafasi hizi zimetolewa na daktari.'),
            ),
            ...slots.map(
              (s) => ListTile(
                leading: const Icon(Icons.schedule, color: AppColors.petrol),
                title: Text(_date(s['starts_at'] as String?)),
                subtitle: Text(
                  '${s['duration_minutes'] ?? ''} min • ${s['modality'] ?? ''}',
                ),
                onTap: () => Navigator.pop(context, s),
              ),
            ),
          ],
        ),
      ),
    );
    if (selected == null || !mounted) {
      if (mounted) setState(() => _busy = false);
      return;
    }
    try {
      await _care.bookAppointment(
        opId: newOpId(),
        slotId: selected['id'] as String,
      );
      await _load();
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Miadi imehifadhiwa na seva.')),
        );
    } on ApiException catch (e) {
      if (mounted)
        setState(
          () => _error = e.code == 'SLOT_UNAVAILABLE'
              ? 'Nafasi hiyo imechukuliwa. Chagua nafasi nyingine.'
              : e.message,
        );
    } catch (e) {
      if (mounted)
        setState(
          () =>
              _error = 'Miadi haikuhifadhiwa. Hakuna ombi lililowekwa foleni.',
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(String id) async {
    final key = newOpId();
    try {
      await _care.cancelAppointment(id, opId: key);
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Miadi haikughairiwa.');
    }
  }

  String _date(String? raw) {
    final d = DateTime.tryParse(raw ?? '');
    return d == null
        ? 'Muda haujulikani'
        : DateFormat('EEE d MMM, HH:mm').format(d.toLocal());
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Miadi')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_error != null) Notice(_error!),
                    const SectionTitle('Miadi yangu'),
                    if (_appointments.isEmpty)
                      const Empty('Huna miadi iliyohifadhiwa.'),
                    ..._appointments.map(
                      (a) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Panel(
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => AppointmentDetailScreen(
                                appointmentId: a['id'] as String,
                              ),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _date(a['starts_at'] as String?),
                                style: const TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                'Hali: ${a['status'] ?? 'haijulikani'} • ${a['modality'] ?? ''}',
                              ),
                              if (a['status'] == 'booked')
                                Align(
                                  alignment: Alignment.centerRight,
                                  child: TextButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _cancel(a['id'] as String),
                                    child: const Text('Ghairi miadi'),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const SectionTitle('Chagua daktari na muda'),
                    if (_clinicians.isEmpty)
                      const Empty(
                          'Hakuna madaktari waliothibitishwa kwa sasa.'),
                    ..._clinicians.map(
                      (c) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(c['full_name'] as String? ?? 'Daktari'),
                        subtitle: Text(
                          '${c['specialty'] ?? 'Huduma ya jumla'} • ${c['status'] ?? ''}',
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: _busy ? null : () => _book(c),
                      ),
                    ),
                  ],
                ),
              ),
      );
}

class AppointmentDetailScreen extends StatefulWidget {
  const AppointmentDetailScreen({super.key, required this.appointmentId});
  final String appointmentId;
  @override
  State<AppointmentDetailScreen> createState() =>
      _AppointmentDetailScreenState();
}

class _AppointmentDetailScreenState extends State<AppointmentDetailScreen> {
  Map<String, dynamic>? _appointment;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final value = await PatientCareRepository().appointment(
        widget.appointmentId,
      );
      if (mounted)
        setState(() {
          _appointment = value;
          _error = null;
        });
    } catch (e) {
      if (mounted)
        setState(
          () => _error = e is ApiException ? e.message : 'Miadi haikupatikana.',
        );
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Maelezo ya miadi')),
        body: _appointment == null
            ? Center(
                child: _error == null
                    ? const CircularProgressIndicator()
                    : Notice(_error!),
              )
            : ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    _appointment!['status'] as String? ?? 'Hali haijulikani',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(_appointment!['starts_at'] as String? ??
                      'Muda haujulikani'),
                  Text(
                    'Muda wa huduma: ${_appointment!['duration_minutes'] ?? '—'} min',
                  ),
                  Text('Njia: ${_appointment!['modality'] ?? '—'}'),
                  if (_appointment!['reason'] != null)
                    Text('Sababu: ${_appointment!['reason']}'),
                  if (_appointment!['cancelled_reason'] != null)
                    Text(
                      'Sababu ya kughairi: ${_appointment!['cancelled_reason']}',
                    ),
                ],
              ),
      );
}
