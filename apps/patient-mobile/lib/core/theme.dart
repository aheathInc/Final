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
  static const deepOcean = Color(0xFF0B3631);
  static const mintWash = Color(0xFFDCECE5);
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
      secondary: AppColors.petrolLift,
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
      headlineSmall:
          base.copyWith(fontSize: 28, fontWeight: FontWeight.w700, height: 1.2),
      titleSmall: base.copyWith(fontSize: 16, fontWeight: FontWeight.w600),
      labelLarge: base.copyWith(fontSize: 16, fontWeight: FontWeight.w500),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.paper,
      foregroundColor: AppColors.ink,
      elevation: 0,
      centerTitle: false,
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 72,
      backgroundColor: Colors.white,
      indicatorColor: AppColors.mintWash,
      elevation: 4,
      labelTextStyle: WidgetStateProperty.resolveWith((states) => TextStyle(
            color: states.contains(WidgetState.selected)
                ? AppColors.petrol
                : AppColors.inkSoft,
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w700
                : FontWeight.w500,
          )),
    ),
    navigationRailTheme: const NavigationRailThemeData(
      backgroundColor: AppColors.paper,
      indicatorColor: AppColors.mintWash,
      selectedIconTheme: IconThemeData(color: AppColors.petrol),
      unselectedIconTheme: IconThemeData(color: AppColors.inkSoft),
      selectedLabelTextStyle: TextStyle(
        color: AppColors.petrol,
        fontWeight: FontWeight.w700,
      ),
      unselectedLabelTextStyle: TextStyle(color: AppColors.inkSoft),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.petrol,
        foregroundColor: Colors.white,
        // 52dp: the smallest target a thumb hits reliably one-handed, which is
        // how this is actually held.
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(14)),
        borderSide: BorderSide(color: AppColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(14)),
        borderSide: BorderSide(color: AppColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(14)),
        borderSide: BorderSide(color: AppColors.petrol, width: 2),
      ),
      contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 16),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 1,
      shadowColor: AppColors.ink.withValues(alpha: .08),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      margin: EdgeInsets.zero,
    ),
  );
}
