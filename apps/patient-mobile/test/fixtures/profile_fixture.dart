import 'dart:async';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/profile_repository.dart';
import 'package:a_health_patient/core/session.dart';

const syntheticProfileAccount = <String, dynamic>{
  'id': 'synthetic-profile-owner',
  'role': 'patient',
  'full_name': 'Synthetic Test Patient',
  'phone_number': '+255700000099',
  'preferred_language': 'sw',
  'version': 7
};
const syntheticPatientProfile = <String, dynamic>{
  'version': 3,
  'date_of_birth': '1995-07-10',
  'sex': 'female',
  'residence': 'Dodoma, Tanzania',
  'allergies': ['Penicillin'],
  'chronic_conditions': <String>[],
  'emergency_contact': '+255700000098',
  'next_of_kin_name': 'Synthetic Relative',
  'next_of_kin_phone': '+255700000098'
};

class ProfileFixture extends PatientProfileRepository {
  bool connected = true,
      failReads = false,
      conflict = false,
      failDependents = false;
  Completer<void>? gate;
  final accountData = Map<String, dynamic>.from(syntheticProfileAccount);
  final profileData = Map<String, dynamic>.from(syntheticPatientProfile);
  final accountWrites = <Map<String, dynamic>>[],
      medicalWrites = <Map<String, dynamic>>[],
      noteOwners = <String>[];
  @override
  Future<bool> online() async => connected;
  @override
  Future<Map<String, dynamic>> account() async {
    if (gate != null) await gate!.future;
    if (failReads) throw Exception('Synthetic offline');
    return Map.from(accountData);
  }

  @override
  Future<Map<String, dynamic>> profile() async {
    if (gate != null) await gate!.future;
    if (failReads) throw Exception('Synthetic offline');
    return Map.from(profileData);
  }

  @override
  Future<List<Map<String, dynamic>>> dependents() async {
    if (failDependents) throw Exception('Synthetic unavailable');
    return [
      {'full_name': 'Synthetic Dependent'}
    ];
  }

  @override
  Future<List<Map<String, Object?>>> notes(String owner) async {
    noteOwners.add(owner);
    return [
      {
        'created_at': '2026-10-28T07:00:00Z',
        'diagnosis_text': 'Synthetic note title',
        'advice_text': 'Synthetic cached advice for UI testing.',
        'red_flags': 'Synthetic warning sign'
      }
    ];
  }

  @override
  Future<DateTime?> notesSyncedAt(String owner) async =>
      DateTime.utc(2026, 10, 28, 7);
  void _guard(int? expectedIdentity) {
    if (expectedIdentity != null &&
        expectedIdentity != Session.identityChanges.value)
      throw ApiException(403, 'NOT_RESOURCE_OWNER', 'Synthetic account change');
  }

  @override
  Future<Map<String, dynamic>> saveAccount(Map<String, dynamic> body,
      {int? expectedIdentity}) async {
    _guard(expectedIdentity);
    accountWrites.add(Map.from(body));
    if (conflict)
      throw ApiException(409, 'VERSION_CONFLICT', 'Synthetic conflict');
    accountData.addAll({
      'full_name': body['full_name'],
      'preferred_language': body['preferred_language'],
      'version': (accountData['version'] as int) + 1
    });
    return Map.from(accountData);
  }

  @override
  Future<Map<String, dynamic>> saveMedical(Map<String, dynamic> body,
      {int? expectedIdentity}) async {
    _guard(expectedIdentity);
    medicalWrites.add(Map.from(body));
    if (conflict)
      throw ApiException(409, 'VERSION_CONFLICT', 'Synthetic conflict');
    profileData
        .addAll({...body, 'version': (profileData['version'] as int) + 1});
    return Map.from(profileData);
  }

  @override
  Future<void> signOut() async {}
}
