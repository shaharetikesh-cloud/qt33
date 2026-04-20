import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/providers.dart';
import 'package:qt33/src/shared/module_registry.dart';

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _tab = 0;
  bool _loading = true;
  final Map<String, int> _counts = {};
  List<ModuleRecord> _recent = [];
  String _lastModuleKey = '';

  static const _tabs = ['operations', 'reports', 'admin'];
  static const _trackedModules = [
    'daily_log',
    'battery',
    'fault',
    'faults',
    'maintenance',
    'charge_handover',
    'history_register',
    'asset_master',
    'asset_history',
  ];

  @override
  void initState() {
    super.initState();
    _reloadStats();
  }

  Future<void> _reloadStats() async {
    setState(() => _loading = true);
    final repo = ref.read(moduleRecordRepositoryProvider);
    final ws = ref.read(workspaceRepositoryProvider);
    final all = <ModuleRecord>[];
    final counts = <String, int>{};
    for (final key in _trackedModules) {
      final rows = await repo.listByModule(key);
      counts[key] = rows.length;
      all.addAll(rows);
    }
    all.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    if (!mounted) return;
    final lastModule = await ws.getLastModuleKey() ?? '';
    if (!mounted) return;
    setState(() {
      _counts
        ..clear()
        ..addAll(counts);
      _recent = all.take(6).toList(growable: false);
      _lastModuleKey = lastModule;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final activeGroup = _tabs[_tab];
    final items = qt33Modules
        .where((m) => m.group == activeGroup && m.key != 'notices' && m.key != 'feedback')
        .toList(growable: false);

    return Scaffold(
      appBar: AppBar(
        title: const Text('QT33 Mobile'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            const Text('Quick actions', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _quickChip(context, 'Daily Log', 'daily_log', Icons.today),
                _quickChip(context, 'Fault', 'faults', Icons.warning_amber),
                _quickChip(context, 'Masters', 'masters', Icons.dataset),
                _quickChip(context, 'Report Center', 'reports', Icons.assessment),
              ],
            ),
            if (_lastModuleKey.isNotEmpty) ...[
              const SizedBox(height: 8),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.play_arrow),
                  title: const Text('Resume last module'),
                  subtitle: Text(_labelForModule(_lastModuleKey)),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _openModule(_lastModuleKey),
                ),
              ),
            ],
            const SizedBox(height: 12),
            if (_loading)
              const Card(
                child: ListTile(
                  leading: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  title: Text('Loading dashboard snapshot...'),
                ),
              )
            else ...[
              Row(
                children: [
                  const Text('Recent activity', style: TextStyle(fontWeight: FontWeight.w700)),
                  const Spacer(),
                  IconButton(
                    onPressed: _reloadStats,
                    icon: const Icon(Icons.refresh),
                    tooltip: 'Refresh dashboard',
                  ),
                ],
              ),
              if (_recent.isEmpty)
                const Card(
                  child: ListTile(
                    title: Text('No recent records'),
                    subtitle: Text('Start entry from quick actions above'),
                  ),
                )
              else
                ..._recent.map(
                  (r) => Card(
                    child: ListTile(
                      title: Text(r.title.isEmpty ? r.moduleKey : r.title),
                      subtitle: Text('Module: ${r.moduleKey}'),
                      trailing: Text(
                        '${r.updatedAt.day.toString().padLeft(2, '0')}/${r.updatedAt.month.toString().padLeft(2, '0')}',
                      ),
                    ),
                  ),
                ),
            ],
            const Divider(height: 24),
            const Text('Modules', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            ...items.map((module) {
              final count = _moduleCount(module.key);
              return Card(
                child: ListTile(
                  title: Text(module.title),
                  subtitle: Text('Module: ${module.key}'),
                  trailing: Wrap(
                    spacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (count >= 0) Text('$count'),
                      const Icon(Icons.chevron_right),
                    ],
                  ),
                  onTap: () => _openModule(module.key),
                ),
              );
            }),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (v) => setState(() => _tab = v),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.construction), label: 'Operations'),
          NavigationDestination(icon: Icon(Icons.assessment), label: 'Reports'),
          NavigationDestination(icon: Icon(Icons.admin_panel_settings), label: 'Admin'),
        ],
      ),
    );
  }

  Widget _quickChip(BuildContext context, String label, String key, IconData icon) {
    return ActionChip(
      avatar: Icon(icon, size: 18),
      label: Text(label),
      onPressed: () => _openModule(key),
    );
  }

  Future<void> _openModule(String key) async {
    await ref.read(workspaceRepositoryProvider).setLastModuleKey(key);
    if (!mounted) return;
    context.push('/module/$key');
  }

  String _labelForModule(String key) {
    final match = qt33Modules.where((m) => m.key == key).firstOrNull;
    if (match == null) return key;
    return '${match.title} (${match.key})';
  }

  int _moduleCount(String moduleKey) {
    if (_loading) return -1;
    if (moduleKey == 'faults') {
      return (_counts['faults'] ?? 0) + (_counts['fault'] ?? 0);
    }
    if (moduleKey == 'history_register') {
      return (_counts['asset_master'] ?? 0);
    }
    return _counts[moduleKey] ?? 0;
  }
}
