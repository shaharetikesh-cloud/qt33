// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/providers.dart';

class MaintenanceMobilePage extends ConsumerStatefulWidget {
  const MaintenanceMobilePage({super.key});

  @override
  ConsumerState<MaintenanceMobilePage> createState() => _MaintenanceMobilePageState();
}

class _MaintenanceMobilePageState extends ConsumerState<MaintenanceMobilePage> {
  final _date = TextEditingController(text: DateFormat('yyyy-MM-dd').format(DateTime.now()));
  final _from = TextEditingController();
  final _to = TextEditingController();
  final _work = TextEditingController();
  final _remark = TextEditingController();
  String _substationId = '';
  String _fromDate = DateFormat('yyyy-MM-01').format(DateTime.now());
  String _toDate = DateFormat('yyyy-MM-dd').format(DateTime.now());
  List<Map<String, dynamic>> _substations = [];
  List<ModuleRecord> _records = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    _substations = await ref.read(workspaceRepositoryProvider).listSubstations();
    _records = await ref.read(moduleRecordRepositoryProvider).listByModule('maintenance');
    if (_substationId.isEmpty && _substations.isNotEmpty) {
      _substationId = _substations.first['id']?.toString() ?? '';
    }
    if (!mounted) return;
    setState(() => _loading = false);
  }

  int? _durationMinutes() {
    final from = _from.text.split(':');
    final to = _to.text.split(':');
    if (from.length != 2 || to.length != 2) return null;
    final a = (int.tryParse(from[0]) ?? 0) * 60 + (int.tryParse(from[1]) ?? 0);
    final b = (int.tryParse(to[0]) ?? 0) * 60 + (int.tryParse(to[1]) ?? 0);
    if (b < a) return null;
    return b - a;
  }

  Future<void> _save() async {
    await ref.read(moduleRecordRepositoryProvider).upsert(
          moduleKey: 'maintenance',
          substationId: _substationId,
          title: '${_date.text} maintenance',
          payload: {
            'operationalDate': _date.text,
            'fromTime': _from.text,
            'toTime': _to.text,
            'durationMinutes': _durationMinutes(),
            'workDetail': _work.text.trim(),
            'remark': _remark.text.trim(),
          },
        );
    _from.clear();
    _to.clear();
    _work.clear();
    _remark.clear();
    _reload();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Maintenance saved')));
    }
  }

  List<ModuleRecord> get _filtered => _records.where((r) {
        final d = (r.payload['operationalDate'] ?? '').toString();
        final subMatch = _substationId.isEmpty || r.substationId == _substationId;
        return subMatch && d.compareTo(_fromDate) >= 0 && d.compareTo(_toDate) <= 0;
      }).toList();

  Future<void> _shareFilteredPdf() async {
    final rows = _filtered
        .map((r) => {
              'field': '${r.payload['operationalDate'] ?? '-'} (${r.payload['fromTime'] ?? '-'}-${r.payload['toTime'] ?? '-'})',
              'value': '${r.payload['workDetail'] ?? '-'} | ${r.payload['remark'] ?? '-'}',
            })
        .toList();
    final file = await ref.read(pdfExportServiceProvider).createA4Report(
          title: 'maintenance-$_fromDate-to-$_toDate',
          rows: rows.isEmpty ? [{'field': 'Info', 'value': 'No records'}] : rows,
        );
    await ref.read(pdfExportServiceProvider).shareFile(file);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('Maintenance Register')),
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
            onChanged: (v) => setState(() => _substationId = v ?? ''),
          ),
          Row(children: [
            Expanded(child: TextField(controller: _from, decoration: const InputDecoration(labelText: 'From HH:MM'))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _to, decoration: const InputDecoration(labelText: 'To HH:MM'))),
          ]),
          TextField(controller: _work, decoration: const InputDecoration(labelText: 'Work detail')),
          TextField(controller: _remark, decoration: const InputDecoration(labelText: 'Remark')),
          const SizedBox(height: 8),
          FilledButton(onPressed: _save, child: const Text('Save maintenance entry')),
          const Divider(),
          const Text('Report filter', style: TextStyle(fontWeight: FontWeight.w700)),
          TextField(
            controller: TextEditingController(text: _fromDate),
            decoration: const InputDecoration(labelText: 'From date'),
            onChanged: (v) => setState(() => _fromDate = v),
          ),
          TextField(
            controller: TextEditingController(text: _toDate),
            decoration: const InputDecoration(labelText: 'To date'),
            onChanged: (v) => setState(() => _toDate = v),
          ),
          OutlinedButton(onPressed: _shareFilteredPdf, child: const Text('Share filtered PDF')),
          const Divider(),
          ..._filtered.map((r) => ListTile(
                title: Text((r.payload['workDetail'] ?? '-').toString()),
                subtitle: Text('${r.payload['operationalDate'] ?? '-'} ${r.payload['fromTime'] ?? '-'}-${r.payload['toTime'] ?? '-'}'),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    await ref.read(moduleRecordRepositoryProvider).delete(r.id);
                    _reload();
                  },
                ),
              )),
        ],
      ),
    );
  }
}
