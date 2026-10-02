import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/patient_experience.dart';
import '../core/phone.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class FamilyScreen extends StatefulWidget {
  const FamilyScreen({super.key});
  @override
  State<FamilyScreen> createState() => _FamilyScreenState();
}

class _FamilyScreenState extends State<FamilyScreen> {
  Map<String, dynamic>? _family;
  List<Map<String, dynamic>> _dependants = [];
  String? _error;
  String? _familyError;
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final response =
          await Api.get('/users/me/dependents', query: {'limit': 100});
      final dependants = dependantsFromJson(response);
      Map<String, dynamic>? family;
      String? familyError;
      try {
        family = familyFromJson(await Api.get('/families/me'));
      } on ApiException catch (error) {
        if (error.status != 404) {
          familyError = 'Taarifa za kundi la familia hazipatikani.';
        }
      } catch (_) {
        familyError = 'Taarifa za kundi la familia hazipatikani.';
      }
      if (family != null) {
        final relationships = <String, String>{
          for (final raw in family['members'] as List)
            if (raw is Map &&
                raw['patient_profile_id'] is String &&
                raw['relationship'] is String)
              raw['patient_profile_id'] as String:
                  raw['relationship'] as String,
        };
        for (final dependant in dependants) {
          final relationship = relationships[dependant['patient_profile_id']];
          if (relationship != null) dependant['relationship'] = relationship;
        }
      }
      if (!mounted) return;
      setState(() {
        _family = family;
        _dependants = dependants;
        _familyError = familyError;
        _error = null;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.status == 403
              ? 'Huna ruhusa ya kuona wategemezi hawa.'
              : 'Wategemezi hawakuweza kupakiwa.';
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Wategemezi hawakuweza kupakiwa.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _createDependant() async {
    final form = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => const _CreateDependantDialog(),
    );
    if (form == null) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await Api.post('/users/me/dependents', form, idempotencyKey: newOpId());
      await _load();
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.status == 409
              ? 'Akaunti hii imefikia kikomo cha wategemezi.'
              : 'Mtegemezi hakuweza kuongezwa.';
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Mtegemezi hakuweza kuongezwa.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Familia na wategemezi')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    const Text(
                      'Taarifa za uhusiano tu. Rekodi za afya za mtegemezi hazionyeshwi hapa.',
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Notice(_error!),
                    ],
                    if (_familyError != null) ...[
                      const SizedBox(height: 12),
                      Notice(_familyError!),
                    ],
                    const SizedBox(height: 20),
                    const SectionTitle('Wategemezi'),
                    if (_dependants.isEmpty)
                      const Empty('Hakuna wategemezi walioongezwa.'),
                    ..._dependants.map((dependant) => _memberTile(
                          dependant,
                          gp: _assignmentFor(dependant, 'gp_clinician'),
                          obgyn: _assignmentFor(dependant, 'obgyn_clinician'),
                        )),
                    OutlinedButton.icon(
                      onPressed: _saving ? null : _createDependant,
                      icon: _saving
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.person_add_alt_1),
                      label: const Text('Ongeza mtegemezi'),
                    ),
                    if (_family != null) ...[
                      const SizedBox(height: 24),
                      Text(
                        _family!['name'] as String? ?? 'Familia',
                        style: const TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const Text(
                          'Kundi la familia na madaktari waliopangiwa (taarifa za kusoma tu).'),
                      const SizedBox(height: 16),
                      const SectionTitle('Wanafamilia'),
                      ..._familyMembersNotShownAsDependants()
                          .map((member) => _memberTile(
                                member,
                                gp: _family!['gp_clinician'] as Map?,
                                obgyn: _family!['obgyn_clinician'] as Map?,
                              )),
                      const SizedBox(height: 12),
                      const SectionTitle('Madaktari waliopangiwa familia'),
                      _assignmentCard('Daktari wa familia (GP)',
                          _family!['gp_clinician'] as Map?),
                      _assignmentCard('Daktari wa afya ya uzazi (OB-GYN)',
                          _family!['obgyn_clinician'] as Map?),
                    ],
                  ],
                ),
              ),
      );

  List<Map<String, dynamic>> _familyMembersNotShownAsDependants() {
    final dependantIds =
        _dependants.map((dependant) => dependant['patient_profile_id']).toSet();
    return ((_family?['members'] as List?) ?? [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .where((member) => !dependantIds.contains(member['patient_profile_id']))
        .toList();
  }

  Map? _assignmentFor(Map<String, dynamic> dependant, String key) {
    final profileId = dependant['patient_profile_id'];
    final linked = ((_family?['members'] as List?) ?? []).whereType<Map>().any(
          (member) => member['patient_profile_id'] == profileId,
        );
    return linked && _family != null ? _family![key] as Map? : null;
  }

  Widget _memberTile(
    Map<String, dynamic> member, {
    required Map? gp,
    required Map? obgyn,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Panel(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => DependantSummaryScreen(
                dependant: member,
                gp: gp,
                obgyn: obgyn,
              ),
            ),
          ),
          child: Row(
            children: [
              const Icon(Icons.person_outline, color: AppColors.petrol),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      member['full_name'] as String,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    Text(
                        'Aina: ${_relationshipLabel(member['relationship'] as String)}'),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      );

  Widget _assignmentCard(String label, Map? clinician) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
              const SizedBox(height: 4),
              Text(clinician?['full_name'] as String? ?? 'Hajapangiwa'),
              Text(clinician == null
                  ? 'Hali: haijapangiwa'
                  : 'Hali: amepangiwa'),
            ],
          ),
        ),
      );
}

