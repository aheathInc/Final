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

/// Semantic colors for each appearance. Brand meaning stays stable while
/// foreground and surface tones adapt to the system theme.
class AppPalette {
  const AppPalette({
    required this.ink,
    required this.inkSoft,
    required this.paper,
    required this.surface,
    required this.paperSunk,
    required this.line,
    required this.petrol,
    required this.petrolLift,
    required this.deepOcean,
    required this.mintWash,
    required this.amber,
    required this.clay,
    required this.urgentWash,
    required this.action,
    required this.onAction,
    required this.heroStart,
    required this.heroMiddle,
    required this.heroEnd,
  });

  final Color ink;
  final Color inkSoft;
  final Color paper;
  final Color surface;
  final Color paperSunk;
  final Color line;
  final Color petrol;
  final Color petrolLift;
  final Color deepOcean;
  final Color mintWash;
  final Color amber;
  final Color clay;
  final Color urgentWash;
  final Color action;
  final Color onAction;
  final Color heroStart;
  final Color heroMiddle;
  final Color heroEnd;

  static const light = AppPalette(
    ink: AppColors.ink,
    inkSoft: AppColors.inkSoft,
    paper: AppColors.paper,
    surface: Colors.white,
    paperSunk: AppColors.paperSunk,
    line: AppColors.line,
    petrol: AppColors.petrol,
    petrolLift: AppColors.petrolLift,
    deepOcean: AppColors.deepOcean,
    mintWash: AppColors.mintWash,
    amber: AppColors.amber,
    clay: AppColors.clay,
    urgentWash: Color(0xFFF8E5E1),
    action: AppColors.petrol,
    onAction: Colors.white,
    heroStart: AppColors.deepOcean,
    heroMiddle: AppColors.petrol,
    heroEnd: AppColors.petrolLift,
  );

  static const dark = AppPalette(
    ink: Color(0xFFEAF2EE),
    inkSoft: Color(0xFFB5C7C0),
    paper: Color(0xFF101815),
    surface: Color(0xFF18231F),
    paperSunk: Color(0xFF22312B),
    line: Color(0xFF3B4D45),
    petrol: Color(0xFF9AD8C6),
    petrolLift: Color(0xFFBCE9DB),
    deepOcean: Color(0xFF0B3631),
    mintWash: Color(0xFF29463C),
    amber: Color(0xFFFFD08A),
    clay: Color(0xFFFFA397),
    urgentWash: Color(0xFF4B2C27),
    action: Color(0xFF286D5F),
    onAction: Colors.white,
    heroStart: Color(0xFF082C28),
    heroMiddle: Color(0xFF0D4940),
    heroEnd: Color(0xFF17685C),
  );

  static AppPalette of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? dark : light;
}

ThemeData buildTheme() => _buildTheme(Brightness.light);

ThemeData buildDarkTheme() => _buildTheme(Brightness.dark);

ThemeData _buildTheme(Brightness brightness) {
  final palette =
      brightness == Brightness.dark ? AppPalette.dark : AppPalette.light;
  final base = TextStyle(color: palette.ink, height: 1.45);

  return ThemeData(
    brightness: brightness,
    useMaterial3: true,
    scaffoldBackgroundColor: palette.paper,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.petrol,
      brightness: brightness,
      primary: palette.petrol,
      secondary: palette.petrol,
      error: palette.clay,
      surface: palette.surface,
    ),
    // 17px rather than the usual 14: read on a small, cheap screen by someone
    // who is not at their best.
    textTheme: TextTheme(
      bodyLarge: base.copyWith(fontSize: 17),
      bodyMedium: base.copyWith(fontSize: 16),
      bodySmall: base.copyWith(fontSize: 14, color: palette.inkSoft),
      titleLarge: base.copyWith(fontSize: 24, fontWeight: FontWeight.w600),
      titleMedium: base.copyWith(fontSize: 18, fontWeight: FontWeight.w600),
      headlineSmall:
          base.copyWith(fontSize: 28, fontWeight: FontWeight.w700, height: 1.2),
      titleSmall: base.copyWith(fontSize: 16, fontWeight: FontWeight.w600),
      labelLarge: base.copyWith(fontSize: 16, fontWeight: FontWeight.w500),
    ),
    appBarTheme: const AppBarTheme(
      elevation: 0,
      centerTitle: false,
    ).copyWith(
      backgroundColor: palette.paper,
      foregroundColor: palette.ink,
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 72,
      backgroundColor: palette.surface,
      indicatorColor: palette.mintWash,
      elevation: 4,
      labelTextStyle: WidgetStateProperty.resolveWith((states) => TextStyle(
            color: states.contains(WidgetState.selected)
                ? palette.petrol
                : palette.inkSoft,
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w700
                : FontWeight.w500,
          )),
    ),
    navigationRailTheme: const NavigationRailThemeData(
      groupAlignment: -.78,
    ).copyWith(
      backgroundColor: palette.paper,
      indicatorColor: palette.mintWash,
      selectedIconTheme: IconThemeData(color: palette.petrol),
      unselectedIconTheme: IconThemeData(color: palette.inkSoft),
      selectedLabelTextStyle: TextStyle(
        color: palette.petrol,
        fontWeight: FontWeight.w700,
      ),
      unselectedLabelTextStyle: TextStyle(color: palette.inkSoft),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: palette.action,
        foregroundColor: palette.onAction,
        // 52dp: the smallest target a thumb hits reliably one-handed, which is
        // how this is actually held.
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: palette.surface,
      border: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(14)),
        borderSide: BorderSide(color: palette.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(14)),
        borderSide: BorderSide(color: palette.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(14)),
        borderSide: BorderSide(color: palette.petrol, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
    ),
    cardTheme: CardThemeData(
      color: palette.surface,
      elevation: 1,
      shadowColor: palette.ink.withValues(alpha: .08),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      margin: EdgeInsets.zero,
    ),
    dividerColor: palette.line,
  );
}
