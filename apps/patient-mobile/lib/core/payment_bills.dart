import 'dart:math';
import 'api.dart';

/// No offline writes: initiating a wallet debit requires an authenticated server.
class PaymentBillsRepository {
  String newKey() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<List<Map<String, dynamic>>> bills() async {
    final value = await Api.get('/payments/bills');
    if (value is! Map || value['data'] is! List) {
      throw const FormatException('Invalid bill list');
    }
    return (value['data'] as List)
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
  }

  Future<Map<String, dynamic>> options() async =>
      _object(await Api.get('/payments/options'));
  Future<Map<String, dynamic>> intent(String id) async =>
      _object(await Api.get('/payments/intents/$id'));
  Future<Map<String, dynamic>> pay(
          {required String billId,
          required String provider,
          required String phone,
          required String key,
          String? email}) async =>
      _object(await Api.post(
          '/payments/intents',
          {
            'bill_id': billId,
            'method': 'mobile_money',
            'provider': provider,
            'payer_phone': phone,
            if (email != null && email.isNotEmpty) 'payer_email': email
          },
          idempotencyKey: key));
  Map<String, dynamic> _object(Object? value) {
    if (value is! Map) throw const FormatException('Invalid payment response');
    return Map<String, dynamic>.from(value);
  }
}
