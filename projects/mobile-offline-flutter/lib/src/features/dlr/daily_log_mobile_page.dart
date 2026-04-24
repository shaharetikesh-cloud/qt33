// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/providers.dart';

class DailyLogMobilePage extends ConsumerStatefulWidget {
  const DailyLogMobilePage({super.key});

  @override
  ConsumerState<DailyLogMobilePage> createState() => _DailyLogMobilePageState();
}

class _DailyLogMobilePageState extends ConsumerState<DailyLogMobilePage> {
  final _date = TextEditingController(text: DateFormat('yyyy-MM-dd').format(DateTime.now()));
  final _shift = TextEditingController(text: 'General');
  final _operator = TextEditingController();
  final _inCharge = TextEditingController();
  String _dayStatus = 'draft';
  String _substationId = '';
  String _editingId = '';
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _interruptions = [];
  List<Map<String, dynamic>> _meterChanges = [];
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
    _records = await repo.listByModule('daily_log');
    if (_substationId.isEmpty && _substations.isNotEmpty) {
      _substationId = _substations.first['id']?.toString() ?? '';
    }
    if (!mounted) return;
    setState(() => _loading = false);
  }

  List<Map<String, dynamic>> get _substationFeeders =>
      _feeders.where((f) => (f['substationId'] ?? '').toString() == _substationId).toList();

  Future<void> _save({bool finalize = false}) async {
    final repo = ref.read(moduleRecordRepositoryProvider);
    final payload = {
      'operationalDate': _date.text,
      'shift': _shift.text.trim(),
      'operatorName': _operator.text.trim(),
      'inChargeName': _inCharge.text.trim(),
      'dayStatus': finalize ? 'finalized' : _dayStatus,
      'rows': _rows,
      'interruptions': _interruptions,
      'meterChangeEvents': _meterChanges,
    };
    final saved = await repo.upsert(
      id: _editingId.isEmpty ? null : _editingId,
      moduleKey: 'daily_log',
      substationId: _substationId,
      title: '${_date.text} $_substationId',
      payload: payload,
    );
    if (!mounted) return;
    setState(() {
      _editingId = saved.id;
      _dayStatus = finalize ? 'finalized' : _dayStatus;
    });
    _reload();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(finalize ? 'Day finalized' : 'Daily log saved')),
    );
  }

  void _edit(ModuleRecord r) {
    final p = r.payload;
    setState(() {
      _editingId = r.id;
      _substationId = r.substationId ?? '';
      _date.text = (p['operationalDate'] ?? '').toString();
      _shift.text = (p['shift'] ?? '').toString();
      _operator.text = (p['operatorName'] ?? '').toString();
      _inCharge.text = (p['inChargeName'] ?? '').toString();
      _dayStatus = (p['dayStatus'] ?? 'draft').toString();
      _rows = ((p['rows'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      _interruptions = ((p['interruptions'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      _meterChanges = ((p['meterChangeEvents'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    });
  }

  void _newDraft() {
    setState(() {
      _editingId = '';
      _shift.text = 'General';
      _operator.clear();
      _inCharge.clear();
      _dayStatus = 'draft';
      _rows = [];
      _interruptions = [];
      _meterChanges = [];
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('Daily Log')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          DropdownButtonFormField<String>(
            value: _substationId.isEmpty ? null : _substationId,
            decoration: const InputDecoration(labelText: 'Substation'),
            items: _substations
                .map((s) => DropdownMenuItem(value: s['id']?.toString(), child: Text((s['name'] ?? '').toString())))
                .toList(),
            onChanged: (v) => setState(() => _substationId = v ?? ''),
          ),
          TextField(controller: _date, decoration: const InputDecoration(labelText: 'Date')),
          TextField(controller: _shift, decoration: const InputDecoration(labelText: 'Shift')),
          TextField(controller: _operator, decoration: const InputDecoration(labelText: 'Operator')),
          TextField(controller: _inCharge, decoration: const InputDecoration(labelText: 'In-charge')),
          DropdownButtonFormField<String>(
            value: _dayStatus,
            decoration: const InputDecoration(labelText: 'Status'),
            items: const [
              DropdownMenuItem(value: 'draft', child: Text('Draft')),
              DropdownMenuItem(value: 'finalized', child: Text('Finalized')),
            ],
            onChanged: (v) => setState(() => _dayStatus = v ?? 'draft'),
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            FilledButton(onPressed: () => _save(), child: const Text('Save Data')),
            FilledButton.tonal(onPressed: () => _save(finalize: true), child: const Text('Finalize Day')),
            OutlinedButton(onPressed: _newDraft, child: const Text('New Draft')),
          ]),
          const Divider(),
          _DynamicRowsCard(
            title: 'Hourly feeder rows',
            columns: const ['time', 'feederId', 'kwh', 'amp', 'kv', 'remark'],
            feeders: _substationFeeders,
            rows: _rows,
            onChanged: (v) => setState(() => _rows = v),
          ),
          _DynamicRowsCard(
            title: 'Interruptions',
            columns: const ['feederId', 'from_time', 'to_time', 'event_type', 'remark'],
            feeders: _substationFeeders,
            rows: _interruptions,
            onChanged: (v) => setState(() => _interruptions = v),
          ),
          _DynamicRowsCard(
            title: 'Meter changes',
            columns: const ['feederId', 'effective_time', 'oldMeterLastReading', 'newMeterStartReading', 'remark'],
            feeders: _substationFeeders,
            rows: _meterChanges,
            onChanged: (v) => setState(() => _meterChanges = v),
          ),
          const Divider(),
          const Text('Daily register', style: TextStyle(fontWeight: FontWeight.w700)),
          ..._records.map((r) {
            final p = r.payload;
            return Card(
              child: ListTile(
                title: Text(r.title),
                subtitle: Text('Date: ${p['operationalDate'] ?? '-'} | Status: ${p['dayStatus'] ?? 'draft'}'),
                onTap: () => _edit(r),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    await ref.read(moduleRecordRepositoryProvider).delete(r.id);
                    if (!mounted) return;
                    if (_editingId == r.id) _newDraft();
                    _reload();
                  },
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _DynamicRowsCard extends StatelessWidget {
  const _DynamicRowsCard({
    required this.title,
    required this.columns,
    required this.rows,
    required this.feeders,
    required this.onChanged,
  });

  final String title;
  final List<String> columns;
  final List<Map<String, dynamic>> rows;
  final List<Map<String, dynamic>> feeders;
  final ValueChanged<List<Map<String, dynamic>>> onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ...rows.asMap().entries.map((entry) {
              final i = entry.key;
              final row = entry.value;
              return Card(
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: Column(
                    children: [
                      ...columns.map((c) {
                        if (c == 'feederId') {
                          return DropdownButtonFormField<String>(
                            value: (row[c] ?? '').toString().isEmpty ? null : row[c].toString(),
                            decoration: const InputDecoration(labelText: 'Feeder'),
                            items: feeders
                                .map((f) => DropdownMenuItem(value: f['id']?.toString(), child: Text((f['name'] ?? '').toString())))
                                .toList(),
                            onChanged: (v) {
                              final next = [...rows];
                              next[i] = {...next[i], c: v ?? ''};
                              onChanged(next);
                            },
                          );
                        }
                        return TextFormField(
                          initialValue: (row[c] ?? '').toString(),
                          decoration: InputDecoration(labelText: c),
                          onChanged: (v) {
                            final next = [...rows];
                            next[i] = {...next[i], c: v};
                            onChanged(next);
                          },
                        );
                      }),
                      Align(
                        alignment: Alignment.centerRight,
                        child: IconButton(
                          onPressed: () {
                            final next = [...rows]..removeAt(i);
                            onChanged(next);
                          },
                          icon: const Icon(Icons.delete_outline),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
            OutlinedButton.icon(
              onPressed: () {
                final map = <String, dynamic>{for (final c in columns) c: ''};
                onChanged([...rows, map]);
              },
              icon: const Icon(Icons.add),
              label: const Text('Add row'),
            ),
          ],
        ),
      ),
    );
  }
}
