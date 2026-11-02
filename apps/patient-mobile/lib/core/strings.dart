import 'l10n.dart';

/// Shared interface labels. The full offline catalog is assets/l10n/ui.json.
class S {
  static String get appName => 'A-health';

  static String get loginTitle => L.tr('Karibu A-health');
  static String get loginLede => L.tr(
      'Ingiza namba yako ya simu. Tutakutumia namba ya uthibitisho kwa SMS.');
  static String get phoneLabel => L.tr('Namba ya simu');
  static String get phoneHint => '0712 345 678';
  static String get continueLabel => L.tr('Endelea');
  static String get phoneInvalid =>
      L.tr('Namba ya simu si sahihi. Tumia namba ya Tanzania.');

  static String get verifyTitle => L.tr('Weka namba ya uthibitisho');
  static String get codeLabel => L.tr('Namba ya tarakimu sita');
  static String get verify => L.tr('Thibitisha');
  static String get codeInvalid =>
      L.tr('Namba si sahihi. Angalia SMS kisha jaribu tena.');

  static String get homeGetHelp => L.tr('Pata msaada wa daktari');
  static String get homeGetHelpHint =>
      L.tr('Eleza tatizo lako, tutakuunganisha na daktari.');
  static String get homeNothing => L.tr('Huna matibabu yanayoendelea.');
  static String get emergency => L.tr('Dharura');

  static String get medications => L.tr('Dawa zangu');
  static String get checkIns => L.tr('Maswali ya afya');
  static String get screening => L.tr('Uchunguzi wa afya');
  static String get vaccinations => L.tr('Chanjo');
  static String get profile => L.tr('Wasifu wangu');
  static String get dependents => L.tr('Wategemezi');

  static String get taken => L.tr('Nimekunywa');
  static String get missed => L.tr('Sikukunywa');

  static String get offlineBanner =>
      L.tr('Hakuna mtandao. Unaweza kusoma taarifa zilizohifadhiwa tu.');
  static String get pendingSuffix =>
      L.tr('Pending sync — haijathibitishwa na seva');

  static String get errorGeneric =>
      L.tr('Kuna tatizo la kiufundi. Jaribu tena baada ya muda mfupi.');
  static String get errorOffline => L.tr('Hakuna mtandao.');
  static String get send => L.tr('Tuma');
  static String get cancel => L.tr('Ghairi');
  static String get save => L.tr('Hifadhi');
  static String get signOut => L.tr('Toka');
}
