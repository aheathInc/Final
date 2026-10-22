import 'package:flutter/material.dart';

/// Colour carries clinical meaning and nothing else.
///
/// [clay] means act now, [amber] means something needs you. Neither appears as
/// decoration anywhere, so a calm screen reads as calm — which matters more
/// here than on most products, because the person holding this phone is often
/// unwell, worried, and reading in poor light.
class AppColors {
  static const ink = Color(0xFF10241F);
  static const inkSoft = Color(0xFF4A5F59);
  static const paper = Color(0xFFF4F6F2);
  static const paperSunk = Color(0xFFE7EBE5);
  static const line = Color(0xFFD2D9D1);
  static const petrol = Color(0xFF0F4C43);
  static const petrolLift = Color(0xFF17685C);
  static const amber = Color(0xFFC2700B);
  static const clay = Color(0xFFA63D2F);
}

ThemeData buildTheme() {
  const base = TextStyle(color: AppColors.ink, height: 1.45);

  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: AppColors.paper,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.petrol,
      primary: AppColors.petrol,
      error: AppColors.clay,
      surface: AppColors.paper,
    ),
    // 17px rather than the usual 14: read on a small, cheap screen by someone
    // who is not at their best.
    textTheme: TextTheme(
      bodyLarge: base.copyWith(fontSize: 17),
      bodyMedium: base.copyWith(fontSize: 16),
      bodySmall: base.copyWith(fontSize: 14, color: AppColors.inkSoft),
      titleLarge: base.copyWith(fontSize: 24, fontWeight: FontWeight.w600),
      titleMedium: base.copyWith(fontSize: 18, fontWeight: FontWeight.w600),
      labelLarge: base.copyWith(fontSize: 16, fontWeight: FontWeight.w500),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.paper,
      foregroundColor: AppColors.ink,
      elevation: 0,
      centerTitle: false,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.petrol,
        foregroundColor: Colors.white,
        // 52dp: the smallest target a thumb hits reliably one-handed, which is
        // how this is actually held.
        minimumSize: const Size.fromHeight(52),
        shape: const RoundedRectangleBorder(),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderSide: BorderSide(color: AppColors.line)),
      enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.line)),
      focusedBorder: OutlineInputBorder(
        borderSide: BorderSide(color: AppColors.petrol, width: 2),
      ),
      contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 16),
    ),
  );
}
