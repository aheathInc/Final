import 'package:path/path.dart' as p;
import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';

/// The local cache.
///
/// The SA&D names exactly three things that must survive losing signal:
/// first-aid guidance, the medication schedule, and the last consultation
/// notes. Those are the three tables here — not a general-purpose mirror of
/// the server, which would be a lot of complexity for data nobody needs while
/// offline.
///
/// Medication and consultation-note rows are owned by one authenticated user.
/// [outbox] stores only allowlisted low-risk writes and is scoped the same way.
class Db {
  static Database? _db;

  static Future<Database> get instance async {
    if (_db != null) return _db!;
    final path = p.join(await getDatabasesPath(), 'a_health.db');
    _db = await openDatabase(
      path,
      version: 3,
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE medication_schedule (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            prescription_id TEXT,
            medication_name TEXT NOT NULL,
            dosage TEXT NOT NULL,
            scheduled_at TEXT NOT NULL,
            reported_status TEXT NOT NULL,
            synced INTEGER NOT NULL DEFAULT 1,
            sync_status TEXT NOT NULL DEFAULT 'confirmed'
          )
        ''');
        await db.execute('''
          CREATE TABLE consultation_notes (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
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
            owner_id TEXT NOT NULL,
            operation_type TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            path_params TEXT,
            body TEXT,
            created_at TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            status TEXT NOT NULL DEFAULT 'queued',
            retry_after TEXT
          )
        ''');
        await db.execute('''
          CREATE TABLE cache_sync_state (
            cache_name TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            synced_at TEXT NOT NULL,
            PRIMARY KEY (cache_name, owner_id)
          )
        ''');
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        await upgradeSchema(db, oldVersion);
      },
    );
    return _db!;
  }

  /// Applies additive local-cache upgrades. Kept separate so the migration
  /// statement and version guard can be covered without a device database.
  static Future<void> upgradeSchema(DatabaseExecutor db, int oldVersion) async {
    if (oldVersion < 2) {
      await db.execute(
        'ALTER TABLE medication_schedule ADD COLUMN prescription_id TEXT',
      );
    }
    if (oldVersion < 3) {
      // Rows from earlier versions have no provable owner. Leave them
      // unscoped and inaccessible to normal reads or synchronization.
      await db.execute(
        'ALTER TABLE medication_schedule ADD COLUMN owner_id TEXT',
      );
      await db.execute(
        "ALTER TABLE medication_schedule ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'legacy_unscoped'",
      );
      await db.execute(
        'ALTER TABLE consultation_notes ADD COLUMN owner_id TEXT',
      );
      await db.execute('ALTER TABLE outbox ADD COLUMN owner_id TEXT');
      await db.execute(
        "ALTER TABLE outbox ADD COLUMN operation_type TEXT NOT NULL DEFAULT 'legacy_unscoped'",
      );
      await db.execute(
        "ALTER TABLE outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'failed'",
      );
      await db.execute('ALTER TABLE outbox ADD COLUMN retry_after TEXT');
      await db.execute('''
        CREATE TABLE cache_sync_state (
          cache_name TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          PRIMARY KEY (cache_name, owner_id)
        )
      ''');
    }
  }

  static Future<void> replaceMedicationSchedule(
    String ownerId,
    List<Map<String, Object?>> rows,
  ) async {
    final db = await instance;
    await db.transaction((txn) async {
      // Only rows already confirmed to the server are replaced. A local
      // unsynced answer must survive a refresh, or a patient who reported a
      // dose offline would watch their answer disappear.
      await txn.delete(
        'medication_schedule',
        where: 'owner_id = ? AND synced = 1',
        whereArgs: [ownerId],
      );
      for (final r in rows) {
        await txn.insert(
            'medication_schedule',
            {
              ...r,
              'owner_id': ownerId,
              'sync_status': 'confirmed',
            },
            conflictAlgorithm: ConflictAlgorithm.ignore);
      }
    });
    await recordCacheSync('medication_schedule', ownerId);
  }

  static Future<List<Map<String, Object?>>> medicationSchedule(
    String ownerId,
  ) async {
    final db = await instance;
    return db.query(
      'medication_schedule',
      where: 'owner_id = ?',
      whereArgs: [ownerId],
      orderBy: 'scheduled_at ASC',
    );
  }

  static Future<void> markReported(
    String ownerId,
    String id,
    String status, {
    required String syncStatus,
  }) async {
    final db = await instance;
    await db.update(
      'medication_schedule',
      {
        'reported_status': status,
        'synced': syncStatus == 'confirmed' ? 1 : 0,
        'sync_status': syncStatus,
      },
      where: 'id = ? AND owner_id = ?',
      whereArgs: [id, ownerId],
    );
  }

  static Future<void> markSynced(String ownerId, String id) async {
    final db = await instance;
    await db.update(
      'medication_schedule',
      {'synced': 1, 'sync_status': 'confirmed'},
      where: 'id = ? AND owner_id = ?',
      whereArgs: [id, ownerId],
    );
  }

  static Future<void> markSyncFailed(String ownerId, String id) async {
    final db = await instance;
    await db.update(
      'medication_schedule',
      {'synced': 0, 'sync_status': 'failed'},
      where: 'id = ? AND owner_id = ?',
      whereArgs: [id, ownerId],
    );
  }

  static Future<void> cacheNotes(
    String ownerId,
    List<Map<String, Object?>> rows,
  ) async {
    final db = await instance;
    await db.transaction((txn) async {
      await txn.delete(
        'consultation_notes',
        where: 'owner_id = ?',
        whereArgs: [ownerId],
      );
      for (final r in rows) {
        await txn.insert(
            'consultation_notes',
            {
              ...r,
              'owner_id': ownerId,
            },
            conflictAlgorithm: ConflictAlgorithm.replace);
      }
    });
    await recordCacheSync('consultation_notes', ownerId);
  }

  static Future<List<Map<String, Object?>>> notes(String ownerId) async {
    final db = await instance;
    return db.query(
      'consultation_notes',
      where: 'owner_id = ?',
      whereArgs: [ownerId],
      orderBy: 'created_at DESC',
    );
  }

  static Future<void> recordCacheSync(String cacheName, String ownerId) async {
    final db = await instance;
    await db.insert(
        'cache_sync_state',
        {
          'cache_name': cacheName,
          'owner_id': ownerId,
          'synced_at': DateTime.now().toUtc().toIso8601String(),
        },
        conflictAlgorithm: ConflictAlgorithm.replace);
  }

  static Future<DateTime?> cacheSyncedAt(
    String cacheName,
    String ownerId,
  ) async {
    final db = await instance;
    final rows = await db.query(
      'cache_sync_state',
      columns: ['synced_at'],
      where: 'cache_name = ? AND owner_id = ?',
      whereArgs: [cacheName, ownerId],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return DateTime.tryParse(rows.first['synced_at'] as String? ?? '');
  }

  @visibleForTesting
  static void useDatabaseForTesting(Database? database) {
    _db = database;
  }
}
