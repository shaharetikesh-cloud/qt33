import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qt33/src/data/providers.dart';
import 'package:qt33/src/shared/session_provider.dart';

class SessionMobilePage extends ConsumerStatefulWidget {
  const SessionMobilePage({super.key});

  @override
  ConsumerState<SessionMobilePage> createState() => _SessionMobilePageState();
}

class _SessionMobilePageState extends ConsumerState<SessionMobilePage> {
  bool _loading = true;
  int _dailyLog = 0;
  int _faults = 0;
  int _maintenance = 0;
  int _battery = 0;
  int _handover = 0;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    setState(() => _loading = true);
    final repo = ref.read(moduleRecordRepositoryProvider);
    _dailyLog = (await repo.listByModule('daily_log')).length;
    _faults = (await repo.listByModule('fault')).length;
    _maintenance = (await repo.listByModule('maintenance')).length;
    _battery = (await repo.listByModule('battery')).length;
    _handover = (await repo.listByModule('charge_handover')).length;
    if (!mounted) return;
    setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('Session')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Card(
            child: ListTile(
              title: Text(session?.fullName ?? 'Offline User'),
              subtitle: Text('User ID: ${session?.userId ?? 'offline'}'),
              trailing: const Text('Single-user offline'),
            ),
          ),
          const SizedBox(height: 8),
          const Text('Workspace data snapshot', style: TextStyle(fontWeight: FontWeight.w700)),
          _stat('Daily Log records', _dailyLog),
          _stat('Fault records', _faults),
          _stat('Maintenance records', _maintenance),
          _stat('Battery records', _battery),
          _stat('Charge handover records', _handover),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _loadStats,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh stats'),
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, int value) {
    return Card(
      child: ListTile(
        title: Text(label),
        trailing: Text('$value', style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
    );
  }
}
