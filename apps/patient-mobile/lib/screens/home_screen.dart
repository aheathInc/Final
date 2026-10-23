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
import '../widgets/premium.dart';
import 'appointments_screen.dart';
import 'assistant_screen.dart';
import 'care_continuity_screen.dart';
import 'checkins_screen.dart';
import 'consultation_detail_screen.dart';
import 'diagnostics_screen.dart';
import 'education_screen.dart';
import 'emergency_screen.dart';
import 'facility_browser_screen.dart';
import 'family_screen.dart';
import 'feedback_screen.dart';
import 'front_desk_screen.dart';
import 'health_history_screen.dart';
import 'insurance_payments_screen.dart';
import 'login_screen.dart';
import 'new_consultation_screen.dart';
import 'patient_care_medicines_screen.dart';
import 'privacy_consent_screen.dart';
import 'profile_screen.dart';
import 'referrals_screen.dart';
import 'screening_screen.dart';
import 'vaccinations_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const _destinations = <_Destination>[
    _Destination('Nyumbani', Icons.home_outlined, Icons.home_rounded),
    _Destination('Huduma', Icons.grid_view_outlined, Icons.grid_view_rounded),
    _Destination('Rekodi', Icons.folder_open_outlined, Icons.folder_rounded),
    _Destination(
        'Ujumbe', Icons.chat_bubble_outline, Icons.chat_bubble_rounded),
    _Destination('Wasifu', Icons.person_outline_rounded, Icons.person_rounded),
  ];

  List<Map<String, dynamic>> _active = [];
  List<Map<String, dynamic>> _recent = [];
  int _pending = 0;
  int _failed = 0;
  int _retryableFailed = 0;
  int _selectedIndex = 0;
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
        // Keep the most recent advice available when the patient loses signal.
        if (ownerId != null) await _cacheNotes(ownerId);
      } catch (_) {
        // Wi-Fi can be available while the API is not. Treat that as offline.
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
        final consultation = raw as Map<String, dynamic>;
        try {
          final note =
              await Api.get('/consultations/${consultation['id']}/note');
          rows.add({
            'id': consultation['id'] as String,
            'diagnosis_text': note['diagnosis_text'],
            'advice_text': note['advice_text'],
            'red_flags': (note['red_flags_discussed'] as List?)?.join('\n'),
            'created_at':
                note['signed_at'] as String? ?? consultation['created_at'],
          });
        } on ApiException {
          complete = false;
        }
      }
      if (complete) await Db.cacheNotes(ownerId, rows);
    } catch (_) {
      // Refreshing the offline cache is best effort and must not block home.
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

  void _select(int index) => setState(() => _selectedIndex = index);

  @override
  Widget build(BuildContext context) {
    final expanded = MediaQuery.sizeOf(context).width >= 840;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _name == null || _name!.trim().isEmpty ? S.appName : 'Habari, $_name',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          TextButton.icon(
            onPressed: _signOut,
            icon: const Icon(Icons.logout_rounded, size: 19),
            label: const Text(S.signOut),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: expanded
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: _selectedIndex,
                  onDestinationSelected: _select,
                  labelType: NavigationRailLabelType.all,
                  groupAlignment: -.78,
                  destinations: [
                    for (final destination in _destinations)
                      NavigationRailDestination(
                        icon: Icon(destination.icon),
                        selectedIcon: Icon(destination.selectedIcon),
                        label: Text(destination.label),
                      ),
                  ],
                ),
                const VerticalDivider(width: 1, thickness: 1),
                Expanded(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 1040),
                      child: _selectedPage(),
                    ),
                  ),
                ),
              ],
            )
          : _selectedPage(),
      bottomNavigationBar: expanded
          ? null
          : NavigationBar(
              selectedIndex: _selectedIndex,
              onDestinationSelected: _select,
              destinations: [
                for (final destination in _destinations)
                  NavigationDestination(
                    icon: Icon(destination.icon),
                    selectedIcon: Icon(destination.selectedIcon),
                    label: destination.label,
                  ),
              ],
            ),
    );
  }

  Widget _selectedPage() {
    final page = switch (_selectedIndex) {
      1 => _servicesPage(),
      2 => _recordsPage(),
      3 => _messagesPage(),
      4 => _profilePage(),
      _ => _homePage(),
    };
    return RefreshIndicator(
      onRefresh: _load,
      child: page,
    );
  }

  Widget _listPage(List<Widget> children) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
        children: children,
      );

  List<Widget> _syncNotices() => [
        if (!_online) ...[
          const Notice(
            'Hakuna mtandao. Unaweza kusoma dawa na ushauri uliohifadhiwa; mabadiliko salama yakihifadhiwa yataonyesha Pending sync hadi seva ithibitishe.',
            tone: NoticeTone.attention,
          ),
          const SizedBox(height: 12),
        ],
        if (_pending > 0) ...[
          Notice(
            'Pending sync: majibu $_pending bado hayajathibitishwa na seva.',
            tone: NoticeTone.attention,
          ),
          const SizedBox(height: 12),
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
          const SizedBox(height: 12),
        ],
      ];

  Widget _homePage() => _listPage([
        ..._syncNotices(),
        PremiumAuroraHero(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Huduma za afya, karibu nawe',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: Colors.white,
                      fontSize: 27,
                    ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Angalia foleni na daktari aliyepo kabla ya kwenda.',
                style:
                    TextStyle(color: Colors.white, fontSize: 16, height: 1.45),
              ),
              const SizedBox(height: 20),
              PremiumHeroButton(
                label: 'Tafuta daktari au kituo',
                onPressed: () => _go(const FacilityBrowserScreen()),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        LayoutBuilder(
          builder: (context, constraints) {
            final emergency = PremiumAction(
              icon: Icons.warning_amber_rounded,
              title: S.emergency,
              subtitle: 'Fungua huduma ya dharura',
              iconColor: AppPalette.of(context).clay,
              iconBackground: AppPalette.of(context).urgentWash,
              onTap: () => _go(const EmergencyScreen()),
            );
            final newConsultation = PremiumAction(
              icon: Icons.medical_services_outlined,
              title: S.homeGetHelp,
              subtitle: 'Anzisha ombi jipya',
              onTap: () => _go(const NewConsultationScreen()),
            );
            if (constraints.maxWidth < 540) {
              return Column(
                children: [
                  emergency,
                  const SizedBox(height: 12),
                  newConsultation
                ],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: emergency),
                const SizedBox(width: 12),
                Expanded(child: newConsultation),
              ],
            );
          },
        ),
        const SizedBox(height: 20),
        const PremiumSectionHeading('Matibabu yanayoendelea'),
        _consultationsSummary(_active, active: true),
        if (_recent.isNotEmpty) ...[
          const PremiumSectionHeading('Matibabu ya hivi karibuni'),
          ..._recent.take(3).map(_consultationCard),
          PremiumLinkRow(
            icon: Icons.history_rounded,
            title: 'Angalia rekodi zote',
            onTap: () => _select(2),
          ),
        ],
        const SizedBox(height: 12),
        const PremiumSectionHeading('Huduma zako'),
        PremiumLinkRow(
          icon: Icons.calendar_month_outlined,
          title: 'Miadi',
          onTap: () => _go(const AppointmentsScreen()),
        ),
        PremiumLinkRow(
          icon: Icons.medication_outlined,
          title: S.medications,
          onTap: () => _go(const PatientCareMedicinesScreen()),
        ),
        PremiumLinkRow(
          icon: Icons.chat_bubble_outline_rounded,
          title: 'Mazungumzo kuhusu ziara',
          onTap: () => _select(3),
        ),
      ]);

  Widget _consultationsSummary(
    List<Map<String, dynamic>> consultations, {
    required bool active,
  }) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (consultations.isEmpty) {
      if (!_online) {
        return const Empty('Hali ya ziara haiwezi kuthibitishwa bila mtandao.');
      }
      return Empty(active ? S.homeNothing : 'Hakuna ziara za hivi karibuni.');
    }
    return Column(
      children:
          consultations.take(active ? 5 : 10).map(_consultationCard).toList(),
    );
  }

  Widget _consultationCard(Map<String, dynamic> consultation) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: PremiumCard(
          onTap: () =>
              _go(ConsultationDetailScreen(consultation: consultation)),
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.medical_information_outlined,
                  color: AppPalette.of(context).petrol),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (consultation['symptom_text'] as String?) ??
                          'Ombi la matibabu',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    const SizedBox(height: 4),
                    PremiumStatus(
                      consultationStatusLabel(
                        consultation['status'] as String? ?? 'pending',
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: AppPalette.of(context).inkSoft),
            ],
          ),
        ),
      );

  Widget _servicesPage() => _listPage([
        ..._syncNotices(),
        Text('Huduma zote', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 6),
        Text(
          'Chagua huduma unayotaka kutumia.',
          style: TextStyle(color: AppPalette.of(context).inkSoft, fontSize: 16),
        ),
        const PremiumSectionHeading('Anza au tafuta huduma'),
        _link(Icons.search_rounded, 'Tafuta daktari au kituo',
            const FacilityBrowserScreen()),
        _link(Icons.medical_services_outlined, S.homeGetHelp,
            const NewConsultationScreen()),
        _link(Icons.warning_amber_rounded, S.emergency, const EmergencyScreen(),
            iconColor: AppPalette.of(context).clay),
        _link(Icons.auto_awesome_outlined, 'Msaidizi wa A-Health',
            const AssistantScreen()),
        const PremiumSectionHeading('Matibabu na ufuatiliaji'),
        _link(
            Icons.calendar_month_outlined, 'Miadi', const AppointmentsScreen()),
        _link(Icons.local_hospital_outlined, 'Huduma hospitalini',
            const FrontDeskScreen()),
        _link(Icons.notifications_active_outlined, 'Ufuatiliaji wangu',
            const CareContinuityScreen()),
        _link(Icons.alt_route_rounded, 'Rufaa Zangu', const ReferralsScreen()),
        _link(Icons.biotech_outlined, 'Vipimo na majibu',
            const DiagnosticsScreen()),
        _link(Icons.medication_outlined, S.medications,
            const PatientCareMedicinesScreen()),
        _link(Icons.checklist_rtl_outlined, S.checkIns, const CheckInsScreen()),
        _link(Icons.favorite_outline_rounded, S.screening,
            const ScreeningScreen()),
        _link(Icons.vaccines_outlined, S.vaccinations,
            const VaccinationsScreen()),
        const PremiumSectionHeading('Familia na taarifa'),
        _link(Icons.family_restroom_rounded, 'Familia na wategemezi',
            const FamilyScreen()),
        _link(
            Icons.menu_book_outlined, 'Elimu ya afya', const EducationScreen()),
        _link(Icons.history_rounded, 'Historia Yangu ya Afya',
            const HealthHistoryScreen()),
        _link(Icons.privacy_tip_outlined, 'Faragha na ruhusa',
            const PrivacyConsentScreen()),
        _link(Icons.feedback_outlined, 'Maoni na malalamiko',
            const FeedbackScreen()),
        _link(Icons.account_balance_wallet_outlined, 'Bima na malipo',
            const InsurancePaymentsScreen()),
        _link(Icons.person_outline_rounded, S.profile, const ProfileScreen()),
      ]);

  Widget _recordsPage() => _listPage([
        ..._syncNotices(),
        Text('Rekodi za afya',
            style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        _link(Icons.history_rounded, 'Historia Yangu ya Afya',
            const HealthHistoryScreen()),
        _link(Icons.medication_outlined, S.medications,
            const PatientCareMedicinesScreen()),
        _link(Icons.biotech_outlined, 'Vipimo na majibu',
            const DiagnosticsScreen()),
        const PremiumSectionHeading('Matibabu yanayoendelea'),
        _consultationsSummary(_active, active: true),
        if (_recent.isNotEmpty) ...[
          const PremiumSectionHeading('Matibabu ya hivi karibuni'),
          ..._recent.take(10).map(_consultationCard),
        ],
      ]);

  Widget _messagesPage() => _listPage([
        ..._syncNotices(),
        Text('Mazungumzo', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(
          'Mazungumzo yanafungamana na ziara ya matibabu. Chagua ziara ili kufungua mawasiliano yake.',
          style: TextStyle(color: AppPalette.of(context).inkSoft, fontSize: 16),
        ),
        const PremiumSectionHeading('Ziara zako'),
        _consultationsSummary(_active, active: true),
        ..._recent.take(10).map(_consultationCard),
      ]);

  Widget _profilePage() => _listPage([
        ..._syncNotices(),
        Text('Wasifu na mipangilio',
            style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        if (_name != null && _name!.trim().isNotEmpty) ...[
          PremiumCard(
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: AppPalette.of(context).mintWash,
                  foregroundColor: AppPalette.of(context).petrol,
                  child: const Icon(Icons.person_outline_rounded),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(_name!,
                      style: Theme.of(context).textTheme.titleMedium),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],
        _link(Icons.person_outline_rounded, S.profile, const ProfileScreen()),
        _link(Icons.privacy_tip_outlined, 'Faragha na ruhusa',
            const PrivacyConsentScreen()),
        _link(Icons.feedback_outlined, 'Maoni na malalamiko',
            const FeedbackScreen()),
        _link(Icons.account_balance_wallet_outlined, 'Bima na malipo',
            const InsurancePaymentsScreen()),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _signOut,
          icon: const Icon(Icons.logout_rounded),
          label: const Text(S.signOut),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(52),
            foregroundColor: AppPalette.of(context).petrol,
            side: BorderSide(color: AppPalette.of(context).line),
          ),
        ),
      ]);

  Widget _link(
    IconData icon,
    String label,
    Widget screen, {
    Color? iconColor,
  }) =>
      PremiumLinkRow(
        icon: icon,
        title: label,
        iconColor: iconColor,
        onTap: () => _go(screen),
      );
}

class _Destination {
  const _Destination(this.label, this.icon, this.selectedIcon);
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}
