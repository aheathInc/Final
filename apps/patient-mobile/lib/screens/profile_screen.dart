import '../core/l10n.dart';
import 'package:flutter/material.dart';
import '../core/profile_repository.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/profile_card.dart';
import 'family_screen.dart';
import 'feedback_tracking_screen.dart';
import 'health_history_screen.dart';
import 'insurance_payments_screen.dart';
import 'login_screen.dart';
import 'payment_bills_screen.dart';
import 'privacy_consent_screen.dart';
import 'profile_editor_screen.dart';
import 'saved_advice_screen.dart';
import 'security_screen.dart';
import 'app_settings_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, this.repository});
  final PatientProfileRepository? repository;
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _defaultRepository = PatientProfileRepository();
  PatientProfileRepository get _repository =>
      widget.repository ?? _defaultRepository;
  Map<String, dynamic>? _account, _profile;
  List<Map<String, dynamic>>? _dependents;
  List<Map<String, Object?>> _notes = [];
  DateTime? _notesSynced;
  String? _message;
  bool _loading = true,
      _online = false,
      _notesAvailable = true,
      _signingOut = false;
  int _generation = 0, _identity = 0;
  @override
  void initState() {
    super.initState();
    Session.identityChanges.addListener(_identityChanged);
    _load();
  }

  @override
  void dispose() {
    _generation++;
    Session.identityChanges.removeListener(_identityChanged);
    super.dispose();
  }

  void _identityChanged() {
    _generation++;
    if (mounted) {
      setState(() {
        _account = null;
        _profile = null;
        _dependents = null;
        _notes = [];
        _message = null;
        _loading = true;
      });
    }
    _load();
  }

  bool _current(int generation, int identity) =>
      mounted &&
      generation == _generation &&
      identity == Session.identityChanges.value;
  Future<void> _load() async {
    final generation = ++_generation, identity = Session.identityChanges.value;
    if (mounted) {
      setState(() {
        _loading = true;
        _message = null;
      });
    }
    final owner = await Session.userId();
    if (!_current(generation, identity)) return;
    if (owner == null) {
      setState(() {
        _loading = false;
        _account = null;
        _profile = null;
        _dependents = null;
        _notes = [];
        _message = L.tr('Ingia kwenye account yako ili kuona wasifu.');
      });
      return;
    }
    Map<String, dynamic>? account = await Session.user(), profile;
    List<Map<String, dynamic>>? dependents;
    List<Map<String, Object?>> notes = [];
    DateTime? synced;
    bool online = false, notesAvailable = true;
    String? message;
    try {
      notes = await _repository.notes(owner);
      synced = await _repository.notesSyncedAt(owner);
    } catch (_) {
      notesAvailable = false;
    }
    try {
      online = await _repository.online();
      if (online) {
        final records =
            await Future.wait([_repository.account(), _repository.profile()]);
        account = records[0];
        profile = records[1];
        try {
          dependents = await _repository.dependents();
        } catch (_) {/* Unknown is not zero. */}
      } else {
        message = L.tr(
            'Uko offline. Kuona na kuhariri taarifa za sasa kunahitaji intaneti; ushauri uliohifadhiwa unapatikana.');
      }
    } catch (_) {
      online = false;
      message = L.tr(
          'Taarifa za sasa hazijapatikana. Jaribu tena; ushauri uliohifadhiwa unaweza kusomwa.');
    }
    if (!_current(generation, identity)) return;
    setState(() {
      _account = account;
      _profile = profile;
      _dependents = dependents;
      _notes = notes;
      _notesSynced = synced;
      _notesAvailable = notesAvailable;
      _online = online;
      _message = message;
      _identity = identity;
      _loading = false;
    });
  }

  bool get _canEdit => _online && _account != null && _profile != null;
  void _open(Widget page) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  Future<void> _edit({bool medical = false}) async {
    if (!_canEdit) return;
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => ProfileEditorScreen(
            account: _account!,
            profile: _profile!,
            repository: _repository,
            medical: medical)));
    if (changed == true && mounted) {
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(L.tr('Mabadiliko yamehifadhiwa.'))));
      }
    }
  }

  Future<void> _signOut() async {
    setState(() => _signingOut = true);
    try {
      await _repository.signOut();
    } catch (_) {/* Local sign-out still succeeds without a network. */}
    await Session.clear();
    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
    }
  }

  String? get _ageAndSex {
    final date = DateTime.tryParse(_profile?['date_of_birth'] as String? ?? '');
    final now = DateTime.now();
    final years = date == null
        ? null
        : now.year -
            date.year -
            (now.month < date.month ||
                    (now.month == date.month && now.day < date.day)
                ? 1
                : 0);
    final sex = {
      'female': L.tr('Mwanamke'),
      'male': L.tr('Mwanaume'),
      'other': L.tr('Nyingine')
    }[_profile?['sex']];
    final values = [
      if (years != null && years >= 0) L.tr("Miaka {0}", [years]),
      if (sex != null) sex
    ];
    return values.isEmpty ? null : values.join(' · ');
  }

  Widget _identityCard() {
    final name = (_account?['full_name'] as String? ?? '').trim();
    final parts =
        name.split(RegExp(r'\s+')).where((s) => s.isNotEmpty).toList();
    final initials = parts.isEmpty
        ? ''
        : [parts.first, if (parts.length > 1) parts.last]
            .map((part) => part.characters.first)
            .join()
            .toUpperCase();
    final phone = _account?['phone_number'] as String?;
    final residence = _profile?['residence'] as String?;
    return ProfileCard(
        emphasis: true,
        padding: const EdgeInsets.all(22),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            CircleAvatar(
                radius: 30,
                backgroundColor: Colors.white.withValues(alpha: .14),
                child: initials.isEmpty
                    ? const Icon(Icons.person_outline_rounded,
                        color: Colors.white, size: 30)
                    : Text(initials,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 22,
                            fontWeight: FontWeight.w700))),
            const SizedBox(width: 16),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(name.isEmpty ? L.tr('Account yako') : name,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          height: 1.25,
                          fontWeight: FontWeight.w700)),
                  if (phone != null && phone.isNotEmpty) ...[
                    const SizedBox(height: 7),
                    Text(phone,
                        style:
                            const TextStyle(color: Colors.white, fontSize: 15))
                  ],
                  if (_ageAndSex != null) ...[
                    const SizedBox(height: 7),
                    Text(_ageAndSex!,
                        style:
                            const TextStyle(color: Colors.white, fontSize: 14))
                  ],
                ])),
          ]),
          if (residence != null && residence.isNotEmpty) ...[
            const SizedBox(height: 16),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.location_on_outlined,
                  color: Colors.white, size: 18),
              const SizedBox(width: 7),
              Expanded(
                  child: Text(residence,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style:
                          const TextStyle(color: Colors.white, fontSize: 14)))
            ])
          ],
          const SizedBox(height: 18),
          OutlinedButton.icon(
              onPressed: _canEdit ? () => _edit() : null,
              icon: const Icon(Icons.edit_outlined, size: 18),
              label: Text(L.tr('Hariri taarifa')),
              style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  disabledForegroundColor: Colors.white.withValues(alpha: .55),
                  side: BorderSide(color: Colors.white.withValues(alpha: .5)),
                  minimumSize: const Size.fromHeight(48))),
        ]));
  }

  Widget _action(
      {required IconData icon,
      required String title,
      required String subtitle,
      required VoidCallback? onTap}) {
    final p = AppPalette.of(context);
    return Semantics(
        button: true,
        enabled: onTap != null,
        child: ProfileCard(
            onTap: onTap,
            padding: const EdgeInsets.all(18),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(icon, color: p.petrol, size: 28),
                const Spacer(),
                Icon(Icons.arrow_forward_rounded, color: p.petrol, size: 20)
              ]),
              const SizedBox(height: 16),
              Text(L.tr(title),
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Text(subtitle,
                  style:
                      TextStyle(color: p.inkSoft, fontSize: 14, height: 1.4)),
            ])));
  }

  Widget _quickActions() => LayoutBuilder(builder: (context, constraints) {
        final medical = _action(
            icon: Icons.medical_information_outlined,
            title: L.tr('Taarifa za afya'),
            subtitle: _canEdit
                ? L.tr('Mizio na namba ya dharura')
                : L.tr('Unganisha intaneti kuhariri'),
            onTap: _canEdit ? () => _edit(medical: true) : null);
        final bills = _action(
            icon: Icons.receipt_long_outlined,
            title: L.tr('Bili na risiti'),
            subtitle: L.tr('Malipo na risiti zako'),
            onTap: () => _open(const PaymentBillsScreen()));
        if (constraints.maxWidth < 350 ||
            MediaQuery.textScalerOf(context).scale(1) > 1.15) {
          return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [medical, const SizedBox(height: 14), bills]);
        }
        return IntrinsicHeight(
            child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
              Expanded(child: medical),
              const SizedBox(width: 14),
              Expanded(child: bills)
            ]));
      });
  Widget _row(
      IconData icon, String title, String subtitle, VoidCallback onTap) {
    final p = AppPalette.of(context);
    return ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
        leading: Icon(icon, color: p.petrol),
        title: Text(L.tr(title),
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
        subtitle: Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Text(subtitle,
                style: TextStyle(color: p.inkSoft, fontSize: 14))),
        trailing: Icon(Icons.chevron_right_rounded, color: p.inkSoft),
        onTap: onTap);
  }

  Widget _section(String title, List<Widget> rows) =>
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SizedBox(height: 28),
        Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(L.tr(title),
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.w700))),
        ProfileCard(
            padding: EdgeInsets.zero,
            child: Column(children: [
              for (var i = 0; i < rows.length; i++) ...[
                if (i > 0)
                  Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 18),
                      child: Divider(
                          height: 1, color: AppPalette.of(context).line)),
                rows[i]
              ]
            ])),
      ]);
  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(S.profile), actions: [
        IconButton(
            tooltip: L.tr('Pakia wasifu upya'),
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded))
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                  children: [
                    Center(
                        child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 720),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  if (_message != null) ...[
                                    Notice(_message!,
                                        tone: NoticeTone.attention),
                                    const SizedBox(height: 16),
                                    if (!_online)
                                      Align(
                                          alignment: Alignment.centerLeft,
                                          child: TextButton.icon(
                                              onPressed: _load,
                                              icon: const Icon(
                                                  Icons.refresh_rounded),
                                              label: Text(L.tr('Jaribu tena'))))
                                  ],
                                  _identityCard(),
                                  const SizedBox(height: 18),
                                  _quickActions(),
                                  _section(L.tr('Account na usalama'), [
                                    _row(
                                        Icons.language_rounded,
                                        L.tr('Lugha na mwonekano'),
                                        L.tr(
                                            'Kiswahili, English, Français · Light / Dark'),
                                        () => _open(const AppSettingsScreen())),
                                    _row(
                                        Icons.fingerprint_rounded,
                                        L.tr('Usalama wa account'),
                                        L.tr('Password, Face / Fingerprint'),
                                        () => _open(const SecurityScreen())),
                                    _row(
                                        Icons.privacy_tip_outlined,
                                        L.tr('Faragha na ruhusa'),
                                        L.tr(
                                            'Dhibiti ufikiaji wa taarifa zako'),
                                        () => _open(
                                            const PrivacyConsentScreen())),
                                    _row(
                                        Icons.health_and_safety_outlined,
                                        L.tr('Bima na malipo'),
                                        L.tr(
                                            'Taarifa za bima na malipo ya huduma'),
                                        () => _open(
                                            const InsurancePaymentsScreen())),
                                  ]),
                                  _section(L.tr('Afya na familia'), [
                                    _row(
                                        Icons.family_restroom_outlined,
                                        L.tr('Familia na wategemezi'),
                                        _dependents == null
                                            ? L.tr('Simamia watu unaowahudumia')
                                            : _dependents!.isEmpty
                                                ? L.tr(
                                                    'Ongeza na simamia wategemezi')
                                                : L.tr("Wategemezi {0}",
                                                    [_dependents!.length]),
                                        () => _open(const FamilyScreen())),
                                    _row(
                                        Icons.history_rounded,
                                        L.tr('Historia ya afya'),
                                        L.tr('Rekodi zako za huduma'),
                                        () =>
                                            _open(const HealthHistoryScreen())),
                                    _row(
                                        Icons.description_outlined,
                                        L.tr('Ushauri uliohifadhiwa'),
                                        _notesAvailable
                                            ? L.tr(
                                                'Nakala za ushauri kwenye simu')
                                            : L.tr(
                                                'Nakala hazijapatikana; jaribu tena'),
                                        () => _open(SavedAdviceScreen(
                                            notes: _notes,
                                            identity: _identity,
                                            syncedAt: _notesSynced,
                                            available: _notesAvailable))),
                                  ]),
                                  _section(L.tr('Msaada'), [
                                    _row(
                                        Icons.support_agent_rounded,
                                        L.tr('Maoni na msaada'),
                                        L.tr(
                                            'Tuma na fuatilia malalamiko au maoni'),
                                        () => _open(
                                            const FeedbackTrackingScreen()))
                                  ]),
                                  const SizedBox(height: 28),
                                  OutlinedButton.icon(
                                      onPressed: _signingOut ? null : _signOut,
                                      icon: const Icon(Icons.logout_rounded),
                                      label: Text(_signingOut
                                          ? 'Inatoka...'
                                          : L.tr('Ondoka kwenye account'))),
                                  const SizedBox(height: 18),
                                  Text('A-Health',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                          color: AppPalette.of(context).inkSoft,
                                          fontSize: 13)),
                                ]))),
                  ])),
    );
  }
}
