/// Every user-visible string, Swahili first, in one place.
///
/// The SMS the backend sends is Swahili-first for the same reason. Keeping
/// these together means adding the contract's other languages later is a
/// mechanical change rather than a rewrite of every screen.
class S {
  static const appName = 'A-health';

  static const loginTitle = 'Karibu A-health';
  static const loginLede = 'Ingiza namba yako ya simu. Tutakutumia namba ya uthibitisho kwa SMS.';
  static const phoneLabel = 'Namba ya simu';
  static const phoneHint = '0712 345 678';
  static const continueLabel = 'Endelea';
  static const phoneInvalid = 'Namba ya simu si sahihi. Tumia namba ya Tanzania.';

  static const verifyTitle = 'Weka namba ya uthibitisho';
  static const codeLabel = 'Namba ya tarakimu sita';
  static const verify = 'Thibitisha';
  static const codeInvalid = 'Namba si sahihi. Angalia SMS kisha jaribu tena.';

  static const homeGetHelp = 'Pata msaada wa daktari';
  static const homeGetHelpHint = 'Eleza tatizo lako, tutakuunganisha na daktari.';
  static const homeNothing = 'Huna matibabu yanayoendelea.';
  static const emergency = 'Dharura';

  static const medications = 'Dawa zangu';
  static const checkIns = 'Maswali ya afya';
  static const screening = 'Uchunguzi wa afya';
  static const vaccinations = 'Chanjo';
  static const profile = 'Wasifu wangu';
  static const dependents = 'Wategemezi';

  static const taken = 'Nimekunywa';
  static const missed = 'Sikukunywa';

  static const offlineBanner = 'Hakuna mtandao. Majibu yako yamehifadhiwa na yatatumwa yenyewe.';
  static const pendingSuffix = 'inasubiri kutumwa';

  static const errorGeneric = 'Kuna tatizo la kiufundi. Jaribu tena baada ya muda mfupi.';
  static const errorOffline = 'Hakuna mtandao.';
  static const send = 'Tuma';
  static const cancel = 'Ghairi';
  static const save = 'Hifadhi';
  static const signOut = 'Toka';
}
