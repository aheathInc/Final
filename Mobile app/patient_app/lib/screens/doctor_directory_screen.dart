import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'new_consultation_screen.dart';

class DoctorDirectoryScreen extends StatefulWidget {
  const DoctorDirectoryScreen({super.key, required this.facilityId, required this.facilityName});
  final String facilityId;
  final String facilityName;

  @override
  State<DoctorDirectoryScreen> createState() => _DoctorDirectoryScreenState();
}

class _DoctorDirectoryScreenState extends State<DoctorDirectoryScreen> {
  List<Map<String, dynamic>> _doctors = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await Api.get('/clinicians', query: {'facility_id': widget.facilityId});
      if (!mounted) return;
      setState(() {
        _doctors = ((data['data'] as List?) ?? []).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _error = S.errorGeneric; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.facilityName)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Notice(_error!))
              : _doctors.isEmpty
                  ? const Empty('Hakuna madaktari waliopo kwa sasa.')
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _doctors.length,
                      itemBuilder: (context, i) {
                        final d = _doctors[i];
                        final status = d['status'] ?? 'off_duty';
                        final queueCount = (d['queue_count'] as num?)?.toInt() ?? 0;
                        
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Panel(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: Navigator.canPop(context) ? MainAxisAlignment.spaceBetween : MainAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(d['full_name'] as String,
                                              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
                                          Text(d['specialty'] ?? 'Daktari wa kawaida',
                                              style: const TextStyle(color: AppColors.inkSoft)),
                                        ],
                                      ),
                                    ),
                                    _statusChip(status),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                Row(
                                  children: [
                                    Icon(Icons.people_outline, size: 18, color: Colors.grey.shade600),
                                    const SizedBox(width: 6),
                                    Text('Foleni: $queueCount wagonjwa',
                                        style: TextStyle(color: Colors.grey.shade700)),
                                  ],
                                ),
                                if (status != 'off_duty') ...[
                                  const SizedBox(height: 16),
                                  FilledButton(
                                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                                      builder: (_) => NewConsultationScreen(clinicianId: d['id'] as String),
                                    )),
                                    child: const Text('Jiunge kwenye Foleni'),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        );
                      },
                    ),
    );
  }

  Widget _statusChip(String status) {
    Color color;
    String label;
    switch (status) {
      case 'available':
        color = Colors.green;
        label = 'Yupo';
        break;
      case 'busy':
        color = Colors.orange;
        label = 'Ana mgonjwa';
        break;
      default:
        color = Colors.grey;
        label = 'Hayupo';
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withOpacity(0.5)),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.bold)),
    );
  }
}
