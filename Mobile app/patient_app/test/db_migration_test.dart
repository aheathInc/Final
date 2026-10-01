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
  test('upgrades v1 cached medication rows with the prescription link column',
      () async {
    final db = _MigrationExecutor();

    await Db.upgradeSchema(db, 1);
    expect(db.statements, [
      'ALTER TABLE medication_schedule ADD COLUMN prescription_id TEXT',
    ]);

    await Db.upgradeSchema(db, 2);
    expect(db.statements, hasLength(1));
  });
}
