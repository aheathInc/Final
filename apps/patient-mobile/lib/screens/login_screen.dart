import '../core/l10n.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../widgets/common.dart';
import '../widgets/login_shell.dart';
import 'verify_screen.dart';
import 'auth_destination.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen(
      {super.key, this.phoneSetup = false, this.registration = false});
  final bool phoneSetup;
  final bool registration;
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  static const _localTesterPhone = '+255749900006';
  final _controller = TextEditingController();
  final _password = TextEditingController();
  bool _passwordMode = false;
  bool _showPassword = false;
  String? _error;
  bool _busy = false;
  bool _loadingAccount = true;
  Map<String, dynamic>? _remembered;

  @override
  void initState() {
    super.initState();
    _restoreAccount();
  }

  Future<void> _restoreAccount() async {
    final account =
        widget.phoneSetup ? null : await Session.rememberedAccount();
    if (!mounted) return;
    setState(() {
      _remembered = account;
      _passwordMode = account != null;
      _controller.text = account?['phone_number'] as String? ?? '';
      _loadingAccount = false;
    });
  }

  void _openPhoneSetup({bool registration = false}) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => LoginScreen(phoneSetup: true, registration: registration),
    ));
  }

  @override
  void dispose() {
    _controller.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final e164 = toE164(_controller.text);
    if (e164 == null) {
      setState(() => _error = S.phoneInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      if (_passwordMode) {
        final data = await Api.post('/auth/patient/login', {
          'phone_number': e164,
          'password': _password.text,
          'device_id': await Session.deviceId()
        });
        final destination =
            await authenticationDestination(Map<String, dynamic>.from(data));
        _password.clear();
        if (mounted) {
          Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (_) => destination), (_) => false);
        }
        return;
      }
      final data = await Api.post(
          '/auth/otp/request', {'phone_number': e164, 'channel': 'sms'});
      if (!mounted) return;
      final echoedCode = data['dev_code'];
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => VerifyScreen(
          challengeId: data['challenge_id'] as String,
          maskedTo: (data['masked_destination'] as String?) ?? e164,
          phoneNumber: e164,
          simulated: data['delivery_status'] == 'simulated',
          developmentCode:
              kDebugMode && echoedCode is String ? echoedCode : null,
        ),
      ));
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = S.errorOffline);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _devLogin() async {
    setState(() => _busy = true);
    try {
      final data = await Api.post('/auth/otp/request',
          {'phone_number': _localTesterPhone, 'channel': 'sms'});
      final code = data['dev_code'];
      if (code is! String || !RegExp(r'^\d{6}$').hasMatch(code)) {
        if (mounted) {
          setState(() => _error = L.tr(
              'Local OTP echo haijawashwa. Tumia akaunti iliyosajiliwa na namba halisi ya OTP.'));
        }
        return;
      }
      final deviceId = await Session.deviceId();
      final session = await Api.post('/auth/otp/verify', {
        'challenge_id': data['challenge_id'],
        'code': code,
        'device_id': deviceId,
      });

      final destination =
          await authenticationDestination(Map<String, dynamic>.from(session));
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => destination),
        (_) => false,
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = S.errorOffline);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    if (_loadingAccount) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final needsLink = _remembered == null && !widget.phoneSetup;
    return LoginShell(
      title: widget.phoneSetup
          ? (widget.registration
              ? L.tr('Usajili wa account')
              : L.tr('Unganisha account kwenye simu'))
          : L.tr('Ingia'),
      showBack: widget.phoneSetup,
      footer: kDebugMode
          ? TextButton.icon(
              onPressed: _busy ? null : _devLogin,
              icon: const Icon(Icons.developer_mode_rounded, size: 18),
              label: Text(L.tr('Ingia kama tester wa ndani')),
            )
          : null,
      contentBuilder: (context) =>
          Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(
            needsLink
                ? L.tr('Karibu A-Health')
                : _remembered != null
                    ? L.tr('Karibu tena')
                    : widget.registration
                        ? L.tr('Fungua account yako')
                        : L.tr('Unganisha account yako'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 10),
        if (needsLink) ...[
          Text(
              L.tr(
                  'Unganisha account yako kwenye simu hii mara moja. Baadaye utaingia kwa password au biometrics.'),
              textAlign: TextAlign.center),
          const SizedBox(height: 28),
          FilledButton.icon(
              onPressed: () => _openPhoneSetup(),
              icon: const Icon(Icons.login_rounded, size: 20),
              label: Text(L.tr('Unganisha account yangu'))),
          const SizedBox(height: 10),
          TextButton(
              onPressed: () => _openPhoneSetup(registration: true),
              child: Text(L.tr('Mgonjwa mpya? Sajili account'))),
        ] else ...[
          if (_remembered != null) ...[
            Text(_remembered!['full_name'] as String? ?? L.tr('Account yako'),
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: Theme.of(context).colorScheme.onSurface)),
            const SizedBox(height: 26),
          ] else ...[
            Text(
                _passwordMode
                    ? L.tr(
                        'Thibitisha account yako ili kuitumia kwenye simu hii.')
                    : L.tr('Weka namba yako ili upate OTP ya uthibitisho.'),
                textAlign: TextAlign.center),
            const SizedBox(height: 26),
            TextField(
              controller: _controller,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: InputDecoration(
                  labelText: S.phoneLabel,
                  hintText: S.phoneHint,
                  prefixIcon: Icon(Icons.phone_outlined, size: 20)),
              onChanged: (value) {
                final formatted = formatLocal(value);
                if (formatted != value) {
                  _controller.value = TextEditingValue(
                      text: formatted,
                      selection:
                          TextSelection.collapsed(offset: formatted.length));
                }
              },
              onSubmitted: (_) {
                if (!_busy && !_passwordMode) _submit();
              },
            ),
            const SizedBox(height: 18),
          ],
          if (_passwordMode) ...[
            TextField(
              controller: _password,
              onSubmitted: (_) {
                if (!_busy) _submit();
              },
              obscureText: !_showPassword,
              autocorrect: false,
              enableSuggestions: false,
              autofillHints: const [AutofillHints.password],
              textInputAction: TextInputAction.done,
              decoration: InputDecoration(
                labelText: L.tr('Password'),
                prefixIcon: const Icon(Icons.lock_outline_rounded, size: 20),
                suffixIcon: IconButton(
                    tooltip: _showPassword
                        ? L.tr('Ficha password')
                        : L.tr('Onyesha password'),
                    onPressed: () =>
                        setState(() => _showPassword = !_showPassword),
                    icon: Icon(
                        _showPassword
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        size: 22)),
              ),
            ),
          ] else if (_remembered != null) ...[
            Text(
                L.tr(
                    'Tutatumia namba iliyothibitishwa ya account hii kutuma OTP.'),
                textAlign: TextAlign.center),
          ] else if (widget.registration) ...[
            Text(L.tr(
                'Ada ya usajili ni TSh 4,000 mara moja baada ya kuthibitisha taarifa zako.')),
          ],
          if (_error != null) ...[const SizedBox(height: 16), Notice(_error!)],
          const SizedBox(height: 22),
          FilledButton.icon(
            onPressed: _busy ? null : _submit,
            icon: Icon(_passwordMode ? Icons.login_rounded : Icons.sms_outlined,
                size: 20),
            label: Text(_busy
                ? 'Inasubiri...'
                : _passwordMode
                    ? L.tr('Ingia')
                    : L.tr('Pata OTP')),
          ),
          const SizedBox(height: 8),
          TextButton(
              onPressed: _busy
                  ? null
                  : () => setState(() {
                        _passwordMode = !_passwordMode;
                        _error = null;
                        _password.clear();
                      }),
              child: Text(_passwordMode
                  ? L.tr('Nimesahau password / tumia OTP')
                  : L.tr('Nina account: ingia'))),
        ],
      ]),
    );
  }
}
