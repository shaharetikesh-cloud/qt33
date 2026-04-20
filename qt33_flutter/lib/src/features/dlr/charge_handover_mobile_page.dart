// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/providers.dart';

class ChargeHandoverMobilePage extends ConsumerStatefulWidget {
  const ChargeHandoverMobilePage({super.key});

  @override
  ConsumerState<ChargeHandoverMobilePage> createState() => _ChargeHandoverMobilePageState();
}

class _ChargeHandoverMobilePageState extends ConsumerState<ChargeHandoverMobilePage> {
  final _date = TextEditingController(text: DateFormat('yyyy-MM-dd').format(DateTime.now()));
  final _outgoing = TextEditingController();
  final _incoming = TextEditingController();
  final _inCharge = TextEditingController();
  final _chargeDetails = TextEditingController();
  final _pendingItems = TextEditingController();
  final _remark = TextEditingController();
  String _shift = 'Morning';
  String _substationId = '';
  String _editingId = '';
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
    _records = await ref.read(moduleRecordRepositoryProvider).listByModule('charge_handover');
    if (_substationId.isEmpty && _substations.isNotEmpty) {
      _substationId = _substations.first['id']?.toString() ?? '';
    }
    if (!mounted) return;
    setState(() => _loading = false);
  }

  Future<void> _save() async {
    final subName = _substations
        .where((s) => s['id']?.toString() == _substationId)
        .map((s) => (s['name'] ?? '').toString())
        .firstOrNull;
    final saved = await ref.read(moduleRecordRepositoryProvider).upsert(
          id: _editingId.isEmpty ? null : _editingId,
          moduleKey: 'charge_handover',
          substationId: _substationId,
          title: '${_date.text} ${subName ?? ''} $_shift',
          payload: {
            'operationalDate': _date.text,
            'shift': _shift,
            'outgoingOperator': _outgoing.text.trim(),
            'incomingOperator': _incoming.text.trim(),
            'inChargeName': _inCharge.text.trim(),
            'chargeDetails': _chargeDetails.text.trim(),
            'pendingItems': _pendingItems.text.trim(),
            'remark': _remark.text.trim(),
          },
        );
    if (!mounted) return;
    setState(() => _editingId = saved.id);
    _reload();
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Charge handover saved')));
  }

  void _edit(ModuleRecord r) {
    final p = r.payload;
    setState(() {
      _editingId = r.id;
      _substationId = r.substationId ?? '';
      _date.text = (p['operationalDate'] ?? '').toString();
      _shift = (p['shift'] ?? 'Morning').toString();
      _outgoing.text = (p['outgoingOperator'] ?? '').toString();
      _incoming.text = (p['incomingOperator'] ?? '').toString();
      _inCharge.text = (p['inChargeName'] ?? '').toString();
      _chargeDetails.text = (p['chargeDetails'] ?? '').toString();
      _pendingItems.text = (p['pendingItems'] ?? '').toString();
      _remark.text = (p['remark'] ?? '').toString();
    });
  }

  Future<void> _sharePdf() async {
    final sub = _substations.where((s) => s['id']?.toString() == _substationId).firstOrNull;
    final file = await ref.read(pdfExportServiceProvider).createA4Report(
          title: 'charge-handover-${_date.text}-${sub?['name'] ?? 'substation'}',
          rows: [
            {'field': 'Date', 'value': _date.text},
            {'field': 'Shift', 'value': _shift},
            {'field': 'Outgoing', 'value': _outgoing.text},
            {'field': 'Incoming', 'value': _incoming.text},
            {'field': 'In-charge', 'value': _inCharge.text},
            {'field': 'Charge details', 'value': _chargeDetails.text},
            {'field': 'Pending items', 'value': _pendingItems.text},
            {'field': 'Remark', 'value': _remark.text},
          ],
        );
    await ref.read(pdfExportServiceProvider).shareFile(file);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('Charge Handover')),
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
          DropdownButtonFormField<String>(
            value: _shift,
            decoration: const InputDecoration(labelText: 'Shift'),
            items: const [
              DropdownMenuItem(value: 'Morning', child: Text('Morning')),
              DropdownMenuItem(value: 'Evening', child: Text('Evening')),
              DropdownMenuItem(value: 'Night', child: Text('Night')),
            ],
            onChanged: (v) => setState(() => _shift = v ?? 'Morning'),
          ),
          TextField(controller: _outgoing, decoration: const InputDecoration(labelText: 'Outgoing operator')),
          TextField(controller: _incoming, decoration: const InputDecoration(labelText: 'Incoming operator')),
          TextField(controller: _inCharge, decoration: const InputDecoration(labelText: 'In-charge')),
          TextField(controller: _chargeDetails, decoration: const InputDecoration(labelText: 'Charge details'), minLines: 2, maxLines: 4),
          TextField(controller: _pendingItems, decoration: const InputDecoration(labelText: 'Pending items'), minLines: 2, maxLines: 4),
          TextField(controller: _remark, decoration: const InputDecoration(labelText: 'Remark'), minLines: 2, maxLines: 4),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            FilledButton(onPressed: _save, child: const Text('Save')),
            OutlinedButton(onPressed: _sharePdf, child: const Text('Share PDF')),
          ]),
          const Divider(),
          const Text('Saved handovers', style: TextStyle(fontWeight: FontWeight.w700)),
          ..._records.map((r) => ListTile(
                title: Text(r.title),
                subtitle: Text('${r.payload['outgoingOperator'] ?? '-'} -> ${r.payload['incomingOperator'] ?? '-'}'),
                onTap: () => _edit(r),
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
