// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/providers.dart';

class HistoryRegisterMobilePage extends ConsumerStatefulWidget {
  const HistoryRegisterMobilePage({super.key});

  @override
  ConsumerState<HistoryRegisterMobilePage> createState() => _HistoryRegisterMobilePageState();
}

class _HistoryRegisterMobilePageState extends ConsumerState<HistoryRegisterMobilePage> {
  final _assetName = TextEditingController();
  final _assetType = TextEditingController();
  final _assetSerial = TextEditingController();
  final _eventDate = TextEditingController();
  final _eventDesc = TextEditingController();
  final _assetSearch = TextEditingController();
  String _assetSubstationId = '';
  String _assetFeederId = '';
  String _assetStatus = 'active';
  String _selectedAssetId = '';
  String _eventType = 'repair';
  bool _assetSortAsc = true;
  bool _onlyCurrentSubstation = true;

  List<Map<String, dynamic>> _substations = [];
  List<Map<String, dynamic>> _feeders = [];
  List<ModuleRecord> _assets = [];
  List<ModuleRecord> _events = [];
  bool _loading = true;

  @override
  void dispose() {
    _assetName.dispose();
    _assetType.dispose();
    _assetSerial.dispose();
    _eventDate.dispose();
    _eventDesc.dispose();
    _assetSearch.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _eventDate.text = DateTime.now().toIso8601String().substring(0, 10);
    _reload();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final ws = ref.read(workspaceRepositoryProvider);
    _substations = await ws.listSubstations();
    _feeders = await ws.listMasterRecords('feeders');
    _assets = await ref.read(moduleRecordRepositoryProvider).listByModule('asset_master');
    _events = await ref.read(moduleRecordRepositoryProvider).listByModule('asset_history');
    if (_assetSubstationId.isEmpty && _substations.isNotEmpty) {
      _assetSubstationId = _substations.first['id']?.toString() ?? '';
    }
    if (!mounted) return;
    setState(() => _loading = false);
  }

  List<Map<String, dynamic>> get _substationFeeders =>
      _feeders.where((f) => (f['substationId'] ?? '').toString() == _assetSubstationId).toList();

