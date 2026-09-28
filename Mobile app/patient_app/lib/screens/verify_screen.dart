import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'home_screen.dart';

class VerifyScreen extends StatefulWidget {
  const VerifyScreen({super.key, required this.challengeId, required this.maskedTo});
  final String challengeId;
  final String maskedTo;

  @override
  State<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends State<VerifyScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      final deviceId = await Session.deviceId();
      final data = await Api.post('/auth/otp/verify', {
        'challenge_id': widget.challengeId,
        'code': _controller.text,
        'device_id': deviceId,
      });
      await Session.save(
        accessToken: data['access_token'] as String,
        refreshToken: data['refresh_token'] as String,
        user: data['user'] as Map<String, dynamic>?,
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
      appBar: AppBar(),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(S.verifyTitle, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 10),
              Text('Tumetuma namba kwenda ${widget.maskedTo}.',
                  style: const TextStyle(color: AppColors.inkSoft, fontSize: 16)),
              const SizedBox(height: 32),
              const Text(S.codeLabel, style: TextStyle(fontWeight: FontWeight.w500)),
              const SizedBox(height: 8),
              TextField(
                controller: _controller,
                keyboardType: TextInputType.number,
                autofocus: true,
                maxLength: 6,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: 'monospace', fontSize: 28, letterSpacing: 10,
                ),
                decoration: const InputDecoration(
                  hintText: kDebugMode ? '000000' : null,
                  counterText: '',
                ),
                onChanged: (_) => setState(() {}),
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Notice(_error!),
              ],
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _busy || _controller.text.length != 6 ? null : _submit,
                child: Text(_busy ? 'Inathibitisha...' : S.verify),
              ),
              if (kDebugMode)
                Padding(
                  padding: const EdgeInsets.only(top: 20),
                  child: Center(
                    child: Text(
                      'DEVELOPMENT MODE: Tumia 000000 kuruka.',
                      style: TextStyle(color: Colors.orange.shade800, fontSize: 13),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
