import '../core/l10n.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/biometrics.dart';
import '../widgets/common.dart';
import '../widgets/biometric_settings.dart';
import '../widgets/receipt_download.dart';
import 'home_screen.dart';
import 'login_screen.dart';
import '../main.dart' show navigatorKey;

class SecurityScreen extends StatefulWidget {
  const SecurityScreen({super.key, this.registration = false, this.receipt});
  final bool registration;
  final Map? receipt;
  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  final _password = TextEditingController(),
      _confirm = TextEditingController(),
      _current = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _busy = false, _visible = false, _saved = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    _current.dispose();
    super.dispose();
  }

  void _home() => Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomeScreen()), (_) => false);
  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (widget.registration) {
        final data = await Api.registration(
            'POST', '/auth/registration/complete', body: {
          'password': _password.text,
          'device_id': await Session.deviceId()
        });
        await Session.save(
            accessToken: data['access_token'],
            refreshToken: data['refresh_token'],
            user: Map<String, dynamic>.from(data['user']));
        if (mounted) setState(() => _saved = true);
      } else {
        await Api.post('/auth/password/set', {
          'new_password': _password.text,
          if (_current.text.isNotEmpty) 'current_password': _current.text
        });
        await Session.clear();
        if (mounted) {
          Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (_) => const LoginScreen()),
              (_) => false);
        }
      }
      _password.clear();
      _confirm.clear();
      _current.clear();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = L.tr(
            'Imeshindikana kuthibitisha. Jaribu tena; unaweza kutumia OTP ikiwa password ilihifadhiwa.'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(
          title: Text(L.tr('Usalama wa account')),
          automaticallyImplyLeading: !widget.registration),
      body: SafeArea(
          child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Center(
                  child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (!widget.registration) ...[
                        const BiometricSettings(),
                        const SizedBox(height: 28),
                      ],
                      Text(
                          _saved
                              ? L.tr('Account yako iko tayari')
                              : widget.registration
                                  ? L.tr('Weka password')
                                  : L.tr('Badilisha password'),
                          style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: 12),
                      if (widget.registration && !_saved) ...[
                        Text(
                            L.tr('Hatua 4 kati ya 4 · Malipo yamethibitishwa')),
                        if (widget.receipt != null)
                          Text(L.tr("Kumbukumbu: {0}",
                              [widget.receipt!['reference']])),
                        const SizedBox(height: 16),
                      ],
                      if (widget.registration &&
                          widget.receipt?['id'] is String) ...[
                        ReceiptDownload(
                            billId: widget.receipt!['id'] as String,
                            registration: !_saved),
                        const SizedBox(height: 16),
                      ],
                      if (_error != null) ...[
                        Notice(_error!),
                        const SizedBox(height: 16)
                      ],
                      if (!_saved)
                        Form(
                            key: _form,
                            child: AutofillGroup(
                                child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                  Text(L.tr(
                                      'Tumia angalau herufi 12. Unaweza kuchanganya maneno kadhaa unayokumbuka; usitumie namba yako ya simu.')),
                                  const SizedBox(height: 20),
                                  if (!widget.registration) ...[
                                    TextFormField(
                                        controller: _current,
                                        obscureText: !_visible,
                                        autofillHints: const [
                                          AutofillHints.password
                                        ],
                                        decoration: InputDecoration(
                                            labelText: L.tr('Password ya sasa'),
                                            helperText: L.tr(
                                                'Ukisahau, ingia kwa OTP kisha urudi hapa.'))),
                                    const SizedBox(height: 16),
                                  ],
                                  TextFormField(
                                      controller: _password,
                                      obscureText: !_visible,
                                      autofillHints: const [
                                        AutofillHints.newPassword
                                      ],
                                      autocorrect: false,
                                      enableSuggestions: false,
                                      decoration: InputDecoration(
                                          labelText: L.tr('Password mpya'),
                                          suffixIcon: IconButton(
                                              tooltip: _visible
                                                  ? L.tr('Ficha password')
                                                  : L.tr('Onyesha password'),
                                              onPressed: () => setState(
                                                  () => _visible = !_visible),
                                              icon: Icon(_visible
                                                  ? Icons.visibility_off
                                                  : Icons.visibility))),
                                      validator: (v) => (v ?? '').length < 12
                                          ? L.tr('Tumia angalau herufi 12.')
                                          : null),
                                  const SizedBox(height: 16),
                                  TextFormField(
                                      controller: _confirm,
                                      obscureText: !_visible,
                                      autocorrect: false,
                                      enableSuggestions: false,
                                      decoration: InputDecoration(
                                          labelText: L.tr('Rudia password')),
                                      validator: (v) => v != _password.text
                                          ? L.tr('Password hazifanani.')
                                          : null),
                                  const SizedBox(height: 24),
                                  FilledButton(
                                      onPressed: _busy ? null : _save,
                                      child: Text(_busy
                                          ? 'Inahifadhi...'
                                          : widget.registration
                                              ? L.tr('Hifadhi password')
                                              : L.tr('Hifadhi na ingia tena'))),
                                ]))),
                      if (widget.registration && !_saved)
                        TextButton(
                            onPressed: _busy
                                ? null
                                : () async {
                                    await Session.clearRegistration();
                                    if (context.mounted) {
                                      Navigator.of(context).pushAndRemoveUntil(
                                          MaterialPageRoute(
                                              builder: (_) =>
                                                  const LoginScreen()),
                                          (_) => false);
                                    }
                                  },
                            child: Text(L
                                .tr('Endelea baadaye / thibitisha simu tena'))),
                      if (_saved) ...[
                        const SizedBox(height: 28),
                        const BiometricSettings(),
                        const SizedBox(height: 16),
                        FilledButton(
                            onPressed: _busy ? null : _home,
                            child: Text(L.tr('Endelea kwenye account'))),
                      ],
                    ]),
              )))),
    );
  }
}

