import 'dart:convert';

import 'package:qt33/src/data/local_db.dart';
import 'package:qt33/src/domain/default_settings.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

const _kSettings = 'settings_bundle';
const _kUsers = 'users_local';
const _kLastModule = 'last_module_key';

class WorkspaceRepository {
  WorkspaceRepository({Uuid? uuid}) : _uuid = uuid ?? const Uuid();
  final Uuid _uuid;

  Future<Database> get _db => LocalDb.instance.db;

  // --- Substations (web SubstationsPage + localApi substation shape) ---

  Future<List<Map<String, dynamic>>> listSubstations() async {
    final db = await _db;
    final rows = await db.query('substations', orderBy: 'name COLLATE NOCASE ASC');
    return rows.map(_rowToSubstation).toList(growable: false);
  }

  Map<String, dynamic> _rowToSubstation(Map<String, Object?> r) => {
        'id': r['id'],
        'code': r['code'] ?? '',
        'name': r['name'],
        'omName': r['om_name'] ?? '',
        'subDivisionName': r['sub_division_name'] ?? '',
        'district': r['district'] ?? '',
        'circle': r['circle'] ?? '',
        'createdAt': r['created_at'],
        'updatedAt': r['updated_at'],
      };

  Future<Map<String, dynamic>> upsertSubstation({
    String? id,
    required String code,
    required String name,
    String omName = '',
    String subDivisionName = '',
    String district = '',
    String circle = '',
  }) async {
    final db = await _db;
    final now = DateTime.now().toUtc().toIso8601String();
    final sid = id ?? _uuid.v4();
    final existing = await db.query('substations', where: 'id = ?', whereArgs: [sid], limit: 1);
    final createdAt = existing.isEmpty ? now : (existing.first['created_at'] as String);

    await db.insert(
      'substations',
      {
        'id': sid,
        'code': code.trim(),
        'name': name.trim(),
        'om_name': omName.trim(),
        'sub_division_name': subDivisionName.trim(),
        'district': district.trim(),
        'circle': circle.trim(),
        'created_at': createdAt,
        'updated_at': now,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );

    final row = (await db.query('substations', where: 'id = ?', whereArgs: [sid])).first;
    return _rowToSubstation(row);
  }

  Future<void> deleteSubstation(String id) async {
    final db = await _db;
    await db.delete('substations', where: 'id = ?', whereArgs: [id]);
  }

  // --- Master collections: divisions, feeders, batterySets, transformers ---

  Future<List<Map<String, dynamic>>> listMasterRecords(String collection) async {
    final db = await _db;
    final rows = await db.query(
      'master_records',
      where: 'collection = ?',
      whereArgs: [collection],
      orderBy: 'updated_at DESC',
    );
    return rows
        .map((r) => jsonDecode(r['payload_json'] as String) as Map<String, dynamic>)
        .toList(growable: false);
  }

  Future<Map<String, dynamic>> upsertMasterRecord(
    String collection,
    Map<String, dynamic> record, {
    String? id,
  }) async {
    final db = await _db;
    final now = DateTime.now().toUtc().toIso8601String();
    final incomingId = (id ?? record['id']?.toString() ?? '').toString();
    final rid = incomingId.trim().isEmpty ? _uuid.v4() : incomingId;
    final payload = {...record, 'id': rid};

    final existing = await db.query(
      'master_records',
      where: 'collection = ? AND id = ?',
      whereArgs: [collection, rid],
      limit: 1,
    );
    final createdAt = existing.isEmpty ? now : (existing.first['created_at'] as String);

    await db.insert(
      'master_records',
      {
        'collection': collection,
        'id': rid,
        'payload_json': jsonEncode(payload),
        'created_at': createdAt,
        'updated_at': now,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );

    return Map<String, dynamic>.from(payload);
  }

  Future<void> deleteMasterRecord(String collection, String id) async {
    final db = await _db;
    await db.delete(
      'master_records',
      where: 'collection = ? AND id = ?',
      whereArgs: [collection, id],
    );
  }

  // --- Settings bundle (web getSettingsBundle / saveSettingsBundle) ---

  Future<Map<String, dynamic>> getSettingsBundle() async {
    final db = await _db;
    final rows = await db.query('app_kv', where: 'k = ?', whereArgs: [_kSettings], limit: 1);
    if (rows.isEmpty) {
      final defaults = defaultSettingsBundle();
      await saveSettingsBundle(defaults);
      return defaults;
    }
    final raw = rows.first['v'] as String;
    final parsed = jsonDecode(raw) as Map<String, dynamic>;
    return _mergeSettingsDefaults(parsed);
  }

  Map<String, dynamic> _mergeSettingsDefaults(Map<String, dynamic> stored) {
    final base = defaultSettingsBundle();
    return {
      'companyProfile': {...base['companyProfile'] as Map, ...(stored['companyProfile'] as Map? ?? {})},
      'printSettings': {...base['printSettings'] as Map, ...(stored['printSettings'] as Map? ?? {})},
      'attendanceRules': {...base['attendanceRules'] as Map, ...(stored['attendanceRules'] as Map? ?? {})},
    };
  }

  Future<void> saveSettingsBundle(Map<String, dynamic> settings) async {
    final db = await _db;
    final merged = _mergeSettingsDefaults(settings);
    await db.insert(
      'app_kv',
      {'k': _kSettings, 'v': jsonEncode(merged)},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // --- Local users (single-user offline with optional staff accounts) ---

  Future<List<Map<String, dynamic>>> listLocalUsers() async {
    final db = await _db;
    final rows = await db.query('app_kv', where: 'k = ?', whereArgs: [_kUsers], limit: 1);
    if (rows.isEmpty) {
      return [];
    }
    final raw = rows.first['v'] as String;
    final parsed = jsonDecode(raw);
    if (parsed is! List) return [];
    return parsed
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }

  Future<void> saveLocalUsers(List<Map<String, dynamic>> users) async {
    final db = await _db;
    await db.insert(
      'app_kv',
      {'k': _kUsers, 'v': jsonEncode(users)},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<Map<String, dynamic>> upsertLocalUser(Map<String, dynamic> user, {String? id}) async {
    final users = await listLocalUsers();
    final now = DateTime.now().toUtc().toIso8601String();
    final uid = (id ?? user['id']?.toString() ?? '').trim().isEmpty
        ? _uuid.v4()
        : (id ?? user['id']).toString();
    final nextUser = {
      ...user,
      'id': uid,
      'updatedAt': now,
      'createdAt': user['createdAt'] ?? now,
    };
    final idx = users.indexWhere((item) => item['id']?.toString() == uid);
    if (idx >= 0) {
      users[idx] = {...users[idx], ...nextUser};
    } else {
      users.insert(0, nextUser);
    }
    await saveLocalUsers(users);
    return nextUser;
  }

  Future<void> deleteLocalUser(String id) async {
    final users = await listLocalUsers();
    users.removeWhere((item) => item['id']?.toString() == id);
    await saveLocalUsers(users);
  }

  // --- Lightweight app state ---

  Future<String?> getLastModuleKey() async {
    final db = await _db;
    final rows = await db.query('app_kv', where: 'k = ?', whereArgs: [_kLastModule], limit: 1);
    if (rows.isEmpty) return null;
    final v = (rows.first['v'] ?? '').toString().trim();
    return v.isEmpty ? null : v;
  }

  Future<void> setLastModuleKey(String moduleKey) async {
    final db = await _db;
    await db.insert(
      'app_kv',
      {'k': _kLastModule, 'v': moduleKey.trim()},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Full backup shape aligned with web `buildBackupSnapshot` (local JSON mode).
  Future<Map<String, dynamic>> buildBackupSnapshot() async {
    final masters = <String, dynamic>{
      'divisions': await listMasterRecords('divisions'),
      'feeders': await listMasterRecords('feeders'),
      'batterySets': await listMasterRecords('batterySets'),
      'transformers': await listMasterRecords('transformers'),
    };

    final db = await _db;
    final modRows = await db.query('module_records', orderBy: 'updated_at DESC');
    final dlrRecords = modRows
        .map(
          (r) => {
            'id': r['id'],
            'moduleName': r['module_key'],
            'substationId': r['substation_id'],
            'title': r['title'],
            'payload': jsonDecode(r['payload_json'] as String),
            'createdAt': r['created_at'],
            'updatedAt': r['updated_at'],
          },
        )
        .toList();

    return {
      'exportedAt': DateTime.now().toUtc().toIso8601String(),
      'masters': masters,
      'settings': await getSettingsBundle(),
      'userSubstationMappings': <Map<String, dynamic>>[],
      'attendanceDocuments': <Map<String, dynamic>>[],
      'dlrRecords': dlrRecords,
      'reportSnapshots': <Map<String, dynamic>>[],
      'notices': <Map<String, dynamic>>[],
      'feedbackEntries': <Map<String, dynamic>>[],
      'auditEvents': <Map<String, dynamic>>[],
      'referenceCache': {
        'substations': await listSubstations(),
        'employees': <Map<String, dynamic>>[],
        'updatedAt': DateTime.now().toUtc().toIso8601String(),
      },
      'substations': await listSubstations(),
    };
  }

  Future<void> importBackupSnapshot(Map<String, dynamic> snapshot) async {
    final db = await _db;
    await db.transaction((txn) async {
      await txn.delete('substations');
      await txn.delete('master_records');
      await txn.delete('module_records');

      final subs = (snapshot['substations'] as List?) ??
          (snapshot['referenceCache'] is Map ? (snapshot['referenceCache'] as Map)['substations'] as List? : null) ??
          [];
      for (final raw in subs) {
        if (raw is! Map) continue;
        final m = Map<String, dynamic>.from(raw);
        await txn.insert('substations', {
          'id': m['id']?.toString() ?? _uuid.v4(),
          'code': (m['code'] ?? '').toString(),
          'name': (m['name'] ?? '').toString(),
          'om_name': (m['omName'] ?? m['om_name'] ?? '').toString(),
          'sub_division_name': (m['subDivisionName'] ?? m['sub_division_name'] ?? '').toString(),
          'district': (m['district'] ?? '').toString(),
          'circle': (m['circle'] ?? '').toString(),
          'created_at': (m['createdAt'] ?? m['created_at'] ?? DateTime.now().toUtc().toIso8601String()).toString(),
          'updated_at': (m['updatedAt'] ?? m['updated_at'] ?? DateTime.now().toUtc().toIso8601String()).toString(),
        });
      }

      final masters = snapshot['masters'] as Map?;
      if (masters != null) {
        for (final type in ['divisions', 'feeders', 'batterySets', 'transformers']) {
          final list = masters[type] as List? ?? [];
          for (final raw in list) {
            if (raw is! Map) continue;
            final rec = Map<String, dynamic>.from(raw);
            final id = rec['id']?.toString();
            if (id == null || id.isEmpty) continue;
            await txn.insert(
              'master_records',
              {
                'collection': type,
                'id': id,
                'payload_json': jsonEncode(rec),
                'created_at':
                    (rec['createdAt'] ?? rec['created_at'] ?? DateTime.now().toUtc().toIso8601String()).toString(),
                'updated_at':
                    (rec['updatedAt'] ?? rec['updated_at'] ?? DateTime.now().toUtc().toIso8601String()).toString(),
              },
              conflictAlgorithm: ConflictAlgorithm.replace,
            );
          }
        }
      }

      if (snapshot['settings'] is Map) {
        final s = Map<String, dynamic>.from(snapshot['settings'] as Map);
        await txn.insert(
          'app_kv',
          {'k': _kSettings, 'v': jsonEncode(_mergeSettingsDefaults(s))},
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }

      final dlr = snapshot['dlrRecords'] as List? ?? [];
      for (final raw in dlr) {
        if (raw is! Map) continue;
        final m = Map<String, dynamic>.from(raw);
        final id = m['id']?.toString();
        if (id == null || id.isEmpty) continue;
        final payload = m['payload'] is Map ? m['payload'] as Map : <String, dynamic>{};
        await txn.insert(
          'module_records',
          {
            'id': id,
            'module_key': (m['moduleName'] ?? m['module_key'] ?? 'daily_log').toString(),
            'substation_id': m['substationId']?.toString(),
            'title': (m['title'] ?? '').toString(),
            'payload_json': jsonEncode(payload),
            'created_at': (m['createdAt'] ?? m['created_at'] ?? DateTime.now().toUtc().toIso8601String()).toString(),
            'updated_at': (m['updatedAt'] ?? m['updated_at'] ?? DateTime.now().toUtc().toIso8601String()).toString(),
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
  }
}
