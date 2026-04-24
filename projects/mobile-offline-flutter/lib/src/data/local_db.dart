import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

class LocalDb {
  LocalDb._();
  static final LocalDb instance = LocalDb._();
  Database? _db;

  Future<Database> get db async {
    if (_db != null) return _db!;
    final dir = await getApplicationDocumentsDirectory();
    final dbPath = p.join(dir.path, 'qt33.db');
    _db = await openDatabase(
      dbPath,
      version: 2,
      onCreate: (database, version) async {
        await _createModuleRecords(database);
        await _createWorkspaceTables(database);
      },
      onUpgrade: (database, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await _createWorkspaceTables(database);
        }
      },
    );
    return _db!;
  }

  static Future<void> _createModuleRecords(Database database) async {
    await database.execute('''
      CREATE TABLE IF NOT EXISTS module_records (
        id TEXT PRIMARY KEY,
        module_key TEXT NOT NULL,
        substation_id TEXT,
        title TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    ''');
    await database.execute('''
      CREATE INDEX IF NOT EXISTS idx_module_records_module
      ON module_records(module_key, updated_at DESC);
    ''');
  }

  static Future<void> _createWorkspaceTables(Database database) async {
    await database.execute('''
      CREATE TABLE IF NOT EXISTS substations (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        om_name TEXT NOT NULL DEFAULT '',
        sub_division_name TEXT NOT NULL DEFAULT '',
        district TEXT NOT NULL DEFAULT '',
        circle TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    ''');
    await database.execute('''
      CREATE INDEX IF NOT EXISTS idx_substations_name ON substations(name COLLATE NOCASE);
    ''');

    await database.execute('''
      CREATE TABLE IF NOT EXISTS master_records (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
    ''');
    await database.execute('''
      CREATE INDEX IF NOT EXISTS idx_master_records_collection
      ON master_records(collection, updated_at DESC);
    ''');

    await database.execute('''
      CREATE TABLE IF NOT EXISTS app_kv (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
    ''');
  }
}