class BiometricLockScreen extends StatefulWidget {
  const BiometricLockScreen({super.key});
  @override
  State<BiometricLockScreen> createState() => _BiometricLockScreenState();
}

class _BiometricLockScreenState extends State<BiometricLockScreen> {
  bool _busy = false;
  String? _message;
  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
        body: SafeArea(
            child: Center(
                child: SingleChildScrollView(
                    padding: const EdgeInsets.all(24),
                    child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 420),
                        child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              const Icon(Icons.lock_outline, size: 48),
                              const SizedBox(height: 20),
                              Text(L.tr('Fungua A-Health'),
                                  style:
                                      Theme.of(context).textTheme.headlineSmall,
                                  textAlign: TextAlign.center),
                              const SizedBox(height: 16),
                              Text(L.tr(
                                  'Taarifa zako zimefichwa. Thibitisha kwa Face/Fingerprint ya simu hii.')),
                              const SizedBox(height: 20),
                              if (_message != null) Notice(_message!),
                              FilledButton(
                                  onPressed: _busy
                                      ? null
                                      : () async {
                                          setState(() => _busy = true);
                                          final ok = await Biometrics.unlock();
                                          if (mounted) {
                                            setState(() {
                                              _busy = false;
                                              if (!ok) {
                                                _message = L.tr(
                                                    'Haijathibitishwa. Jaribu tena au ingia kwa password / OTP.');
                                              }
                                            });
                                          }
                                        },
                                  child: Text(
                                      L.tr('Fungua kwa Face / Fingerprint'))),
                              const SizedBox(height: 12),
                              TextButton(
                                  onPressed: _busy
                                      ? null
                                      : () async {
                                          await Session.clear(
                                              preserveBiometricPreference:
                                                  true);
                                          navigatorKey.currentState
                                              ?.pushAndRemoveUntil(
                                                  MaterialPageRoute(
                                                      builder: (_) =>
                                                          const LoginScreen()),
                                                  (_) => false);
                                        },
                                  child: Text(L.tr('Tumia password / OTP'))),
                            ]))))));
  }
}
