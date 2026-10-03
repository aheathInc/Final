import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/db.dart';
import '../core/outbox.dart';
import '../core/patient_care.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'login_screen.dart';
import 'new_consultation_screen.dart';
import 'consultation_detail_screen.dart';
import 'checkins_screen.dart';
import 'screening_screen.dart';
import 'vaccinations_screen.dart';
import 'emergency_screen.dart';
import 'profile_screen.dart';
import 'facility_browser_screen.dart';
import 'appointments_screen.dart';
import 'diagnostics_screen.dart';
import 'patient_care_medicines_screen.dart';
import 'family_screen.dart';
import 'education_screen.dart';
import 'privacy_consent_screen.dart';
import 'feedback_screen.dart';
import 'insurance_payments_screen.dart';
import 'assistant_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Map<String, dynamic>> _active = [];
  List<Map<String, dynamic>> _recent = [];
  int _pending = 0;
  int _failed = 0;
  int _retryableFailed = 0;
  bool _online = true;
  bool _loading = true;
  String? _name;
  StreamSubscription<ConnectivityResult>? _connectivitySubscription;

  @override
  void initState() {
    super.initState();
    _connectivitySubscription = Connectivity().onConnectivityChanged.listen((
      result,
    ) {
      final connected = result != ConnectivityResult.none;
      if (!mounted) return;
      setState(() => _online = connected);
      if (connected) _load();
    });
    _load();
  }

  Future<void> _load() async {
    final user = await Session.user();
    final ownerId = user?['id'] as String?;
    var online = await Api.online;
    await Api.flushOutbox();
    final pending = ownerId == null ? 0 : await Outbox.pendingCount(ownerId);
    final failed = ownerId == null ? 0 : await Outbox.failedCount(ownerId);
    final retryableFailed =
        ownerId == null ? 0 : await Outbox.retryableFailedCount(ownerId);

    List<Map<String, dynamic>> consultations = [];
    if (online) {
      try {
        final data = await Api.get('/consultations', query: {'limit': 20});
        consultations =
            ((data['data'] as List?) ?? []).cast<Map<String, dynamic>>();
        // Cached so the last advice is readable with no signal — one of the
        // three things the design says must survive losing the network.
        if (ownerId != null) await _cacheNotes(ownerId);
      } catch (_) {
        // Mark the session degraded even when Wi-Fi exists but the API is down.
        online = false;
      }
    }

    if (!mounted) return;
    setState(() {
      _name = user?['full_name'] as String?;
      final groups = partitionConsultations(consultations);
      _active = groups.active;
      _recent = groups.recent;
      _pending = pending;
      _failed = failed;
      _retryableFailed = retryableFailed;
      _online = online;
      _loading = false;
    });
  }

  Future<void> _cacheNotes(String ownerId) async {
    try {
      final data = await Api.get(
        '/consultations',
        query: {'limit': 5, 'status': 'completed'},
      );
      final rows = <Map<String, Object?>>[];
      var complete = true;
      for (final raw in ((data['data'] as List?) ?? [])) {
        final c = raw as Map<String, dynamic>;
        try {
          final note = await Api.get('/consultations/${c['id']}/note');
          rows.add({
            'id': c['id'] as String,
            'diagnosis_text': note['diagnosis_text'],
            'advice_text': note['advice_text'],
            'red_flags': (note['red_flags_discussed'] as List?)?.join('\n'),
            'created_at': note['signed_at'] as String? ?? c['created_at'],
          });
        } on ApiException {
          complete = false;
        }
      }
      if (complete) await Db.cacheNotes(ownerId, rows);
    } catch (_) {
      // Caching is best effort; failing to refresh it must never break the
      // screen that shows it.
    }
  }

  Future<void> _signOut() async {
    try {
      await Api.post('/auth/logout', {});
    } catch (_) {
      // Clear local credentials even when the network is unavailable.
    } finally {
      await Session.clear();
    }
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  Future<void> _retrySync() async {
    final ownerId = await Session.userId();
    if (ownerId == null) return;
    await Outbox.retryFailed(ownerId);
    await Api.flushOutbox();
    await _load();
  }

  @override
  void dispose() {
    _connectivitySubscription?.cancel();
    super.dispose();
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
              const Notice(
                'Hakuna mtandao. Unaweza kusoma dawa na ushauri uliohifadhiwa; mabadiliko salama yakihifadhiwa yataonyesha Pending sync hadi seva ithibitishe.',
                tone: NoticeTone.attention,
              ),
              const SizedBox(height: 16),
            ],
            if (_pending > 0) ...[
              Notice(
                'Pending sync: majibu $_pending bado hayajathibitishwa na seva.',
                tone: NoticeTone.attention,
              ),
              const SizedBox(height: 16),
            ],
            if (_failed > 0) ...[
              Notice(
                '$_failed mabadiliko yanahitaji kuangaliwa mtandaoni. Hayatajaribiwa tena kiotomatiki.',
                tone: NoticeTone.attention,
              ),
              if (_retryableFailed > 0)
                OutlinedButton.icon(
                  onPressed: _online ? _retrySync : null,
                  icon: const Icon(Icons.sync),
                  label: Text('Jaribu tena usawazishaji ($_retryableFailed)'),
                ),
              const SizedBox(height: 16),
            ],
            InkWell(
              onTap: () => _go(const FacilityBrowserScreen()),
              child: Container(
                width: double.infinity,
                color: AppColors.petrol,
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 26,
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Tafuta Daktari au Kituo',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 21,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Angalia foleni na daktari aliyepo kabla ya kwenda.',
                      style: TextStyle(color: Color(0xCCFFFFFF), fontSize: 15),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => _go(const NewConsultationScreen()),
              icon: const Icon(
                Icons.medical_services_outlined,
                color: AppColors.petrol,
              ),
              label: const Text(
                S.homeGetHelp,
                style: TextStyle(color: AppColors.petrol, fontSize: 17),
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                side: const BorderSide(color: AppColors.petrol, width: 2),
                shape: const RoundedRectangleBorder(),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => _go(const EmergencyScreen()),
              icon: const Icon(
                Icons.warning_amber_rounded,
                color: AppColors.clay,
              ),
              label: const Text(
                S.emergency,
                style: TextStyle(color: AppColors.clay, fontSize: 17),
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                side: const BorderSide(color: AppColors.clay, width: 2),
                shape: const RoundedRectangleBorder(),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => _go(const AssistantScreen()),
              icon: const Icon(
                Icons.auto_awesome_outlined,
                color: AppColors.petrol,
              ),
              label: const Text(
                'Msaidizi wa AI / Uliza A-Health',
                style: TextStyle(color: AppColors.petrol, fontSize: 17),
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                side: const BorderSide(color: AppColors.petrol, width: 2),
                shape: const RoundedRectangleBorder(),
              ),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Msaidizi wa majaribio wa urambazaji; si clinician.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.inkSoft, fontSize: 12),
              ),
            ),
            const SizedBox(height: 28),
            const SectionTitle('Matibabu yanayoendelea'),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_active.isEmpty)
              const Empty(S.homeNothing)
            else
              ..._active.map(_consultationCard),
            if (_recent.isNotEmpty) ...[
              const SizedBox(height: 24),
              const SectionTitle('Matibabu ya hivi karibuni'),
              ..._recent.take(10).map(_consultationCard),
            ],
            const SizedBox(height: 28),
            const SectionTitle('Afya yangu'),
            _tile(
              Icons.calendar_month_outlined,
              'Miadi',
              const AppointmentsScreen(),
            ),
            _tile(
              Icons.biotech_outlined,
              'Vipimo na majibu',
              const DiagnosticsScreen(),
            ),
            _tile(
              Icons.medication_outlined,
              S.medications,
              const PatientCareMedicinesScreen(),
            ),
            _tile(
              Icons.checklist_rtl_outlined,
              S.checkIns,
              const CheckInsScreen(),
            ),
            _tile(Icons.favorite_outline, S.screening, const ScreeningScreen()),
            _tile(
              Icons.vaccines_outlined,
              S.vaccinations,
              const VaccinationsScreen(),
            ),
            _tile(
              Icons.family_restroom,
              'Familia na wategemezi',
              const FamilyScreen(),
            ),
            _tile(
              Icons.menu_book_outlined,
              'Elimu ya afya',
              const EducationScreen(),
            ),
            _tile(
              Icons.privacy_tip_outlined,
              'Faragha na ruhusa',
              const PrivacyConsentScreen(),
            ),
            _tile(
              Icons.feedback_outlined,
              'Maoni na malalamiko',
              const FeedbackScreen(),
            ),
            _tile(
              Icons.account_balance_wallet_outlined,
              'Bima na malipo',
              const InsurancePaymentsScreen(),
            ),
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

  Widget _consultationCard(Map<String, dynamic> consultation) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Panel(
          onTap: () =>
              _go(ConsultationDetailScreen(consultation: consultation)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                (consultation['symptom_text'] as String?) ?? 'Ombi la matibabu',
                style: const TextStyle(fontSize: 16),
              ),
              const SizedBox(height: 4),
              Text(
                consultationStatusLabel(
                  consultation['status'] as String? ?? 'pending',
                ),
                style: const TextStyle(color: AppColors.inkSoft, fontSize: 14),
              ),
            ],
          ),
        ),
      );
}
