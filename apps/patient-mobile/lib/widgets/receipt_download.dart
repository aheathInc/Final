import '../core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/api.dart';

class ReceiptDownload extends StatefulWidget {
  const ReceiptDownload(
      {super.key, required this.billId, this.registration = false});
  final String billId;
  final bool registration;
  @override
  State<ReceiptDownload> createState() => _ReceiptDownloadState();
}

class _ReceiptDownloadState extends State<ReceiptDownload> {
  bool _busy = false;
  String? _message;
  Future<void> _download() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final bytes = await Api.receiptPdf(
          widget.registration
              ? '/payments/registration/receipt'
              : '/payments/bills/${widget.billId}/receipt',
          registration: widget.registration);
      if (!mounted) return;
      final saved = await const MethodChannel('ahealth/device_actions')
          .invokeMethod<bool>('saveReceipt', {
        'name':
            'A-Health-risiti-${widget.billId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '')}.pdf',
        'bytes': bytes,
      });
      if (mounted) {
        setState(() => _message = saved == true
            ? L.tr('Risiti imehifadhiwa kwenye eneo ulilochagua.')
            : L.tr('Hujahifadhi risiti. Unaweza kuipakua tena.'));
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _message = e.message);
    } on PlatformException catch (e) {
      if (mounted) {
        setState(() => _message =
            e.message ?? L.tr('Risiti haijahifadhiwa. Jaribu tena.'));
      }
    } catch (_) {
      if (mounted) {
        setState(() => _message =
            L.tr('Risiti haijapakuliwa. Angalia mtandao kisha ujaribu tena.'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      OutlinedButton.icon(
          onPressed: _busy ? null : _download,
          icon: const Icon(Icons.download_outlined),
          label: Text(
              _busy ? L.tr('Inapakua risiti...') : L.tr('Pakua risiti (PDF)'))),
      if (_message != null)
        Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(L.tr(_message!))),
    ]);
  }
}
