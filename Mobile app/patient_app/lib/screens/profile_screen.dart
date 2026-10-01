import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/db.dart';
import '../core/patient_care.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// The health profile (FR-ID-04), dependants (FR-ID-05), and the cached
/// consultation notes — the third thing the design requires to be readable
/// with no signal.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _name = TextEditingController();
  final _allergies = TextEditingController();
  final _conditions = TextEditingController();
  final _emergencyContact = TextEditingController();
  String _language = 'sw';
  int _userVersion = 0;
  int _profileVersion = 0;
  List<Map<String, dynamic>> _dependents = [];
  List<Map<String, Object?>> _notes = [];
  bool _loading = true;
  bool _saving = false;
  bool _versionConflict = false;
  String? _message;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _allergies.dispose();
    _conditions.dispose();
    _emergencyContact.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    // Cached notes first, so this screen has content even with no signal.
    final notes = await Db.notes();
    try {
      final me = await Api.get('/users/me');
      final profile = await Api.get('/patient-profiles/me');
      final deps = await Api.get('/users/me/dependents');
      if (!mounted) return;
      setState(() {
        _name.text = (me['full_name'] as String?) ?? '';
        _language = (me['preferred_language'] as String?) ?? 'sw';
        _userVersion = (me['version'] as num?)?.toInt() ?? 0;
        _profileVersion = (profile['version'] as num?)?.toInt() ?? 0;
        
        _allergies.text = (profile['allergies'] as List?)?.join(', ') ?? '';
        _conditions.text = (profile['chronic_conditions'] as List?)?.join(', ') ?? '';
        _emergencyContact.text = (profile['emergency_contact'] as String?) ?? '';

        _dependents = ((deps['data'] as List?) ?? []).cast<Map<String, dynamic>>();
        _notes = notes;
        _versionConflict = false;
        _loading = false;
      });
    } catch (_) {
      final user = await Session.user();
      if (!mounted) return;
      setState(() {
        _name.text = (user?['full_name'] as String?) ?? '';
        _notes = notes;
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    setState(() { _saving = true; _message = null; });
    try {
      // Update User identity
      final me = await Api.patch('/users/me', {
        'base_version': _userVersion,
        'full_name': _name.text,
        'preferred_language': _language,
      });
      if (me is Map && me['version'] is num) {
        _userVersion = (me['version'] as num).toInt();
      }

      // Update Patient profile clinical details
      final profile = await Api.patch('/patient-profiles/me', profileClinicalUpdateBody(
        profileVersion: _profileVersion,
        allergies: _allergies.text.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
        chronicConditions: _conditions.text.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
        emergencyContact: _emergencyContact.text.trim().isEmpty ? null : _emergencyContact.text.trim(),
      ));

      setState(() {
        _message = 'Imehifadhiwa.';
        _profileVersion = (profile['version'] as num?)?.toInt() ?? _profileVersion + 1;
      });
    } on ApiException catch (e) {
      setState(() {
        _versionConflict = e.status == 409 || e.code == 'VERSION_CONFLICT';
        _message = _versionConflict
            ? 'Wasifu umebadilishwa kwenye kifaa kingine. Pakia taarifa za sasa kabla ya kuhifadhi tena.'
            : e.message;
      });
    } catch (_) {
      setState(() => _message = S.errorOffline);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(S.profile)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                const SectionTitle('Wasifu wangu'),
                _field('Jina kamili', _name),
                const SizedBox(height: 16),
                const Text('Lugha', style: TextStyle(fontWeight: FontWeight.w500)),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: _language,
                  items: const [
                    DropdownMenuItem(value: 'sw', child: Text('Kiswahili')),
                    DropdownMenuItem(value: 'en', child: Text('English')),
                  ],
                  onChanged: (v) => setState(() => _language = v ?? 'sw'),
                  decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 4)),
                ),
                const SizedBox(height: 16),
                _field('Mizio (Allergies)', _allergies, hint: 'Mfano: Penicillin, Karanga'),
                const SizedBox(height: 16),
                _field('Magonjwa ya kudumu', _conditions, hint: 'Mfano: Kisukari, Shinikizo la juu la damu'),
                const SizedBox(height: 16),
                _field('Namba ya dharura', _emergencyContact, hint: 'Namba ya ndugu au rafiki'),
                
                if (_message != null) ...[
                  const SizedBox(height: 16),
                  Notice(_message!, tone: NoticeTone.attention),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _saving || _versionConflict ? null : _save,
                  child: Text(_saving ? 'Inahifadhi...' : S.save),
                ),
                if (_versionConflict) ...[
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _saving ? null : _load,
                    child: const Text('Pakia wasifu wa sasa'),
                  ),
                ],

                const SizedBox(height: 32),
                const SectionTitle(S.dependents),
                if (_dependents.isEmpty)
                  const Empty('Hujaongeza mtu yeyote unayemhudumia.')
                else
                  ..._dependents.map((d) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Panel(
                          child: Text((d['full_name'] as String?) ?? '',
                              style: const TextStyle(fontSize: 16)),
                        ),
                      )),

                const SizedBox(height: 32),
                const SectionTitle('Ushauri wa daktari'),
                if (_notes.isEmpty)
                  const Empty('Bado hujapata ushauri wa daktari.')
                else
                  ..._notes.map(_noteCard),
              ],
            ),
    );
  }

  Widget _noteCard(Map<String, Object?> n) {
    final at = DateTime.tryParse(n['created_at'] as String? ?? '');
    final flags = (n['red_flags'] as String?)?.split('\n').where((s) => s.isNotEmpty).toList() ?? [];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (at != null)
              Text(DateFormat('d MMM y').format(at),
                  style: const TextStyle(color: AppColors.inkSoft, fontSize: 13)),
            if (n['diagnosis_text'] != null) ...[
              const SizedBox(height: 6),
              Text(n['diagnosis_text'] as String,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
            ],
            if (n['advice_text'] != null) ...[
              const SizedBox(height: 6),
              Text(n['advice_text'] as String, style: const TextStyle(fontSize: 16)),
            ],
            // Kept with the advice rather than in a separate place: these are
            // what tell someone at home when to stop waiting.
            if (flags.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Text('Rudi haraka ukiona:',
                  style: TextStyle(color: AppColors.clay, fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              ...flags.map((f) => Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text('• $f', style: const TextStyle(color: AppColors.clay, fontSize: 15)),
                  )),
            ],
          ],
        ),
      ),
    );
  }

  Widget _field(String label, TextEditingController controller, {String? hint}) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          TextField(controller: controller, decoration: InputDecoration(hintText: hint)),
        ],
      );
}
