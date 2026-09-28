import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// The local cache.
///
/// The SA&D names exactly three things that must survive losing signal:
/// first-aid guidance, the medication schedule, and the last consultation
/// notes. Those are the three tables here — not a general-purpose mirror of
/// the server, which would be a lot of complexity for data nobody needs while
/// offline.
///
/// [outbox] is the fourth: writes made with no connection, replayed later
/// through /sync/batch.
class Db {
  static Database? _db;

  static Future<Database> get instance async {
    if (_db != null) return _db!;
    final path = p.join(await getDatabasesPath(), 'a_health.db');
    _db = await openDatabase(
      path,
      version: 1,
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE medication_schedule (
            id TEXT PRIMARY KEY,
            medication_name TEXT NOT NULL,
            dosage TEXT NOT NULL,
            scheduled_at TEXT NOT NULL,
            reported_status TEXT NOT NULL,
            synced INTEGER NOT NULL DEFAULT 1
          )
        ''');
        await db.execute('''
          CREATE TABLE consultation_notes (
            id TEXT PRIMARY KEY,
            diagnosis_text TEXT,
            advice_text TEXT,
            red_flags TEXT,
            created_at TEXT NOT NULL
          )
        ''');
        await db.execute('''
          CREATE TABLE first_aid (
            category TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            steps TEXT NOT NULL
          )
        ''');
        await db.execute('''
          CREATE TABLE outbox (
            op_id TEXT PRIMARY KEY,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            path_params TEXT,
            body TEXT,
            created_at TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
          )
        ''');
      },
    );
    return _db!;
  }

  static Future<void> replaceMedicationSchedule(List<Map<String, Object?>> rows) async {
    final db = await instance;
    await db.transaction((txn) async {
      // Only rows already confirmed to the server are replaced. A local
      // unsynced answer must survive a refresh, or a patient who reported a
      // dose offline would watch their answer disappear.
      await txn.delete('medication_schedule', where: 'synced = 1');
      for (final r in rows) {
        await txn.insert('medication_schedule', r,
            conflictAlgorithm: ConflictAlgorithm.ignore);
      }
    });
  }

  static Future<List<Map<String, Object?>>> medicationSchedule() async {
    final db = await instance;
    return db.query('medication_schedule', orderBy: 'scheduled_at ASC');
  }

  static Future<void> markReported(String id, String status) async {
    final db = await instance;
    await db.update('medication_schedule',
        {'reported_status': status, 'synced': 0},
        where: 'id = ?', whereArgs: [id]);
  }

  static Future<void> markSynced(String id) async {
    final db = await instance;
    await db.update('medication_schedule', {'synced': 1},
        where: 'id = ?', whereArgs: [id]);
  }

  static Future<void> cacheNotes(List<Map<String, Object?>> rows) async {
    final db = await instance;
    await db.transaction((txn) async {
      await txn.delete('consultation_notes');
      for (final r in rows) {
        await txn.insert('consultation_notes', r,
            conflictAlgorithm: ConflictAlgorithm.replace);
      }
    });
  }

  static Future<List<Map<String, Object?>>> notes() async {
    final db = await instance;
    return db.query('consultation_notes', orderBy: 'created_at DESC');
  }
}
