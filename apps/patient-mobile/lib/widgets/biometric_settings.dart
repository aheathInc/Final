import '../core/l10n.dart';
import 'package:flutter/material.dart';
import '../core/biometrics.dart';
import '../core/session.dart';
import 'common.dart';

class BiometricSettings extends StatefulWidget {
  const BiometricSettings({super.key});
  @override
  State<BiometricSettings> createState() => _BiometricSettingsState();
}

class _BiometricSettingsState extends State<BiometricSettings>
    with WidgetsBindingObserver {
  bool _available = false, _loading = true, _busy = false;
  String? _message;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final value = await Biometrics.available();
    if (mounted) {
      setState(() {
        _available = value;
        _loading = false;
      });
    }
  }

  Future<void> _enable() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    final ok = await Biometrics.unlock();
    if (ok) await Session.setBiometric(true);
    if (mounted) {
      setState(() {
        _busy = false;
        _message = ok
            ? L.tr(
                'Biometrics zimewashwa. Utafungua app bila kuandika namba ya simu.')
            : L.tr('Haijathibitishwa. Jaribu tena au tumia password.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(L.tr('Face / Fingerprint'),
          style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 8),
      Text(Session.biometricEnabled
          ? L.tr('Biometrics zimewashwa kwenye simu hii.')
          : L.tr(
              'Fungua account yako kwa biometrics bila kuandika namba ya simu kila mara.')),
      const SizedBox(height: 8),
      Text(L.tr(
          'App hutumia biometrics za simu. Picha ya uso na alama ya kidole hazitumwi A-Health. Usiwashe kwenye simu inayotumiwa na watu wengine.')),
      if (_message != null)
        Padding(
            padding: const EdgeInsets.only(top: 12), child: Notice(_message!)),
      const SizedBox(height: 12),
      if (_loading)
        const LinearProgressIndicator()
      else if (_available && !Session.biometricEnabled)
        FilledButton.icon(
            onPressed: _busy ? null : _enable,
            icon: const Icon(Icons.fingerprint),
            label: Text(
                _busy ? 'Inathibitisha...' : L.tr('Washa Face / Fingerprint')))
      else if (!_available) ...[
        Text(L.tr(
            'Kamilisha usajili wa Face/Fingerprint kwenye Settings za simu, kisha urudi kuwasha hapa.')),
        OutlinedButton.icon(
            onPressed: _busy
                ? null
                : () async {
                    final opened = await Biometrics.openSettings();
                    if (!opened && mounted) {
                      setState(() => _message = L.tr(
                          'Fungua Settings za simu > Security / Biometrics kusajili uso au kidole.'));
                    }
                  },
            icon: const Icon(Icons.settings_outlined),
            label: Text(L.tr('Sanidi biometrics kwenye simu'))),
        TextButton(
            onPressed: _refresh, child: Text(L.tr('Kagua biometrics tena'))),
      ],
      if (Session.biometricEnabled)
        OutlinedButton(
            onPressed: _busy
                ? null
                : () async {
                    await Session.setBiometric(false);
                    if (mounted) setState(() => _message = null);
                  },
            child: Text(L.tr('Zima Face / Fingerprint'))),
    ]);
  }
}
