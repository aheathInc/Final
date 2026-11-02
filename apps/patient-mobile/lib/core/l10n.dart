import 'dart:convert';
import 'package:flutter/services.dart';
import 'app_preferences.dart';

/// Translates authored interface copy only. Parameter values remain untouched.
class L {
  static Map<String, List<String>> _catalog = {};
  static final Map<String, String> _canonical = {};
  static Future<void> load() async {
    final data =
        jsonDecode(await rootBundle.loadString('assets/l10n/ui.json')) as Map;
    _catalog = data.map((key, value) =>
        MapEntry(key as String, List<String>.from(value as List)));
    _canonical.clear();
    for (final entry in _catalog.entries) {
      for (final value in entry.value) {
        _canonical.putIfAbsent(value, () => entry.key);
      }
    }
  }

  static String tr(String source, [List<Object?> arguments = const []]) {
    final key =
        _catalog.containsKey(source) ? source : _canonical[source] ?? source;
    final language = AppPreferences.instance.language;
    final translated = language == 'sw'
        ? ((_catalog[key]?.length ?? 0) > 2 ? _catalog[key]![2] : key)
        : _catalog[key]?[language == 'fr' ? 1 : 0] ?? key;
    return translated.replaceAllMapped(RegExp(r'\{(\d+)\}'), (match) {
      final index = int.parse(match[1]!);
      return index < arguments.length ? '${arguments[index] ?? ''}' : match[0]!;
    });
  }
}
