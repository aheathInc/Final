import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:intl/intl.dart';
import 'package:intl/date_symbol_data_local.dart';

/// Device preferences work offline and do not contain patient records.
class AppPreferences extends ChangeNotifier {
  AppPreferences({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
                aOptions: AndroidOptions(encryptedSharedPreferences: true));
  static final instance = AppPreferences();
  static const languages = ['sw', 'en', 'fr'];
  final FlutterSecureStorage _storage;
  String _language = 'sw';
  ThemeMode _theme = ThemeMode.system;
  String get language => _language;
  Locale get locale => Locale(_language);
  ThemeMode get themeMode => _theme;
  Future<void> load() async {
    await initializeDateFormatting();
    final language = await _storage.read(key: 'ah_ui_language');
    final theme = await _storage.read(key: 'ah_ui_theme');
    _language = languages.contains(language) ? language! : 'sw';
    Intl.defaultLocale = _language;
    _theme = ThemeMode.values.where((v) => v.name == theme).firstOrNull ??
        ThemeMode.system;
    notifyListeners();
  }

  Future<void> setLanguage(String value) async {
    if (!languages.contains(value)) throw ArgumentError.value(value);
    await _storage.write(key: 'ah_ui_language', value: value);
    _language = value;
    Intl.defaultLocale = value;
    notifyListeners();
  }

  Future<void> setTheme(ThemeMode value) async {
    await _storage.write(key: 'ah_ui_theme', value: value.name);
    _theme = value;
    notifyListeners();
  }
}