String _relationshipLabel(String value) => switch (value) {
      'dependant' => 'Mtegemezi',
      'head' => 'Mkuu wa familia',
      'spouse' => 'Mwenza',
      'child' => 'Mtoto',
      'parent' => 'Mzazi',
      'sibling' => 'Ndugu',
      _ => value,
    };

class _CreateDependantDialog extends StatefulWidget {
  const _CreateDependantDialog();

  @override
  State<_CreateDependantDialog> createState() => _CreateDependantDialogState();
}

class _CreateDependantDialogState extends State<_CreateDependantDialog> {
  final _name = TextEditingController();
  DateTime? _dateOfBirth;
  String? _sex;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Ongeza mtegemezi'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Jina kamili'),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () async {
                  final now = DateTime.now();
                  final value = await showDatePicker(
                    context: context,
                    initialDate: _dateOfBirth ?? DateTime(now.year - 10, 1, 1),
                    firstDate: DateTime(1900),
                    lastDate: now,
                  );
                  if (value != null) setState(() => _dateOfBirth = value);
                },
                icon: const Icon(Icons.calendar_month_outlined),
                label: Text(_dateOfBirth == null
                    ? 'Tarehe ya kuzaliwa'
                    : '${_dateOfBirth!.year}-${_dateOfBirth!.month.toString().padLeft(2, '0')}-${_dateOfBirth!.day.toString().padLeft(2, '0')}'),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _sex,
                decoration: const InputDecoration(labelText: 'Jinsia'),
                items: const [
                  DropdownMenuItem(value: 'female', child: Text('Mwanamke')),
                  DropdownMenuItem(value: 'male', child: Text('Mwanaume')),
                  DropdownMenuItem(value: 'other', child: Text('Nyingine')),
                ],
                onChanged: (value) => setState(() => _sex = value),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Ghairi'),
          ),
          FilledButton(
            onPressed: _name.text.trim().isEmpty ||
                    _dateOfBirth == null ||
                    _sex == null
                ? null
                : () => Navigator.pop(context, {
                      'full_name': _name.text.trim(),
                      'date_of_birth':
                          '${_dateOfBirth!.year}-${_dateOfBirth!.month.toString().padLeft(2, '0')}-${_dateOfBirth!.day.toString().padLeft(2, '0')}',
                      'sex': _sex,
                    }),
            child: const Text('Hifadhi'),
          ),
        ],
      );
}

class DependantSummaryScreen extends StatelessWidget {
  const DependantSummaryScreen({
    required this.dependant,
    required this.gp,
    required this.obgyn,
    super.key,
  });

  final Map<String, dynamic> dependant;
  final Map? gp;
  final Map? obgyn;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Muhtasari wa mwanafamilia')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              dependant['full_name'] as String,
              style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w600),
            ),
            Text(
                'Aina: ${_relationshipLabel(dependant['relationship'] as String)}'),
            if (dependant['date_of_birth'] is String)
              Text('Tarehe ya kuzaliwa: ${dependant['date_of_birth']}'),
            if (dependant['sex'] is String) Text('Jinsia: ${dependant['sex']}'),
            const SizedBox(height: 16),
            const Notice(
              'Muktadha wa mtegemezi huyu umechaguliwa. Rekodi zake za afya hazionyeshwi bila ruhusa tofauti.',
            ),
            if (gp != null || obgyn != null) ...[
              const SectionTitle('Madaktari waliopangiwa familia'),
              _doctor('GP', gp),
              _doctor('OB-GYN', obgyn),
            ],
          ],
        ),
      );

  Widget _doctor(String role, Map? clinician) => ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(role),
        subtitle: Text(clinician?['full_name'] as String? ?? 'Hajapangiwa'),
        trailing: Text(clinician == null ? 'Haijapangiwa' : 'Amepangiwa'),
      );
}
