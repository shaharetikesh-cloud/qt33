// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/providers.dart';

class BatteryMobilePage extends ConsumerStatefulWidget {
  const BatteryMobilePage({super.key});

  @override
  ConsumerState<BatteryMobilePage> createState() => _BatteryMobilePageState();
}

class _BatteryMobilePageState extends ConsumerState<BatteryMobilePage> {
  final _date = TextEditingController(text: DateFormat('yyyy-MM-dd').format(DateTime.now()));
  final _operator = TextEditingController();
  final _inCharge = TextEditingController();
  String _substationId = '';
  String _batterySetId = '';
  String _editingId = '';
  List<Map<String, dynamic>> _cells = List.generate(
    24,
    (_) => {'specificGravity': '', 'voltage': '', 'condition': '', 'remark': ''},
  );
  final Map<String, bool> _checklist = {
    'Terminal cleaned': true,
    'Electrolyte level checked': true,
    'Vent plugs checked': true,
    'Float charger healthy': true,
  };

  List<Map<String, dynamic>> _substations = [];
  List<Map<String, dynamic>> _batterySets = [];
  List<ModuleRecord> _records = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  String _calcCondition(String sgRaw, String vRaw) {
    final sg = num.tryParse(sgRaw);
    final v = num.tryParse(vRaw);
    if (sg == null || v == null) return '';
    if (sg >= 1.2 && v >= 2.0) return 'Good';
    if (sg >= 1.14 && v >= 1.85) return 'Average';
    return 'Weak';
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final ws = ref.read(workspaceRepositoryProvider);
    final repo = ref.read(moduleRecordRepositoryProvider);
    _substations = await ws.listSubstations();
    _batterySets = await ws.listMasterRecords('batterySets');
    _records = await repo.listByModule('battery');
    if (_substationId.isEmpty && _substations.isNotEmpty) {
      _substationId = _substations.first['id']?.toString() ?? '';
    }
    if (!mounted) return;
    setState(() => _loading = false);
  }

  List<Map<String, dynamic>> get _filteredSets =>
      _batterySets.where((s) => (s['substationId'] ?? '').toString() == _substationId).toList();

  Future<void> _save() async {
    final repo = ref.read(moduleRecordRepositoryProvider);
    final setName = _batterySets
        .where((s) => s['id']?.toString() == _batterySetId)
        .map((s) => (s['name'] ?? '').toString())
        .firstOrNull;
    final saved = await repo.upsert(
      id: _editingId.isEmpty ? null : _editingId,
      moduleKey: 'battery',
      substationId: _substationId,
      title: '${_date.text} ${setName ?? 'Battery'}',
      payload: {
        'operationalDate': _date.text,
        'batterySetId': _batterySetId,
        'operatorName': _operator.text.trim(),
        'inChargeName': _inCharge.text.trim(),
        'checklist': _checklist,
        'cells': _cells,
      },
    );
    if (!mounted) return;
    setState(() => _editingId = saved.id);
    _reload();
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Battery record saved')));
  }

  void _edit(ModuleRecord r) {
    final p = r.payload;
    setState(() {
      _editingId = r.id;
      _date.text = (p['operationalDate'] ?? '').toString();
      _substationId = r.substationId ?? '';
      _batterySetId = (p['batterySetId'] ?? '').toString();
      _operator.text = (p['operatorName'] ?? '').toString();
      _inCharge.text = (p['inChargeName'] ?? '').toString();
      final pChecklist = (p['checklist'] as Map?) ?? {};
      for (final key in _checklist.keys) {
        _checklist[key] = pChecklist[key] == true;
      }
      final pCells = (p['cells'] as List?) ?? [];
      _cells = pCells.isEmpty
          ? _cells
          : pCells.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('Battery Maintenance')),
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
              _batterySetId = '';
            }),
          ),
          DropdownButtonFormField<String>(
            value: _batterySetId.isEmpty ? null : _batterySetId,
            decoration: const InputDecoration(labelText: 'Battery set'),
            items: _filteredSets
                .map((s) => DropdownMenuItem(value: s['id']?.toString(), child: Text((s['name'] ?? '').toString())))
                .toList(),
            onChanged: (v) => setState(() => _batterySetId = v ?? ''),
          ),
          TextField(controller: _operator, decoration: const InputDecoration(labelText: 'Operator')),
          TextField(controller: _inCharge, decoration: const InputDecoration(labelText: 'In-charge')),
          const SizedBox(height: 8),
          ..._checklist.keys.map((key) => SwitchListTile(
                value: _checklist[key] == true,
                title: Text(key),
                onChanged: (v) => setState(() => _checklist[key] = v),
              )),
          const Divider(),
          const Text('Cell entries', style: TextStyle(fontWeight: FontWeight.w700)),
          ..._cells.asMap().entries.map((entry) {
            final i = entry.key;
            final row = entry.value;
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  children: [
                    Text('Cell ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    TextFormField(
                      initialValue: (row['specificGravity'] ?? '').toString(),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Specific gravity'),
                      onChanged: (v) => setState(() {
                        _cells[i]['specificGravity'] = v;
                        _cells[i]['condition'] =
                            _calcCondition(v, (_cells[i]['voltage'] ?? '').toString());
                      }),
                    ),
                    TextFormField(
                      initialValue: (row['voltage'] ?? '').toString(),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Voltage'),
                      onChanged: (v) => setState(() {
                        _cells[i]['voltage'] = v;
                        _cells[i]['condition'] =
                            _calcCondition((_cells[i]['specificGravity'] ?? '').toString(), v);
                      }),
                    ),
                    Text('Condition: ${_cells[i]['condition'] ?? ''}'),
                    TextFormField(
                      initialValue: (row['remark'] ?? '').toString(),
                      decoration: const InputDecoration(labelText: 'Remark'),
                      onChanged: (v) => _cells[i]['remark'] = v,
                    ),
                  ],
                ),
              ),
            );
          }),
          FilledButton(onPressed: _save, child: const Text('Save Record')),
          const Divider(),
          const Text('Saved records', style: TextStyle(fontWeight: FontWeight.w700)),
          ..._records.map((r) => ListTile(
                title: Text(r.title),
                subtitle: Text('Cells: ${((r.payload['cells'] as List?) ?? []).length}'),
                onTap: () => _edit(r),
                trailing: IconButton(
                  onPressed: () async {
                    await ref.read(moduleRecordRepositoryProvider).delete(r.id);
                    if (!mounted) return;
                    _reload();
                  },
                  icon: const Icon(Icons.delete_outline),
                ),
              )),
        ],
      ),
    );
  }
}
