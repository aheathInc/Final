/// Tanzanian numbers are written locally as 0712 345 678; the API takes E.164.
/// Asking someone to type a format they have never written is a good way to
/// lose them at the first screen, so the conversion happens here.
String? toE164(String input) {
  final digits = input.replaceAll(RegExp(r'\D'), '');
  if (RegExp(r'^0[1-9]\d{8}$').hasMatch(digits)) return '+255${digits.substring(1)}';
  if (RegExp(r'^255[1-9]\d{8}$').hasMatch(digits)) return '+$digits';
  if (RegExp(r'^[1-9]\d{8}$').hasMatch(digits)) return '+255$digits';
  return null;
}

String formatLocal(String input) {
  final d = input.replaceAll(RegExp(r'\D'), '');
  final s = d.length > 10 ? d.substring(0, 10) : d;
  if (s.length <= 4) return s;
  if (s.length <= 7) return '${s.substring(0, 4)} ${s.substring(4)}';
  return '${s.substring(0, 4)} ${s.substring(4, 7)} ${s.substring(7)}';
}

String newOpId() {
  final now = DateTime.now().microsecondsSinceEpoch;
  final rand = (now % 100000).toString().padLeft(5, '0');
  return '${now.toRadixString(16)}-$rand';
}