  Future<void> _saveAsset() async {
    if (_assetName.text.trim().isEmpty || _assetSubstationId.isEmpty) return;
    final isEdit = _selectedAssetId.isNotEmpty;
    final saved = await ref.read(moduleRecordRepositoryProvider).upsert(
          id: _selectedAssetId.isEmpty ? null : _selectedAssetId,
          moduleKey: 'asset_master',
          substationId: _assetSubstationId,
          title: _assetName.text.trim(),
          payload: {
            'name': _assetName.text.trim(),
            'type': _assetType.text.trim(),
            'substationId': _assetSubstationId,
            'feederId': _assetFeederId,
            'serialNo': _assetSerial.text.trim(),
            'status': _assetStatus,
          },
        );
    if (_selectedAssetId.isEmpty) {
      await ref.read(moduleRecordRepositoryProvider).upsert(
            moduleKey: 'asset_history',
            substationId: _assetSubstationId,
            title: 'Installation - ${_assetName.text.trim()}',
            payload: {
              'assetId': saved.id,
              'eventType': 'install',
              'date': DateTime.now().toIso8601String().substring(0, 10),
              'description': 'Asset commissioned.',
            },
          );
    }
    _selectedAssetId = saved.id;
    await _reload();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(isEdit ? 'Asset updated' : 'Asset created')),
    );
  }

  Future<void> _saveEvent() async {
    if (_selectedAssetId.isEmpty) return;
    await ref.read(moduleRecordRepositoryProvider).upsert(
          moduleKey: 'asset_history',
          substationId: _assetSubstationId,
          title: '$_eventType - ${_assetName.text.trim()}',
          payload: {
            'assetId': _selectedAssetId,
            'eventType': _eventType,
            'date': _eventDate.text.trim(),
            'description': _eventDesc.text.trim(),
          },
        );
    _eventDesc.clear();
    await _reload();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Event added')));
  }

  void _loadAsset(ModuleRecord r) {
    final p = r.payload;
    setState(() {
      _selectedAssetId = r.id;
      _assetName.text = (p['name'] ?? '').toString();
      _assetType.text = (p['type'] ?? '').toString();
      _assetSubstationId = (p['substationId'] ?? r.substationId ?? '').toString();
      _assetFeederId = (p['feederId'] ?? '').toString();
      _assetSerial.text = (p['serialNo'] ?? '').toString();
      _assetStatus = (p['status'] ?? 'active').toString();
    });
  }

  List<ModuleRecord> get _assetEvents =>
      _events.where((e) => (e.payload['assetId'] ?? '').toString() == _selectedAssetId).toList();

  void _resetAssetForm() {
    setState(() {
      _selectedAssetId = '';
      _assetName.clear();
      _assetType.clear();
      _assetSerial.clear();
      _assetStatus = 'active';
      if (_substations.isNotEmpty) {
        _assetSubstationId = _substations.first['id']?.toString() ?? '';
      }
      _assetFeederId = '';
    });
  }

  List<ModuleRecord> _visibleAssets() {
    final q = _assetSearch.text.trim().toLowerCase();
    final rows = _assets.where((a) {
      final p = a.payload;
      final subId = (p['substationId'] ?? a.substationId ?? '').toString();
      if (_onlyCurrentSubstation && _assetSubstationId.isNotEmpty && subId != _assetSubstationId) {
        return false;
      }
      if (q.isEmpty) return true;
      final hay =
          '${p['name'] ?? a.title} ${p['type'] ?? ''} ${p['serialNo'] ?? ''} ${p['status'] ?? ''}'.toLowerCase();
      return hay.contains(q);
    }).toList();
    rows.sort((a, b) {
      final aName = (a.payload['name'] ?? a.title).toString().toLowerCase();
      final bName = (b.payload['name'] ?? b.title).toString().toLowerCase();
      final cmp = aName.compareTo(bName);
      return _assetSortAsc ? cmp : -cmp;
    });
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final visibleAssets = _visibleAssets();
    final sortedEvents = [..._assetEvents]
      ..sort((a, b) => (b.payload['date'] ?? '').toString().compareTo((a.payload['date'] ?? '').toString()));
    return Scaffold(
      appBar: AppBar(title: const Text('History Register')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          const Text('Asset Master', style: TextStyle(fontWeight: FontWeight.w700)),
          TextField(controller: _assetName, decoration: const InputDecoration(labelText: 'Asset name')),
          TextField(controller: _assetType, decoration: const InputDecoration(labelText: 'Asset type')),
          DropdownButtonFormField<String>(
            value: _assetSubstationId.isEmpty ? null : _assetSubstationId,
            decoration: const InputDecoration(labelText: 'Substation'),
            items: _substations
                .map((s) => DropdownMenuItem(value: s['id']?.toString(), child: Text((s['name'] ?? '').toString())))
                .toList(),
            onChanged: (v) => setState(() {
              _assetSubstationId = v ?? '';
              _assetFeederId = '';
            }),
          ),
          DropdownButtonFormField<String>(
            value: _assetFeederId.isEmpty ? null : _assetFeederId,
            decoration: const InputDecoration(labelText: 'Feeder/Bay'),
            items: _substationFeeders
                .map((f) => DropdownMenuItem(value: f['id']?.toString(), child: Text((f['name'] ?? '').toString())))
                .toList(),
            onChanged: (v) => setState(() => _assetFeederId = v ?? ''),
          ),
          TextField(controller: _assetSerial, decoration: const InputDecoration(labelText: 'Serial no')),
          DropdownButtonFormField<String>(
            value: _assetStatus,
            decoration: const InputDecoration(labelText: 'Status'),
            items: const [
              DropdownMenuItem(value: 'active', child: Text('Active')),
              DropdownMenuItem(value: 'faulty', child: Text('Faulty')),
              DropdownMenuItem(value: 'inactive', child: Text('Inactive')),
            ],
            onChanged: (v) => setState(() => _assetStatus = v ?? 'active'),
          ),
          Wrap(
            spacing: 8,
            children: [
              FilledButton(onPressed: _saveAsset, child: const Text('Save Asset')),
              OutlinedButton(onPressed: _resetAssetForm, child: const Text('New Asset')),
            ],
          ),
          const Divider(),
          const Text('Asset Events', style: TextStyle(fontWeight: FontWeight.w700)),
          TextField(controller: _eventDate, decoration: const InputDecoration(labelText: 'Event date')),
          DropdownButtonFormField<String>(
            value: _eventType,
            decoration: const InputDecoration(labelText: 'Event type'),
            items: const [
              DropdownMenuItem(value: 'install', child: Text('Installation')),
              DropdownMenuItem(value: 'repair', child: Text('Repair')),
              DropdownMenuItem(value: 'test', child: Text('Testing')),
              DropdownMenuItem(value: 'replace', child: Text('Replacement')),
              DropdownMenuItem(value: 'fault', child: Text('Fault')),
              DropdownMenuItem(value: 'restored', child: Text('Restored')),
              DropdownMenuItem(value: 'decommission', child: Text('Decommission')),
            ],
            onChanged: (v) => setState(() => _eventType = v ?? 'repair'),
          ),
          TextField(controller: _eventDesc, decoration: const InputDecoration(labelText: 'Description')),
          FilledButton(
            onPressed: _selectedAssetId.isEmpty ? null : _saveEvent,
            child: const Text('Add Event'),
          ),
          const Divider(),
          const Text('Assets', style: TextStyle(fontWeight: FontWeight.w700)),
          TextField(
            controller: _assetSearch,
            decoration: InputDecoration(
              labelText: 'Search asset',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _assetSearch.text.isEmpty
                  ? null
                  : IconButton(
                      onPressed: () {
                        _assetSearch.clear();
                        setState(() {});
                      },
                      icon: const Icon(Icons.close),
                    ),
            ),
            onChanged: (_) => setState(() {}),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Only current substation'),
            value: _onlyCurrentSubstation,
            onChanged: (v) => setState(() => _onlyCurrentSubstation = v),
          ),
          Row(
            children: [
              Text(
                'Showing ${visibleAssets.length} / ${_assets.length}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const Spacer(),
              OutlinedButton.icon(
                onPressed: () => setState(() => _assetSortAsc = !_assetSortAsc),
                icon: Icon(_assetSortAsc ? Icons.arrow_upward : Icons.arrow_downward),
                label: Text(_assetSortAsc ? 'A-Z' : 'Z-A'),
              ),
            ],
          ),
          ...visibleAssets.map((a) {
            final p = a.payload;
            return ListTile(
              title: Text((p['name'] ?? a.title).toString()),
              subtitle: Text('${p['type'] ?? '-'} | ${p['status'] ?? 'active'}'),
              onTap: () => _loadAsset(a),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () async {
                  final ok = await showDialog<bool>(
                    context: context,
                    builder: (c) => AlertDialog(
                      title: const Text('Delete asset?'),
                      content: Text((p['name'] ?? a.title).toString()),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')),
                        FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Yes')),
                      ],
                    ),
                  );
                  if (ok != true) return;
                  await ref.read(moduleRecordRepositoryProvider).delete(a.id);
                  final linked = _events.where((e) => (e.payload['assetId'] ?? '') == a.id).toList();
                  for (final item in linked) {
                    await ref.read(moduleRecordRepositoryProvider).delete(item.id);
                  }
                  if (_selectedAssetId == a.id) _selectedAssetId = '';
                  await _reload();
                },
              ),
            );
          }),
          if (_selectedAssetId.isNotEmpty) ...[
            const Divider(),
            Text('History (${sortedEvents.length})', style: const TextStyle(fontWeight: FontWeight.w700)),
            ...sortedEvents.map((e) => ListTile(
                  title: Text('${e.payload['eventType'] ?? '-'} | ${e.payload['date'] ?? '-'}'),
                  subtitle: Text((e.payload['description'] ?? '').toString()),
                  trailing: IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      await ref.read(moduleRecordRepositoryProvider).delete(e.id);
                      _reload();
                    },
                  ),
                )),
          ],
        ],
      ),
    );
  }
}
