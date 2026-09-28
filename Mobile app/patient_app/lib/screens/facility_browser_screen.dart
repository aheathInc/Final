import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'doctor_directory_screen.dart';

String facilityLocationLabel(Map<String, dynamic> facility) {
  final location = facility['location'];

  if (location is Map) {
    final lat = location['lat'];
    final lng = location['lng'];
    if (lat != null && lng != null) {
      return 'Lat $lat, Lng $lng';
    }
  }

  if (location is String && location.trim().isNotEmpty) {
    return location;
  }

  return 'Eneo halijulikani';
}

class FacilityBrowserScreen extends StatefulWidget {
  const FacilityBrowserScreen({super.key});

  @override
  State<FacilityBrowserScreen> createState() => _FacilityBrowserScreenState();
}

class _FacilityBrowserScreenState extends State<FacilityBrowserScreen> {
  List<Map<String, dynamic>> _facilities = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await Api.get('/facilities');
      if (!mounted) return;
      setState(() {
        _facilities = ((data['data'] as List?) ?? []).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _error = S.errorGeneric; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tafuta Kituo')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Notice(_error!))
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _facilities.length,
                  itemBuilder: (context, i) {
                    final f = _facilities[i];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Panel(
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => DoctorDirectoryScreen(
                            facilityId: f['id'] as String,
                            facilityName: f['name'] as String,
                          ),
                        )),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(f['name'] as String,
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 4),
                            Text(facilityLocationLabel(f),
                                style: const TextStyle(color: AppColors.inkSoft)),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
