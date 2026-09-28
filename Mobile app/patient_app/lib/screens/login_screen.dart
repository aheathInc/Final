import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'home_screen.dart';
import 'verify_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final e164 = toE164(_controller.text);
    if (e164 == null) {
      setState(() => _error = S.phoneInvalid);
      return;
    }
    setState(() { _busy = true; _error = null; });

    try {
      final data = await Api.post('/auth/otp/request',
          {'phone_number': e164, 'channel': 'sms'});
      if (!mounted) return;
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => VerifyScreen(
          challengeId: data['challenge_id'] as String,
          maskedTo: (data['masked_destination'] as String?) ?? e164,
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
      // We use the real verify endpoint but with 000000 if we had a challenge,
      // but for a true bypass we'd need a challenge first.
      // Instead, let's just mock a session if the backend isn't ready,
      // or better, actually request a challenge for a test number.
      final data = await Api.post('/auth/otp/request',
          {'phone_number': '+255000000000', 'channel': 'sms'});
      final deviceId = await Session.deviceId();
      final session = await Api.post('/auth/otp/verify', {
        'challenge_id': data['challenge_id'],
        'code': '000000',
        'device_id': deviceId,
      });

      await Session.save(
        accessToken: session['access_token'] as String,
        refreshToken: session['refresh_token'] as String,
        user: session['user'] as Map<String, dynamic>?,
      );
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const HomeScreen()),
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
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(S.loginTitle, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 10),
                const Text(S.loginLede, style: TextStyle(color: AppColors.inkSoft, fontSize: 16)),
                const SizedBox(height: 32),
                const Text(S.phoneLabel, style: TextStyle(fontWeight: FontWeight.w500)),
                const SizedBox(height: 8),
                TextField(
                  controller: _controller,
                  keyboardType: TextInputType.phone,
                  autofocus: true,
                  style: const TextStyle(fontSize: 20, letterSpacing: 1),
                  decoration: const InputDecoration(hintText: S.phoneHint),
                  onChanged: (v) {
                    final formatted = formatLocal(v);
                    if (formatted != v) {
                      _controller.value = TextEditingValue(
                        text: formatted,
                        selection: TextSelection.collapsed(offset: formatted.length),
                      );
                    }
                  },
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Notice(_error!),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: Text(_busy ? 'Inatuma...' : S.continueLabel),
                ),
                if (kDebugMode) ...[
                  const SizedBox(height: 20),
                  TextButton(
                    onPressed: _busy ? null : _devLogin,
                    child: const Text('INGIA KAMA TESTER (Bypass OTP)'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
