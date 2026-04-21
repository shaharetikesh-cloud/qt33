// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/providers.dart';

class FaultsMobilePage extends ConsumerStatefulWidget {
  const FaultsMobilePage({super.key});

  @override
  ConsumerState<FaultsMobilePage> createState() => _FaultsMobilePageState();
}

class _FaultsMobilePageState extends ConsumerState<FaultsMobilePage> {
  final _date = TextEditingController(text: DateFormat('yyyy-MM-dd').format(DateTime.now()));
  final _from = TextEditingController();
  final _to = TextEditingController();
  final _faultType = TextEditingController();
  final _cause = TextEditingController();
  final _remark = TextEditingController();
  String _substationId = '';
  String _feederId = '';

  List<Map<String, dynamic>> _substations = [];
  List<Map<String, dynamic>> _feeders = [];
  List<ModuleRecord> _records = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final ws = ref.read(workspaceRepositoryProvider);
    final repo = ref.read(moduleRecordRepositoryProvider);
    _substations = await ws.listSubstations();
    _feeders = await ws.listMasterRecords('feeders');
    _records = await repo.listByModule('fault');
    if (_substationId.isEmpty && _substations.isNotEmpty) {
      _substationId = _substations.first['id']?.toString() ?? '';
    }
    if (!mounted) return;
    setState(() => _loading = false);
  }

  List<Map<String, dynamic>> get _substationFeeders =>
      _feeders.where((f) => (f['substationId'] ?? '').toString() == _substationId).toList();

  int? _durationMinutes() {
    final fromParts = _from.text.split(':');
    final toParts = _to.text.split(':');
    if (fromParts.length != 2 || toParts.length != 2) return null;
    final fh = int.tryParse(fromParts[0]);
    final fm = int.tryParse(fromParts[1]);
    final th = int.tryParse(toParts[0]);
    final tm = int.tryParse(toParts[1]);
    if (fh == null || fm == null || th == null || tm == null) return null;
    final a = fh * 60 + fm;
    final b = th * 60 + tm;
    if (b < a) return null;
    return b - a;
  }

  Future<void> _save() async {
    final dur = _durationMinutes();
    if (_substationId.isEmpty || _feederId.isEmpty || _from.text.isEmpty || _to.text.isEmpty) return;
    final feederName = _substationFeeders
        .where((f) => f['id']?.toString() == _feederId)
        .map((f) => (f['name'] ?? '').toString())
        .firstOrNull;
    await ref.read(moduleRecordRepositoryProvider).upsert(
          moduleKey: 'fault',
          substationId: _substationId,
          title: '${_date.text} ${feederName ?? 'Fault'}',
          payload: {
            'operationalDate': _date.text,
            'fromTime': _from.text,
            'toTime': _to.text,
            'feederId': _feederId,
            'faultType': _faultType.text.trim(),
            'cause': _cause.text.trim(),
            'durationMinutes': dur,
            'remark': _remark.text.trim(),
          },
        );
    final monthKey = _date.text.trim().length >= 7 ? _date.text.trim().substring(0, 7) : '';
    if (monthKey.isNotEmpty && _substationId.isNotEmpty) {
      await ref.read(monthlyReportAutomationServiceProvider).regenerateForMonth(
            substationId: _substationId,
            monthKey: monthKey,
          );
    }
    _faultType.clear();
    _cause.clear();
    _remark.clear();
    _from.clear();
    _to.clear();
    _reload();
  }

  Future<void> _exportDayPdf() async {
    final sub = _substations.where((s) => s['id']?.toString() == _substationId).firstOrNull;
    final dayRecords = _records.where((r) {
      return r.substationId == _substationId && (r.payload['operationalDate'] ?? '') == _date.text;
    }).toList();
    final rows = <Map<String, String>>[];
    for (final r in dayRecords) {
      final feeder = _feeders.where((f) => f['id']?.toString() == (r.payload['feederId'] ?? '')).firstOrNull;
      rows.add({
        'field': '${r.payload['fromTime'] ?? '-'} - ${r.payload['toTime'] ?? '-'}',
        'value': '${feeder?['name'] ?? '-'} | ${r.payload['faultType'] ?? '-'} | ${r.payload['cause'] ?? '-'}',
      });
    }
    final file = await ref.read(pdfExportServiceProvider).createA4Report(
          title: 'fault-${_date.text}-${sub?['name'] ?? 'substation'}',
          rows: rows.isEmpty ? [{'field': 'Info', 'value': 'No records'}] : rows,
        );
    await ref.read(pdfExportServiceProvider).shareFile(file);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final dayRecords = _records.where((r) {
      return r.substationId == _substationId && (r.payload['operationalDate'] ?? '') == _date.text;
    }).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Fault Register')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          TextField(controller: _date, decoration: const InputDecoration(labelText: 'Date')),
          DropdownButtonFormField<String>(
            value: _substationId.isEmpty ? null : _substationId,
            decoration: const InputDecoration(labelText: 'Substation'),
            items: _substations
                .map((s) => DropdownMenuItem(value: s['id']?.toString(), child: Text((s['name'] ?? '').toString())))
                .toList(),
            onChanged: (v) => setState(() {
              _substationId = v ?? '';
              _feederId = '';
            }),
          ),
          Row(
            children: [
              Expanded(child: TextField(controller: _from, decoration: const InputDecoration(labelText: 'From HH:MM'))),
              const SizedBox(width: 8),
              Expanded(child: TextField(controller: _to, decoration: const InputDecoration(labelText: 'To HH:MM'))),
            ],
          ),
          DropdownButtonFormField<String>(
            value: _feederId.isEmpty ? null : _feederId,
            decoration: const InputDecoration(labelText: 'Feeder'),
            items: _substationFeeders
                .map((f) => DropdownMenuItem(value: f['id']?.toString(), child: Text((f['name'] ?? '').toString())))
                .toList(),
            onChanged: (v) => setState(() => _feederId = v ?? ''),
          ),
          Wrap(
            spacing: 6,
            children: ['LS', 'SD', 'OC', 'EF', 'BD', 'Tripping']
                .map((f) => ActionChip(label: Text(f), onPressed: () => _faultType.text = f))
                .toList(),
          ),
          TextField(controller: _faultType, decoration: const InputDecoration(labelText: 'Fault type')),
          TextField(controller: _cause, decoration: const InputDecoration(labelText: 'Cause')),
          TextField(controller: _remark, decoration: const InputDecoration(labelText: 'Remark')),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            FilledButton(onPressed: _save, child: const Text('Save fault entry')),
            OutlinedButton(onPressed: _exportDayPdf, child: const Text('Share PDF')),
          ]),
          const Divider(),
          const Text('Saved fault rows', style: TextStyle(fontWeight: FontWeight.w700)),
          ...dayRecords.map((r) {
            final feeder = _feeders.where((f) => f['id']?.toString() == (r.payload['feederId'] ?? '')).firstOrNull;
            return ListTile(
              title: Text('${r.payload['fromTime'] ?? '-'} - ${r.payload['toTime'] ?? '-'}'),
              subtitle: Text('${feeder?['name'] ?? '-'} | ${r.payload['faultType'] ?? '-'} | ${r.payload['cause'] ?? '-'}'),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () async {
                  await ref.read(moduleRecordRepositoryProvider).delete(r.id);
                  _reload();
                },
              ),
            );
          }),
        ],
      ),
    );
  }
}
