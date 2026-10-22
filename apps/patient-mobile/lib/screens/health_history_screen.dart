import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/health_history.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class HealthHistoryScreen extends StatefulWidget {
  const HealthHistoryScreen({super.key});

  @override
  State<HealthHistoryScreen> createState() => _HealthHistoryScreenState();
}

class _HealthHistoryScreenState extends State<HealthHistoryScreen> {
  String? _ownerId;
  String _category = 'all';
  String _source = 'all';
  List<Map<String, dynamic>> _entries = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final owner = await Session.userId();
    if (owner == null) {
      if (mounted) setState(() { _ownerId = null; _entries = const []; _error = 'Ingia tena ili kuona historia yako.'; _loading = false; });
      return;
    }
    if (mounted) setState(() { _loading = true; _error = null; });
    try {
      final result = await Api.get('/interop/my-history');
      final currentOwner = await Session.userId();
      if (!mounted) return;
      if (currentOwner != owner) {
        setState(() { _ownerId = currentOwner; _entries = const []; _error = 'Akaunti imebadilika. Onyesha upya historia.'; _loading = false; });
        return;
      }
      setState(() {
        _ownerId = owner;
        _entries = parseHealthHistoryResponse(result);
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() { _ownerId = owner; _entries = const []; _error = error.toString(); _loading = false; });
    }
  }

  List<Map<String, dynamic>> get _visibleEntries => filterHealthHistory(
        _entries, category: _category, source: _source,
      );

  @override
  Widget build(BuildContext context) {
    final ownerMatches = _ownerId != null;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Historia Yangu ya Afya'),
        actions: [IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh), tooltip: 'Onyesha upya')],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('My Health History', style: TextStyle(fontSize: 14, color: AppColors.inkSoft)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: DropdownButtonFormField<String>(
                initialValue: _category,
                decoration: const InputDecoration(labelText: 'Aina ya rekodi'),
                items: healthHistoryCategories.entries.map((item) => DropdownMenuItem(value: item.key, child: Text(item.value))).toList(),
                onChanged: (value) => setState(() => _category = value ?? 'all'),
              )),
              const SizedBox(width: 12),
              Expanded(child: DropdownButtonFormField<String>(
                initialValue: _source,
                decoration: const InputDecoration(labelText: 'Chanzo'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Vyanzo vyote')),
                  DropdownMenuItem(value: 'ahp', child: Text('AHP')),
                  DropdownMenuItem(value: 'external', child: Text('Zilizoingizwa')),
                ],
                onChanged: (value) => setState(() => _source = value ?? 'all'),
              )),
            ]),
            const SizedBox(height: 16),
            if (_loading)
              const Padding(padding: EdgeInsets.all(28), child: Center(child: CircularProgressIndicator()))
            else if (_error != null)
              Panel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Historia haikupatikana', style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8), Text(_error!, style: const TextStyle(color: AppColors.inkSoft)),
                TextButton(onPressed: _load, child: const Text('Jaribu tena')),
              ]))
            else if (!ownerMatches || _visibleEntries.isEmpty)
              const Panel(child: Text('Hakuna rekodi za historia zinazoonekana kwa sasa.', style: TextStyle(color: AppColors.inkSoft)))
            else
              ..._visibleEntries.map(_entryCard),
          ],
        ),
      ),
    );
  }

  Widget _entryCard(Map<String, dynamic> entry) {
    final source = entry['source'] is Map ? Map<String, dynamic>.from(entry['source'] as Map) : <String, dynamic>{};
    final details = entry['detail'] is Map ? Map<String, dynamic>.from(entry['detail'] as Map) : <String, dynamic>{};
    final imported = source['type'] == 'external';
    final facility = source['facility_name'] as String?;
    final event = DateTime.tryParse(entry['occurred_at'] as String? ?? '');
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Panel(
        child: Material(
          color: Colors.white,
          child: ExpansionTile(
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(bottom: 8),
            title: Text(entry['summary'] as String? ?? 'Rekodi ya afya', style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text([
                healthHistoryCategories[entry['category']] ?? (entry['category'] as String? ?? 'Rekodi'),
                if (event != null) '${event.toLocal()}'.split('.').first,
                '${entry['status'] ?? 'imeandikwa'}',
                '${source['name'] ?? 'A-health'}${facility == null ? '' : ' · $facility'}',
              ].join(' · '), style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
            ),
            trailing: Icon(imported ? Icons.cloud_download_outlined : Icons.health_and_safety_outlined, color: imported ? AppColors.amber : AppColors.petrol),
            children: [
              if (imported) const Align(alignment: Alignment.centerLeft, child: Text('Imetoka kwenye mfumo wa nje; haijathibitishwa na daktari wa AHP.', style: TextStyle(color: AppColors.inkSoft, fontSize: 12))),
              ...details.entries.where((entry) => entry.value != null).map((item) => Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Align(alignment: Alignment.centerLeft, child: Text('${item.key.replaceAll('_', ' ')}: ${item.value}', style: const TextStyle(fontSize: 13))),
              )),
            ],
          ),
        ),
      ),
    );
  }
}
