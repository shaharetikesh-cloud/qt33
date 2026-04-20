// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qt33/src/data/providers.dart';

class MonthEndPackMobilePage extends ConsumerStatefulWidget {
  const MonthEndPackMobilePage({super.key});

  @override
  ConsumerState<MonthEndPackMobilePage> createState() => _MonthEndPackMobilePageState();
}

class _MonthEndPackMobilePageState extends ConsumerState<MonthEndPackMobilePage> {
  final _month = TextEditingController(text: DateFormat('yyyy-MM').format(DateTime.now()));
  String _substationId = '';
  List<Map<String, dynamic>> _substations = [];
  bool _loading = true;

  int _dailyLog = 0;
  int _faults = 0;
  int _maintenance = 0;
  int _battery = 0;
  int _handover = 0;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    setState(() => _loading = true);
    _substations = await ref.read(workspaceRepositoryProvider).listSubstations();
    if (_substationId.isEmpty && _substations.isNotEmpty) {
      _substationId = _substations.first['id']?.toString() ?? '';
    }
    await _calculate();
    if (!mounted) return;
    setState(() => _loading = false);
  }

  Future<void> _calculate() async {
    final repo = ref.read(moduleRecordRepositoryProvider);
    final monthKey = _month.text.trim();
    bool inScope(dynamic payload, String? subId) {
      return (subId ?? '') == _substationId &&
          ((payload['operationalDate'] ?? '').toString().startsWith(monthKey));
    }

    final d = await repo.listByModule('daily_log');
    final f = await repo.listByModule('fault');
    final m = await repo.listByModule('maintenance');
    final b = await repo.listByModule('battery');
    final h = await repo.listByModule('charge_handover');

    _dailyLog = d.where((r) => inScope(r.payload, r.substationId)).length;
    _faults = f.where((r) => inScope(r.payload, r.substationId)).length;
    _maintenance = m.where((r) => inScope(r.payload, r.substationId)).length;
    _battery = b.where((r) => inScope(r.payload, r.substationId)).length;
    _handover = h.where((r) => inScope(r.payload, r.substationId)).length;
  }

  Future<void> _sharePack() async {
    final subName = _substations
        .where((s) => s['id']?.toString() == _substationId)
        .map((s) => (s['name'] ?? '').toString())
        .firstOrNull;
    await _calculate();
    final file = await ref.read(pdfExportServiceProvider).createA4Report(
          title: 'month-end-pack-${_month.text}-${subName ?? 'substation'}',
          rows: [
            {'field': 'Month', 'value': _month.text},
            {'field': 'Substation', 'value': subName ?? _substationId},
            {'field': 'Daily Log records', 'value': '$_dailyLog'},
            {'field': 'Fault records', 'value': '$_faults'},
            {'field': 'Maintenance records', 'value': '$_maintenance'},
            {'field': 'Battery records', 'value': '$_battery'},
            {'field': 'Charge Handover records', 'value': '$_handover'},
          ],
        );
    await ref.read(pdfExportServiceProvider).shareFile(file);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('Month End Pack')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          TextField(controller: _month, decoration: const InputDecoration(labelText: 'Month (YYYY-MM)')),
          DropdownButtonFormField<String>(
            value: _substationId.isEmpty ? null : _substationId,
            decoration: const InputDecoration(labelText: 'Substation'),
            items: _substations
                .map((s) => DropdownMenuItem(value: s['id']?.toString(), child: Text((s['name'] ?? '').toString())))
                .toList(),
            onChanged: (v) => setState(() => _substationId = v ?? ''),
          ),
          Wrap(
            spacing: 8,
            children: [
              FilledButton(
                onPressed: () async {
                  await _calculate();
                  if (!mounted) return;
                  setState(() {});
                },
                child: const Text('Refresh Pack'),
              ),
              OutlinedButton(onPressed: _sharePack, child: const Text('Share PDF Pack')),
            ],
          ),
          const SizedBox(height: 12),
          _KpiCard(label: 'Daily Log', value: '$_dailyLog'),
          _KpiCard(label: 'Fault', value: '$_faults'),
          _KpiCard(label: 'Maintenance', value: '$_maintenance'),
          _KpiCard(label: 'Battery', value: '$_battery'),
          _KpiCard(label: 'Charge Handover', value: '$_handover'),
        ],
      ),
    );
  }
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        title: Text(label),
        trailing: Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
    );
  }
}
