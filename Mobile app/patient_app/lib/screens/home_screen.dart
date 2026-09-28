import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/db.dart';
import '../core/outbox.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'login_screen.dart';
import 'new_consultation_screen.dart';
import 'thread_screen.dart';
import 'medications_screen.dart';
import 'checkins_screen.dart';
import 'screening_screen.dart';
import 'vaccinations_screen.dart';
import 'emergency_screen.dart';
import 'profile_screen.dart';
import 'facility_browser_screen.dart';


class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Map<String, dynamic>> _open = [];
  int _pending = 0;
  bool _online = true;
  bool _loading = true;
  String? _name;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = await Session.user();
    final online = await Api.online;
    await Api.flushOutbox();
    final pending = await Outbox.pendingCount();

    List<Map<String, dynamic>> open = [];
    if (online) {
      try {
        final data = await Api.get('/consultations', query: {'limit': 20});
        open = ((data['data'] as List?) ?? [])
            .cast<Map<String, dynamic>>()
            .where((c) => c['status'] != 'completed' && c['status'] != 'cancelled')
            .toList();
        // Cached so the last advice is readable with no signal — one of the
        // three things the design says must survive losing the network.
        await _cacheNotes();
      } catch (_) {
        // Falls through to whatever is already cached.
      }
    }

    if (!mounted) return;
    setState(() {
      _name = user?['full_name'] as String?;
      _open = open;
      _pending = pending;
      _online = online;
      _loading = false;
    });
  }

  Future<void> _cacheNotes() async {
    try {
      final data = await Api.get('/consultations', query: {'limit': 5, 'status': 'completed'});
      final rows = ((data['data'] as List?) ?? []).map((raw) {
        final c = raw as Map<String, dynamic>;
        final note = c['note'] as Map<String, dynamic>?;
        return <String, Object?>{
          'id': c['id'] as String,
          'diagnosis_text': note?['diagnosis_text'],
          'advice_text': note?['advice_text'],
          'red_flags': (note?['red_flags_discussed'] as List?)?.join('\n'),
          'created_at': (c['created_at'] as String?) ?? DateTime.now().toIso8601String(),
        };
      }).toList();
      if (rows.isNotEmpty) await Db.cacheNotes(rows);
    } catch (_) {
      // Caching is best effort; failing to refresh it must never break the
      // screen that shows it.
    }
  }

  Future<void> _signOut() async {
    await Session.clear();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
  }

  void _go(Widget screen) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => screen))
        .then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_name == null ? S.appName : 'Habari, $_name'),
        actions: [
          TextButton(onPressed: _signOut, child: const Text(S.signOut)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (!_online) ...[
              const Notice(S.offlineBanner, tone: NoticeTone.attention),
              const SizedBox(height: 16),
            ] else if (_pending > 0) ...[
              Notice('Majibu $_pending ${S.pendingSuffix}.', tone: NoticeTone.attention),
              const SizedBox(height: 16),
            ],

            InkWell(
              onTap: () => _go(const FacilityBrowserScreen()),
              child: Container(
                width: double.infinity,
                color: AppColors.petrol,
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 26),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Tafuta Daktari au Kituo',
                        style: TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w600)),
                    SizedBox(height: 4),
                    Text('Angalia foleni na daktari aliyepo kabla ya kwenda.', style: TextStyle(color: Color(0xCCFFFFFF), fontSize: 15)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            OutlinedButton.icon(
              onPressed: () => _go(const NewConsultationScreen()),
              icon: const Icon(Icons.medical_services_outlined, color: AppColors.petrol),
              label: const Text(S.homeGetHelp, style: TextStyle(color: AppColors.petrol, fontSize: 17)),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                side: const BorderSide(color: AppColors.petrol, width: 2),
                shape: const RoundedRectangleBorder(),
              ),
            ),
            const SizedBox(height: 12),

            OutlinedButton.icon(
              onPressed: () => _go(const EmergencyScreen()),
              icon: const Icon(Icons.warning_amber_rounded, color: AppColors.clay),
              label: const Text(S.emergency, style: TextStyle(color: AppColors.clay, fontSize: 17)),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                side: const BorderSide(color: AppColors.clay, width: 2),
                shape: const RoundedRectangleBorder(),
              ),
            ),

            const SizedBox(height: 28),
            const SectionTitle('Matibabu yanayoendelea'),
            if (_loading)
              const Padding(padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()))
            else if (_open.isEmpty)
              const Empty(S.homeNothing)
            else
              ..._open.map((c) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Panel(
                      onTap: () => _go(ThreadScreen(
                        careThreadId: c['care_thread_id'] as String,
                        title: (c['symptom_text'] as String?) ?? 'Matibabu',
                      )),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text((c['symptom_text'] as String?) ?? 'Ombi la matibabu',
                              style: const TextStyle(fontSize: 16)),
                          const SizedBox(height: 4),
                          Text(_statusLabel(c['status'] as String?),
                              style: const TextStyle(color: AppColors.inkSoft, fontSize: 14)),
                        ],
                      ),
                    ),
                  )),

            const SizedBox(height: 28),
            const SectionTitle('Afya yangu'),
            _tile(Icons.medication_outlined, S.medications, const MedicationsScreen()),
            _tile(Icons.checklist_rtl_outlined, S.checkIns, const CheckInsScreen()),
            _tile(Icons.favorite_outline, S.screening, const ScreeningScreen()),
            _tile(Icons.vaccines_outlined, S.vaccinations, const VaccinationsScreen()),
            _tile(Icons.person_outline, S.profile, const ProfileScreen()),
          ],
        ),
      ),
    );
  }

  Widget _tile(IconData icon, String label, Widget screen) => ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(icon, color: AppColors.petrol),
        title: Text(label, style: const TextStyle(fontSize: 17)),
        trailing: const Icon(Icons.chevron_right, color: AppColors.inkSoft),
        onTap: () => _go(screen),
      );

  static String _statusLabel(String? status) {
    switch (status) {
      case 'pending': return 'Inasubiri daktari';
      case 'offered': return 'Inatafutiwa daktari';
      case 'matched': return 'Daktari amepatikana';
      case 'in_progress': return 'Inaendelea';
      default: return status ?? '';
    }
  }
}
