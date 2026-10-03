import 'package:a_health_patient/core/db.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';

class _MigrationExecutor implements DatabaseExecutor {
  final statements = <String>[];

  @override
  Future<void> execute(String sql, [List<Object?>? arguments]) async {
    statements.add(sql);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('upgrades legacy caches and quarantines rows without a known owner',
      () async {
    final db = _MigrationExecutor();

    await Db.upgradeSchema(db, 1);
    expect(
      db.statements.first,
      'ALTER TABLE medication_schedule ADD COLUMN prescription_id TEXT',
    );
    expect(
      db.statements,
      contains('ALTER TABLE medication_schedule ADD COLUMN owner_id TEXT'),
    );
    expect(
      db.statements,
      contains('ALTER TABLE consultation_notes ADD COLUMN owner_id TEXT'),
    );
    expect(
      db.statements,
      contains('ALTER TABLE outbox ADD COLUMN owner_id TEXT'),
    );
    expect(
      db.statements,
      contains(
        "ALTER TABLE outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'failed'",
      ),
    );
    expect(
      db.statements.any((sql) => sql.contains('CREATE TABLE cache_sync_state')),
      isTrue,
    );
    final migratedCount = db.statements.length;

    await Db.upgradeSchema(db, 3);
    expect(db.statements, hasLength(migratedCount));
  });
}
