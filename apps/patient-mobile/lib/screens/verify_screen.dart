import '../core/l10n.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../widgets/common.dart';
import '../widgets/premium.dart';
import 'auth_destination.dart';
import 'dart:async';

class VerifyScreen extends StatefulWidget {
  const VerifyScreen(
      {super.key,
      required this.challengeId,
      required this.maskedTo,
      this.phoneNumber,
      this.simulated = false,
      this.developmentCode});
  final String challengeId;
  final String maskedTo;
  final String? phoneNumber;
  final bool simulated;
  final String? developmentCode;

  @override
  State<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends State<VerifyScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _busy = false;
  late String _challengeId;
  String? _devCode;
  int _resendSeconds = 60;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _challengeId = widget.challengeId;
    _devCode = widget.developmentCode;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _resendSeconds > 0) setState(() => _resendSeconds--);
    });
    final code = widget.developmentCode;
    if (kDebugMode && code != null && RegExp(r'^\d{6}$').hasMatch(code)) {
      _controller.text = code;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final deviceId = await Session.deviceId();
      final data = await Api.post('/auth/otp/verify', {
        'challenge_id': _challengeId,
        'code': _controller.text,
        'device_id': deviceId,
      });
      final destination =
          await authenticationDestination(Map<String, dynamic>.from(data));
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

  Future<void> _resend() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await Api.post('/auth/otp/request',
          {'phone_number': widget.phoneNumber, 'channel': 'sms'});
      if (!mounted) return;
      setState(() {
        _challengeId = data['challenge_id'];
        _devCode = kDebugMode ? data['dev_code'] : null;
        _controller.text = _devCode ?? '';
        _resendSeconds = 60;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = S.errorOffline);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  PremiumAuroraHero(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          S.verifyTitle,
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(
                                color: Colors.white,
                              ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          widget.simulated
                              ? L.tr(
                                  "MAJARIBIO: SMS halisi haijatumwa kwa {0}.",
                                  [widget.maskedTo])
                              : L.tr(
                                  "OTP imeombwa kwa {0}. Inaisha baada ya dakika 5.",
                                  [widget.maskedTo]),
                          style: const TextStyle(
                              color: Colors.white, fontSize: 16),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  PremiumCard(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(S.codeLabel,
                            style: Theme.of(context).textTheme.titleSmall),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _controller,
                          keyboardType: TextInputType.number,
                          autofillHints: const [AutofillHints.oneTimeCode],
                          textInputAction: TextInputAction.done,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                          ],
                          autofocus: true,
                          maxLength: 6,
                          textAlign: TextAlign.center,
                          style:
                              const TextStyle(fontSize: 28, letterSpacing: 10),
                          decoration: const InputDecoration(counterText: ''),
                          onChanged: (_) => setState(() {}),
                          onSubmitted: (_) {
                            if (!_busy && _controller.text.length == 6) {
                              _submit();
                            }
                          },
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: 8),
                          Notice(_error!),
                        ],
                        const SizedBox(height: 18),
                        FilledButton(
                          onPressed: _busy || _controller.text.length != 6
                              ? null
                              : _submit,
                          child: Text(_busy ? 'Inathibitisha...' : S.verify),
                        ),
                        if (widget.phoneNumber != null)
                          TextButton(
                              onPressed:
                                  _busy || _resendSeconds > 0 ? null : _resend,
                              child: Text(_resendSeconds > 0
                                  ? L.tr("Tuma tena baada ya sekunde {0}",
                                      [_resendSeconds])
                                  : L.tr('Tuma OTP nyingine'))),
                        if (kDebugMode && _devCode != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 16),
                            child: Text(
                              L.tr("OTP ya majaribio: {0}", [_devCode]),
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Colors.orange.shade900,
                                fontSize: 13,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
