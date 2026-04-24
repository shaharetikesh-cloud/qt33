import 'dart:convert';
import 'package:qt33/src/data/local_db.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

class ModuleRecord {
  ModuleRecord({
    required this.id,
    required this.moduleKey,
    required this.title,
    required this.payload,
    required this.createdAt,
    required this.updatedAt,
    this.substationId,
  });

  final String id;
  final String moduleKey;
  final String title;
  final Map<String, dynamic> payload;
  final String? substationId;
  final DateTime createdAt;
  final DateTime updatedAt;
}

class ModuleRecordRepository {
  final _uuid = const Uuid();

  Future<List<ModuleRecord>> listByModule(String moduleKey, {String query = ''}) async {
    final db = await LocalDb.instance.db;
    final q = query.trim();
    final rows = await db.query(
      'module_records',
      where: q.isEmpty
          ? 'module_key = ?'
          : 'module_key = ? AND (title LIKE ? OR payload_json LIKE ?)',
      whereArgs: q.isEmpty ? [moduleKey] : [moduleKey, '%$q%', '%$q%'],
      orderBy: 'updated_at DESC',
      limit: 200,
    );
    return rows.map(_mapRow).toList(growable: false);
  }

  Future<ModuleRecord> upsert({
    String? id,
    required String moduleKey,
    required String title,
    required Map<String, dynamic> payload,
    String? substationId,
  }) async {
    final db = await LocalDb.instance.db;
    final now = DateTime.now().toUtc();
    final recordId = id ?? _uuid.v4();

    final existing = await db.query('module_records', where: 'id = ?', whereArgs: [recordId], limit: 1);
    final createdAt = existing.isEmpty ? now : DateTime.parse(existing.first['created_at'] as String);

    await db.insert(
      'module_records',
      {
        'id': recordId,
        'module_key': moduleKey,
        'substation_id': substationId,
        'title': title,
        'payload_json': jsonEncode(payload),
        'created_at': createdAt.toIso8601String(),
        'updated_at': now.toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );

    return ModuleRecord(
      id: recordId,
      moduleKey: moduleKey,
      title: title,
      payload: payload,
      substationId: substationId,
      createdAt: createdAt,
      updatedAt: now,
    );
  }

  Future<void> delete(String id) async {
    final db = await LocalDb.instance.db;
    await db.delete('module_records', where: 'id = ?', whereArgs: [id]);
  }

  ModuleRecord _mapRow(Map<String, Object?> row) {
    return ModuleRecord(
      id: row['id'] as String,
      moduleKey: row['module_key'] as String,
      substationId: row['substation_id'] as String?,
      title: (row['title'] as String?) ?? '',
      payload: jsonDecode(row['payload_json'] as String) as Map<String, dynamic>,
      createdAt: DateTime.parse(row['created_at'] as String),
      updatedAt: DateTime.parse(row['updated_at'] as String),
    );
  }
}
