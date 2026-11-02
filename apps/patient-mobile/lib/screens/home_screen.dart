import '../core/l10n.dart';
import 'patient_community_screen.dart';
import 'feedback_tracking_screen.dart';
import 'pharmacy_map_screen.dart';
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
import '../widgets/consultation_call_action.dart';
import '../widgets/premium.dart';
import 'appointments_screen.dart';
import 'assistant_screen.dart';
import 'care_continuity_screen.dart';
import 'checkins_screen.dart';
import 'consultation_detail_screen.dart';
import 'consultation_call_screen.dart';
import 'diagnostics_screen.dart';
import 'education_screen.dart';
import 'emergency_screen.dart';
import 'facility_browser_screen.dart';
import 'family_screen.dart';
import 'feedback_screen.dart';
import 'front_desk_screen.dart';
import 'health_history_screen.dart';
import 'insurance_payments_screen.dart';
import 'payment_bills_screen.dart';
import 'login_screen.dart';
import 'new_consultation_screen.dart';
import 'privacy_consent_screen.dart';
import 'profile_screen.dart';
import 'messages_screen.dart';
import 'medication_followup_screen.dart';
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
    Localizations.localeOf(context);
    final expanded = MediaQuery.sizeOf(context).width >= 840;
    return Scaffold(
      appBar: _selectedIndex == 4 || _selectedIndex == 3
          ? null
          : AppBar(
              title: Text(
                _name == null || _name!.trim().isEmpty
                    ? S.appName
                    : L.tr("Habari, {0}", [_name]),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              actions: [
                TextButton.icon(
                  onPressed: _signOut,
                  icon: const Icon(Icons.logout_rounded, size: 19),
                  label: Text(S.signOut),
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
                        label: Text(L.tr(destination.label)),
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
                    label: L.tr(destination.label),
                  ),
              ],
            ),
    );
  }

  Widget _selectedPage() {
    if (_selectedIndex == 3) return const MessagesScreen();
    if (_selectedIndex == 4) return const ProfileScreen();
    final page = switch (_selectedIndex) {
      1 => _servicesPage(),
      2 => _recordsPage(),
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
          Notice(
            L.tr(
                'Hakuna mtandao. Unaweza kusoma dawa na ushauri uliohifadhiwa; mabadiliko salama yakihifadhiwa yataonyesha Pending sync hadi seva ithibitishe.'),
            tone: NoticeTone.attention,
          ),
          const SizedBox(height: 12),
        ],
        if (_pending > 0) ...[
          Notice(
            L.tr("Pending sync: majibu {0} bado hayajathibitishwa na seva.",
                [_pending]),
            tone: NoticeTone.attention,
          ),
          const SizedBox(height: 12),
        ],
        if (_failed > 0) ...[
          Notice(
            L.tr(
                "{0} mabadiliko yanahitaji kuangaliwa mtandaoni. Hayatajaribiwa tena kiotomatiki.",
                [_failed]),
            tone: NoticeTone.attention,
          ),
          if (_retryableFailed > 0)
            OutlinedButton.icon(
              onPressed: _online ? _retrySync : null,
              icon: const Icon(Icons.sync),
              label: Text(
                  L.tr("Jaribu tena usawazishaji ({0})", [_retryableFailed])),
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
                L.tr('Huduma za afya, karibu nawe'),
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: Colors.white,
                      fontSize: 27,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                L.tr('Angalia foleni na daktari aliyepo kabla ya kwenda.'),
                style:
                    TextStyle(color: Colors.white, fontSize: 16, height: 1.45),
              ),
              const SizedBox(height: 20),
              PremiumHeroButton(
                label: L.tr('Tafuta daktari au kituo'),
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
              subtitle: L.tr('Fungua huduma ya dharura'),
              iconColor: AppPalette.of(context).clay,
              iconBackground: AppPalette.of(context).urgentWash,
              onTap: () => _go(const EmergencyScreen()),
            );
            final newConsultation = PremiumAction(
              icon: Icons.medical_services_outlined,
              title: S.homeGetHelp,
              subtitle: L.tr('Anzisha ombi jipya'),
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
        PremiumSectionHeading(L.tr('Matibabu yanayoendelea')),
        _consultationsSummary(_active, active: true),
        if (_recent.isNotEmpty) ...[
          PremiumSectionHeading(L.tr('Matibabu ya hivi karibuni')),
          ..._recent.take(3).map(_consultationCard),
          PremiumLinkRow(
            icon: Icons.history_rounded,
            title: L.tr('Angalia rekodi zote'),
            onTap: () => _select(2),
          ),
        ],
        const SizedBox(height: 12),
        PremiumSectionHeading(L.tr('Huduma zako')),
        PremiumLinkRow(
          icon: Icons.calendar_month_outlined,
          title: L.tr('Miadi'),
          onTap: () => _go(const AppointmentsScreen()),
        ),
        PremiumLinkRow(
          icon: Icons.medication_outlined,
          title: S.medications,
          onTap: () => _go(const MedicationFollowupScreen()),
        ),
        PremiumLinkRow(
          icon: Icons.chat_bubble_outline_rounded,
          title: L.tr('Mazungumzo kuhusu ziara'),
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
        return Empty(L.tr('Hali ya ziara haiwezi kuthibitishwa bila mtandao.'));
      }
      return Empty(
          active ? S.homeNothing : L.tr('Hakuna ziara za hivi karibuni.'));
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
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(
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
                            L.tr('Ombi la matibabu'),
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
                Icon(Icons.chevron_right_rounded,
                    color: AppPalette.of(context).inkSoft),
              ],
            ),
            ConsultationCallAction(
                consultation: consultation,
                onJoin: () => _go(ConsultationCallScreen(
                    consultationId: consultation['id'] as String,
                    video: consultation['modality'] == 'video'))),
          ]),
        ),
      );

  Widget _servicesPage() => _listPage([
        _link(Icons.groups_outlined, L.tr('Community ya afya'),
            const PatientCommunityScreen()),
        _link(Icons.map_outlined, L.tr('Pharmacy karibu nami'),
            const PharmacyMapScreen()),
        ..._syncNotices(),
        Text(L.tr('Huduma zote'),
            style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 6),
        Text(
          L.tr('Chagua huduma unayotaka kutumia.'),
          style: TextStyle(color: AppPalette.of(context).inkSoft, fontSize: 16),
        ),
        PremiumSectionHeading(L.tr('Anza au tafuta huduma')),
        _link(Icons.search_rounded, L.tr('Tafuta daktari au kituo'),
            const FacilityBrowserScreen()),
        _link(Icons.medical_services_outlined, S.homeGetHelp,
            const NewConsultationScreen()),
        _link(Icons.warning_amber_rounded, S.emergency, const EmergencyScreen(),
            iconColor: AppPalette.of(context).clay),
        _link(Icons.auto_awesome_outlined, L.tr('Msaidizi wa A-Health'),
            const AssistantScreen()),
        PremiumSectionHeading(L.tr('Matibabu na ufuatiliaji')),
        _link(Icons.calendar_month_outlined, L.tr('Miadi'),
            const AppointmentsScreen()),
        _link(Icons.local_hospital_outlined, L.tr('Huduma hospitalini'),
            const FrontDeskScreen()),
        _link(Icons.notifications_active_outlined, L.tr('Ufuatiliaji wangu'),
            const CareContinuityScreen()),
        _link(Icons.alt_route_rounded, L.tr('Rufaa Zangu'),
            const ReferralsScreen()),
        _link(Icons.biotech_outlined, L.tr('Vipimo na majibu'),
            const DiagnosticsScreen()),
        _link(Icons.medication_outlined, S.medications,
            const MedicationFollowupScreen()),
        _link(Icons.checklist_rtl_outlined, S.checkIns, const CheckInsScreen()),
        _link(Icons.favorite_outline_rounded, S.screening,
            const ScreeningScreen()),
        _link(Icons.vaccines_outlined, S.vaccinations,
            const VaccinationsScreen()),
        PremiumSectionHeading(L.tr('Familia na taarifa')),
        _link(Icons.family_restroom_rounded, L.tr('Familia na wategemezi'),
            const FamilyScreen()),
        _link(Icons.menu_book_outlined, L.tr('Elimu ya afya'),
            const EducationScreen()),
        _link(Icons.history_rounded, L.tr('Historia Yangu ya Afya'),
            const HealthHistoryScreen()),
        _link(Icons.privacy_tip_outlined, L.tr('Faragha na ruhusa'),
            const PrivacyConsentScreen()),
        _link(Icons.feedback_outlined, L.tr('Maoni na malalamiko'),
            const FeedbackScreen()),
        _link(Icons.track_changes, L.tr('Fuatilia feedback'),
            const FeedbackTrackingScreen()),
        _link(Icons.account_balance_wallet_outlined, L.tr('Bima na malipo'),
            const InsurancePaymentsScreen()),
        _link(Icons.receipt_long_outlined, L.tr('Bili na risiti'),
            const PaymentBillsScreen()),
        _link(Icons.person_outline_rounded, S.profile, const ProfileScreen()),
      ]);

  Widget _recordsPage() => _listPage([
        ..._syncNotices(),
        Text(L.tr('Rekodi za afya'),
            style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        _link(Icons.history_rounded, L.tr('Historia Yangu ya Afya'),
            const HealthHistoryScreen()),
        _link(Icons.medication_outlined, S.medications,
            const MedicationFollowupScreen()),
        _link(Icons.biotech_outlined, L.tr('Vipimo na majibu'),
            const DiagnosticsScreen()),
        PremiumSectionHeading(L.tr('Matibabu yanayoendelea')),
        _consultationsSummary(_active, active: true),
        if (_recent.isNotEmpty) ...[
          PremiumSectionHeading(L.tr('Matibabu ya hivi karibuni')),
          ..._recent.take(10).map(_consultationCard),
        ],
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
