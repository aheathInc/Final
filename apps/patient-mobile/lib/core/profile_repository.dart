import 'api.dart';
import 'db.dart';

class PatientProfileRepository {
  Future<bool> online() => Api.online;
  Future<Map<String, dynamic>> account() async =>
      Map<String, dynamic>.from(await Api.get('/users/me'));
  Future<Map<String, dynamic>> profile() async =>
      Map<String, dynamic>.from(await Api.get('/patient-profiles/me'));
  Future<List<Map<String, dynamic>>> dependents() async {
    final data = await Api.get('/users/me/dependents');
    return (data['data'] as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
  }

  Future<List<Map<String, Object?>>> notes(String owner) => Db.notes(owner);
  Future<DateTime?> notesSyncedAt(String owner) =>
      Db.cacheSyncedAt('consultation_notes', owner);
  Future<Map<String, dynamic>> saveAccount(Map<String, dynamic> body,
          {int? expectedIdentity}) async =>
      Map<String, dynamic>.from(await Api.patch('/users/me', body,
          expectedIdentity: expectedIdentity));
  Future<Map<String, dynamic>> saveMedical(Map<String, dynamic> body,
          {int? expectedIdentity}) async =>
      Map<String, dynamic>.from(await Api.patch('/patient-profiles/me', body,
          expectedIdentity: expectedIdentity));
  Future<void> signOut() async {
    await Api.post('/auth/logout', {});
  }
}
