// ignore_for_file: deprecated_member_use
import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:qt33/src/data/providers.dart';
import 'package:qt33/src/data/theme_mode_controller.dart';
import 'package:qt33/src/domain/feeder_math.dart';
import 'package:share_plus/share_plus.dart';

class MastersWorkspacePage extends ConsumerStatefulWidget {
  const MastersWorkspacePage({super.key});

  @override
  ConsumerState<MastersWorkspacePage> createState() => _MastersWorkspacePageState();
}

class _MastersWorkspacePageState extends ConsumerState<MastersWorkspacePage>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 7, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Masters / मास्टर'),
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabs: const [
            Tab(text: 'Substation'),
            Tab(text: 'Division'),
            Tab(text: 'Feeder'),
            Tab(text: 'Battery'),
            Tab(text: 'Transformer'),
            Tab(text: 'Settings'),
            Tab(text: 'Backup'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: const [
          _SubstationsTab(),
          _DivisionsTab(),
          _FeedersTab(),
          _BatterySetsTab(),
          _TransformersTab(),
          _SettingsTab(),
          _BackupTab(),
        ],
      ),
    );
  }
}

// --- Substations ---

class _SubstationsTab extends ConsumerStatefulWidget {
  const _SubstationsTab();

  @override
  ConsumerState<_SubstationsTab> createState() => _SubstationsTabState();
}

class _SubstationsTabState extends ConsumerState<_SubstationsTab> {
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _om = TextEditingController();
  final _subDiv = TextEditingController();
  final _district = TextEditingController();
  final _circle = TextEditingController();
  final _search = TextEditingController();
  String? _editingId;
  List<Map<String, dynamic>> _rows = [];
  var _loading = true;
  bool _sortAsc = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _om.dispose();
    _subDiv.dispose();
    _district.dispose();
    _circle.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final repo = ref.read(workspaceRepositoryProvider);
    final rows = await repo.listSubstations();
    if (!mounted) return;
    setState(() {
      _rows = rows;
      _loading = false;
    });
  }

  void _clearForm() {
    setState(() {
      _editingId = null;
      _code.clear();
      _name.clear();
      _om.clear();
      _subDiv.clear();
      _district.clear();
      _circle.clear();
    });
  }

  void _loadRow(Map<String, dynamic> r) {
    setState(() {
      _editingId = r['id']?.toString();
      _code.text = (r['code'] ?? '').toString();
      _name.text = (r['name'] ?? '').toString();
      _om.text = (r['omName'] ?? '').toString();
      _subDiv.text = (r['subDivisionName'] ?? '').toString();
      _district.text = (r['district'] ?? '').toString();
      _circle.text = (r['circle'] ?? '').toString();
    });
  }

  List<Map<String, dynamic>> _visibleRows() {
    final q = _search.text.trim().toLowerCase();
    final next = _rows.where((r) {
      if (q.isEmpty) return true;
      final haystack =
          '${r['name'] ?? ''} ${r['code'] ?? ''} ${r['district'] ?? ''} ${r['circle'] ?? ''} ${r['subDivisionName'] ?? ''} ${r['omName'] ?? ''}'
              .toLowerCase();
      return haystack.contains(q);
    }).toList();
    next.sort((a, b) {
      final aName = (a['name'] ?? '').toString().toLowerCase();
      final bName = (b['name'] ?? '').toString().toLowerCase();
      final res = aName.compareTo(bName);
      return _sortAsc ? res : -res;
    });
    return next;
  }

  @override
  Widget build(BuildContext context) {
    final repo = ref.watch(workspaceRepositoryProvider);
    final visibleRows = _visibleRows();
    return Column(
      children: [
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    Text(
                      'Substation add / edit — web प्रमाणे code, name, O&M, subdivision, district, circle.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _code,
                      decoration: const InputDecoration(labelText: 'Code'),
                    ),
                    TextField(
                      controller: _name,
                      decoration: const InputDecoration(labelText: 'Substation name *'),
                    ),
                    TextField(controller: _om, decoration: const InputDecoration(labelText: 'O&M')),
                    TextField(
                      controller: _subDiv,
                      decoration: const InputDecoration(labelText: 'Sub Division'),
                    ),
                    TextField(controller: _district, decoration: const InputDecoration(labelText: 'District')),
                    TextField(controller: _circle, decoration: const InputDecoration(labelText: 'Circle')),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        FilledButton(
                          onPressed: () async {
                            if (_name.text.trim().isEmpty) return;
                            final isEdit = _editingId != null;
                            await repo.upsertSubstation(
                              id: _editingId,
                              code: _code.text,
                              name: _name.text,
                              omName: _om.text,
                              subDivisionName: _subDiv.text,
                              district: _district.text,
                              circle: _circle.text,
                            );
                            _clearForm();
                            await _reload();
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  isEdit ? 'Substation updated' : 'Substation created',
                                ),
                              ),
                            );
                          },
                          child: Text(_editingId == null ? 'Save / जतन' : 'Update'),
                        ),
                        OutlinedButton(onPressed: _clearForm, child: const Text('Clear')),
                      ],
                    ),
                    const Divider(height: 32),
                    TextField(
                      controller: _search,
                      decoration: InputDecoration(
                        labelText: 'Search substation / शोध',
                        prefixIcon: const Icon(Icons.search),
                        suffixIcon: _search.text.isEmpty
                            ? null
                            : IconButton(
                                onPressed: () {
                                  _search.clear();
                                  setState(() {});
                                },
                                icon: const Icon(Icons.close),
                              ),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Text(
                          'Showing ${visibleRows.length} / ${_rows.length}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const Spacer(),
                        OutlinedButton.icon(
                          onPressed: () => setState(() => _sortAsc = !_sortAsc),
                          icon: Icon(_sortAsc ? Icons.arrow_upward : Icons.arrow_downward),
                          label: Text(_sortAsc ? 'A-Z' : 'Z-A'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    ...visibleRows.map(
                      (r) => Card(
                        child: ListTile(
                          title: Text(r['name']?.toString() ?? ''),
                          subtitle: Text(
                            '${r['code'] ?? ''} · ${r['district'] ?? ''} · ${r['circle'] ?? ''}',
                          ),
                          onTap: () => _loadRow(r),
                          trailing: Wrap(
                            spacing: 0,
                            children: [
                              IconButton(
                                tooltip: 'Edit',
                                icon: const Icon(Icons.edit_outlined),
                                onPressed: () => _loadRow(r),
                              ),
                              IconButton(
                                tooltip: 'Delete',
                                icon: const Icon(Icons.delete_outline),
                                onPressed: () async {
                                  final ok = await showDialog<bool>(
                                    context: context,
                                    builder: (c) => AlertDialog(
                                      title: const Text('Delete substation?'),
                                      content: Text((r['name'] ?? '').toString()),
                                      actions: [
                                        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')),
                                        FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Yes')),
                                      ],
                                    ),
                                  );
                                  if (ok == true && r['id'] != null) {
                                    await repo.deleteSubstation(r['id'].toString());
                                    if (_editingId == r['id']) _clearForm();
                                    await _reload();
                                  }
                                },
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
        ),
      ],
    );
  }
}

// --- Divisions ---

class _DivisionsTab extends ConsumerStatefulWidget {
  const _DivisionsTab();

  @override
  ConsumerState<_DivisionsTab> createState() => _DivisionsTabState();
}

class _DivisionsTabState extends ConsumerState<_DivisionsTab> {
  static const _col = 'divisions';
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _search = TextEditingController();
  String? _editingId;
  List<Map<String, dynamic>> _rows = [];
  var _loading = true;
  bool _sortAsc = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final repo = ref.read(workspaceRepositoryProvider);
    _rows = await repo.listMasterRecords(_col);
    if (mounted) setState(() => _loading = false);
  }

  void _clear() {
    setState(() {
      _editingId = null;
      _code.clear();
      _name.clear();
    });
  }

  void _load(Map<String, dynamic> r) {
    setState(() {
      _editingId = r['id']?.toString();
      _code.text = (r['code'] ?? '').toString();
      _name.text = (r['name'] ?? '').toString();
    });
  }

  List<Map<String, dynamic>> _visibleRows() {
    final q = _search.text.trim().toLowerCase();
    final out = _rows.where((r) {
      if (q.isEmpty) return true;
      final hay = '${r['name'] ?? ''} ${r['code'] ?? ''}'.toLowerCase();
      return hay.contains(q);
    }).toList();
    out.sort((a, b) {
      final aName = (a['name'] ?? '').toString().toLowerCase();
      final bName = (b['name'] ?? '').toString().toLowerCase();
      final cmp = aName.compareTo(bName);
      return _sortAsc ? cmp : -cmp;
    });
    return out;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    final visibleRows = _visibleRows();
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        TextField(controller: _code, decoration: const InputDecoration(labelText: 'Code *')),
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Name *')),
        Row(
          children: [
            FilledButton(
              onPressed: () async {
                if (_code.text.trim().isEmpty || _name.text.trim().isEmpty) return;
                final isEdit = _editingId != null;
                await ref.read(workspaceRepositoryProvider).upsertMasterRecord(
                      _col,
                      {'code': _code.text.trim(), 'name': _name.text.trim()},
                      id: _editingId,
                    );
                _clear();
                await _reload();
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(isEdit ? 'Division updated' : 'Division created')),
                );
              },
              child: Text(_editingId == null ? 'Save' : 'Update'),
            ),
            const SizedBox(width: 8),
            OutlinedButton(onPressed: _clear, child: const Text('Clear')),
          ],
        ),
        const Divider(),
        TextField(
          controller: _search,
          decoration: InputDecoration(
            labelText: 'Search division',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _search.text.isEmpty
                ? null
                : IconButton(
                    onPressed: () {
                      _search.clear();
                      setState(() {});
                    },
                    icon: const Icon(Icons.close),
                  ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Text(
              'Showing ${visibleRows.length} / ${_rows.length}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const Spacer(),
            OutlinedButton.icon(
              onPressed: () => setState(() => _sortAsc = !_sortAsc),
              icon: Icon(_sortAsc ? Icons.arrow_upward : Icons.arrow_downward),
              label: Text(_sortAsc ? 'A-Z' : 'Z-A'),
            ),
          ],
        ),
        ...visibleRows.map(
          (r) => ListTile(
            title: Text(r['name']?.toString() ?? ''),
            subtitle: Text(r['code']?.toString() ?? ''),
            onTap: () => _load(r),
            trailing: Wrap(
              spacing: 0,
              children: [
                IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _load(r),
                ),
                IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (c) => AlertDialog(
                        title: const Text('Delete division?'),
                        content: Text((r['name'] ?? '').toString()),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')),
                          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Yes')),
                        ],
                      ),
                    );
                    if (ok != true) return;
                    await ref.read(workspaceRepositoryProvider).deleteMasterRecord(_col, r['id'].toString());
                    if (_editingId == r['id']) _clear();
                    await _reload();
                  },
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

// --- Feeders ---

const _feederVoltageOptions = [
  ('11', '11 KV'),
  ('33', '33 KV'),
];

const _feederTypeOptions = [
  ('main_incoming', 'Main Incoming'),
  ('child_feeder', 'Child Feeder'),
  ('normal', 'Normal Feeder'),
  ('express_feeder', 'Express Feeder'),
  ('incoming_33kv', '33 KV Incoming'),
];

class _FeedersTab extends ConsumerStatefulWidget {
  const _FeedersTab();

  @override
  ConsumerState<_FeedersTab> createState() => _FeedersTabState();
}

class _FeedersTabState extends ConsumerState<_FeedersTab> {
  static const _col = 'feeders';
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _ct = TextEditingController();
  final _mf = TextEditingController();
  final _expected = TextEditingController();
  final _search = TextEditingController();
  String? _subId;
  String _voltage = '11';
  String _feederType = 'normal';
  String _parentId = '';
  bool _mainIncoming = false;
  bool _includeTotal = false;
  String? _editingId;
  List<Map<String, dynamic>> _feeders = [];
  List<Map<String, dynamic>> _substations = [];
  var _loading = true;
  bool _sortAsc = true;
  bool _onlyCurrentSubstation = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _ct.dispose();
    _mf.dispose();
    _expected.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final repo = ref.read(workspaceRepositoryProvider);
    _substations = await repo.listSubstations();
    _feeders = await repo.listMasterRecords(_col);
    if (mounted) setState(() => _loading = false);
  }

  void _clear() {
    setState(() {
      _editingId = null;
      _code.clear();
      _name.clear();
      _ct.clear();
      _mf.clear();
      _expected.clear();
      _subId = _substations.isNotEmpty ? _substations.first['id']?.toString() : null;
      _voltage = '11';
      _feederType = 'normal';
      _parentId = '';
      _mainIncoming = false;
      _includeTotal = false;
    });
  }

  void _load(Map<String, dynamic> r) {
    setState(() {
      _editingId = r['id']?.toString();
      _code.text = (r['code'] ?? '').toString();
      _name.text = (r['name'] ?? '').toString();
      _subId = (r['substationId'] ?? r['substation_id'])?.toString();
      _voltage = (r['voltageLevel'] ?? '11').toString();
      _feederType = (r['feederType'] ?? 'normal').toString();
      _parentId = (r['parentFeederId'] ?? r['parent_feeder_id'] ?? '').toString();
      _ct.text = (r['ctRatio'] ?? '').toString();
      _mf.text = (r['mf'] ?? '').toString();
      _expected.text = (r['expectedUnit'] ?? r['expected_unit'] ?? '').toString();
      _mainIncoming = r['isMainIncoming'] == true || r['is_main_incoming'] == true;
      _includeTotal = r['includeInTotal'] == true || r['include_in_total'] == true;
    });
  }

  Map<String, dynamic> _buildPayload() {
    var form = <String, dynamic>{
      'code': _code.text.trim(),
      'name': _name.text.trim(),
      'substationId': _subId ?? '',
      'voltageLevel': _voltage,
      'feederType': _feederType,
      'parentFeederId': _parentId,
      'ctRatio': _ct.text.trim(),
      'mf': _mf.text.trim(),
      'expectedUnit': _expected.text.trim(),
      'isMainIncoming': _mainIncoming,
      'includeInTotal': _includeTotal,
    };
    form = normalizeFeederRecordForSave(form);
    return form;
  }

  List<Map<String, dynamic>> _visibleFeeders(String? effectiveSubId) {
    final q = _search.text.trim().toLowerCase();
    final rows = _feeders.where((f) {
      final subOk = !_onlyCurrentSubstation || (f['substationId'] ?? '').toString() == (effectiveSubId ?? '');
      if (!subOk) return false;
      if (q.isEmpty) return true;
      final hay = '${f['name'] ?? ''} ${f['code'] ?? ''} ${f['feederType'] ?? ''} ${f['voltageLevel'] ?? ''}'
          .toLowerCase();
      return hay.contains(q);
    }).toList();
    rows.sort((a, b) {
      final aName = (a['name'] ?? '').toString().toLowerCase();
      final bName = (b['name'] ?? '').toString().toLowerCase();
      final cmp = aName.compareTo(bName);
      return _sortAsc ? cmp : -cmp;
    });
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_substations.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('आधी Substation tab मध्ये किमान एक substation add करा — feeder त्यावर अवलंबून आहे.'),
        ),
      );
    }
    final effectiveSubId = _subId ?? (_substations.isNotEmpty ? _substations.first['id']?.toString() : null);
    final visibleFeeders = _visibleFeeders(effectiveSubId);
    final parentChoices = _feeders.where((f) => f['id']?.toString() != _editingId).toList();

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        TextField(controller: _code, decoration: const InputDecoration(labelText: 'Code *')),
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Name *')),
        DropdownButtonFormField<String>(
          value: effectiveSubId,
          decoration: const InputDecoration(labelText: 'Substation *'),
          items: _substations
              .map(
                (s) => DropdownMenuItem(
                  value: s['id']?.toString(),
                  child: Text(s['name']?.toString() ?? ''),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _subId = v),
        ),
        DropdownButtonFormField<String>(
          value: _voltage,
          decoration: const InputDecoration(labelText: 'Voltage *'),
          items: _feederVoltageOptions
              .map((e) => DropdownMenuItem(value: e.$1, child: Text(e.$2)))
              .toList(),
          onChanged: (v) => setState(() => _voltage = v ?? '11'),
        ),
        DropdownButtonFormField<String>(
          value: _feederType,
          decoration: const InputDecoration(labelText: 'Feeder type *'),
          items: _feederTypeOptions
              .map((e) => DropdownMenuItem(value: e.$1, child: Text(e.$2)))
              .toList(),
          onChanged: (v) => setState(() => _feederType = v ?? 'normal'),
        ),
        DropdownButtonFormField<String>(
          value: _parentId,
          decoration: const InputDecoration(labelText: 'Parent feeder'),
          items: [
            const DropdownMenuItem(value: '', child: Text('—')),
            ...parentChoices.map(
              (f) => DropdownMenuItem(
                value: f['id']?.toString(),
                child: Text(f['name']?.toString() ?? ''),
              ),
            ),
          ],
          onChanged: (v) => setState(() => _parentId = v ?? ''),
        ),
        TextField(
          controller: _ct,
          decoration: const InputDecoration(
            labelText: 'CT Ratio',
            hintText: 'e.g. 200/5',
          ),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed: () {
              setState(() {
                final next = applyFeederCtRatioChange({
                  'ctRatio': _ct.text,
                  'mf': _mf.text,
                }, _ct.text);
                _mf.text = (next['mf'] ?? '').toString();
              });
            },
            child: const Text('MF auto (CT प्रमाणे)'),
          ),
        ),
        TextField(controller: _mf, decoration: const InputDecoration(labelText: 'MF')),
        TextField(
          controller: _expected,
          decoration: const InputDecoration(labelText: 'Expected unit'),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
        ),
        SwitchListTile(
          title: const Text('Main incoming'),
          value: _mainIncoming,
          onChanged: (v) => setState(() => _mainIncoming = v),
        ),
        SwitchListTile(
          title: const Text('Include in total load'),
          value: _includeTotal,
          onChanged: (v) => setState(() => _includeTotal = v),
        ),
        Row(
          children: [
            FilledButton(
              onPressed: () async {
                if (_code.text.trim().isEmpty ||
                    _name.text.trim().isEmpty ||
                    (effectiveSubId == null || effectiveSubId.isEmpty)) {
                  return;
                }
                final isEdit = _editingId != null;
                _subId = effectiveSubId;
                await ref.read(workspaceRepositoryProvider).upsertMasterRecord(_col, _buildPayload(), id: _editingId);
                _clear();
                await _reload();
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(isEdit ? 'Feeder updated' : 'Feeder created')),
                );
              },
              child: Text(_editingId == null ? 'Save' : 'Update'),
            ),
            const SizedBox(width: 8),
            OutlinedButton(onPressed: _clear, child: const Text('Clear')),
          ],
        ),
        const Divider(),
        TextField(
          controller: _search,
          decoration: InputDecoration(
            labelText: 'Search feeder',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _search.text.isEmpty
                ? null
                : IconButton(
                    onPressed: () {
                      _search.clear();
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
              'Showing ${visibleFeeders.length} / ${_feeders.length}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const Spacer(),
            OutlinedButton.icon(
              onPressed: () => setState(() => _sortAsc = !_sortAsc),
              icon: Icon(_sortAsc ? Icons.arrow_upward : Icons.arrow_downward),
              label: Text(_sortAsc ? 'A-Z' : 'Z-A'),
            ),
          ],
        ),
        ...visibleFeeders.map(
          (r) => ListTile(
            title: Text(r['name']?.toString() ?? ''),
            subtitle: Text('${r['code']} · ${r['substationId'] ?? ''}'),
            onTap: () => _load(r),
            trailing: Wrap(
              spacing: 0,
              children: [
                IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _load(r),
                ),
                IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (c) => AlertDialog(
                        title: const Text('Delete feeder?'),
                        content: Text((r['name'] ?? '').toString()),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')),
                          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Yes')),
                        ],
                      ),
                    );
                    if (ok != true) return;
                    await ref.read(workspaceRepositoryProvider).deleteMasterRecord(_col, r['id'].toString());
                    if (_editingId == r['id']) _clear();
                    await _reload();
                  },
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

// --- Battery sets ---

class _BatterySetsTab extends ConsumerStatefulWidget {
  const _BatterySetsTab();

  @override
  ConsumerState<_BatterySetsTab> createState() => _BatterySetsTabState();
}

class _BatterySetsTabState extends ConsumerState<_BatterySetsTab> {
  static const _col = 'batterySets';
  final _name = TextEditingController();
  final _cells = TextEditingController();
  final _volts = TextEditingController();
  final _search = TextEditingController();
  String? _divisionId;
  String? _subId;
  String? _editingId;
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _divisions = [];
  List<Map<String, dynamic>> _substations = [];
  var _loading = true;
  bool _sortAsc = true;
  bool _onlyCurrentSubstation = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _name.dispose();
    _cells.dispose();
    _volts.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final repo = ref.read(workspaceRepositoryProvider);
    _divisions = await repo.listMasterRecords('divisions');
    _substations = await repo.listSubstations();
    _rows = await repo.listMasterRecords(_col);
    if (mounted) setState(() => _loading = false);
  }

  void _clear() {
    setState(() {
      _editingId = null;
      _name.clear();
      _cells.clear();
      _volts.clear();
      _divisionId = _divisions.isNotEmpty ? _divisions.first['id']?.toString() : null;
      _subId = _substations.isNotEmpty ? _substations.first['id']?.toString() : null;
    });
  }

  void _load(Map<String, dynamic> r) {
    setState(() {
      _editingId = r['id']?.toString();
      _name.text = (r['name'] ?? '').toString();
      _divisionId = (r['divisionId'] ?? r['division_id'])?.toString();
      _subId = (r['substationId'] ?? r['substation_id'])?.toString();
      _cells.text = (r['cellCount'] ?? r['cell_count'] ?? '').toString();
      _volts.text = (r['nominalVoltage'] ?? r['nominal_voltage'] ?? '').toString();
    });
  }

  List<Map<String, dynamic>> _visibleRows(String? effectiveSubId) {
    final q = _search.text.trim().toLowerCase();
    final rows = _rows.where((r) {
      final subOk = !_onlyCurrentSubstation ||
          ((r['substationId'] ?? r['substation_id'] ?? '').toString() == (effectiveSubId ?? ''));
      if (!subOk) return false;
      if (q.isEmpty) return true;
      final hay = '${r['name'] ?? ''} ${r['cellCount'] ?? ''} ${r['nominalVoltage'] ?? ''}'.toLowerCase();
      return hay.contains(q);
    }).toList();
    rows.sort((a, b) {
      final aName = (a['name'] ?? '').toString().toLowerCase();
      final bName = (b['name'] ?? '').toString().toLowerCase();
      final cmp = aName.compareTo(bName);
      return _sortAsc ? cmp : -cmp;
    });
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_divisions.isEmpty || _substations.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _divisions.isEmpty
                ? 'आधी Division add करा.'
                : 'आधी Substation add करा.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    final effectiveDivisionId = _divisionId ?? (_divisions.isNotEmpty ? _divisions.first['id']?.toString() : null);
    final effectiveSubId = _subId ?? (_substations.isNotEmpty ? _substations.first['id']?.toString() : null);
    final visibleRows = _visibleRows(effectiveSubId);

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Name *')),
        DropdownButtonFormField<String>(
          value: effectiveDivisionId,
          decoration: const InputDecoration(labelText: 'Division *'),
          items: _divisions
              .map((d) => DropdownMenuItem(value: d['id']?.toString(), child: Text(d['name']?.toString() ?? '')))
              .toList(),
          onChanged: (v) => setState(() => _divisionId = v),
        ),
        DropdownButtonFormField<String>(
          value: effectiveSubId,
          decoration: const InputDecoration(labelText: 'Substation *'),
          items: _substations
              .map((s) => DropdownMenuItem(value: s['id']?.toString(), child: Text(s['name']?.toString() ?? '')))
              .toList(),
          onChanged: (v) => setState(() => _subId = v),
        ),
        TextField(
          controller: _cells,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Cell count *'),
        ),
        TextField(
          controller: _volts,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Nominal voltage *'),
        ),
        Row(
          children: [
            FilledButton(
              onPressed: () async {
                if (_name.text.trim().isEmpty ||
                    (effectiveDivisionId == null || effectiveDivisionId.isEmpty) ||
                    (effectiveSubId == null || effectiveSubId.isEmpty) ||
                    _cells.text.trim().isEmpty ||
                    _volts.text.trim().isEmpty) {
                  return;
                }
                _divisionId = effectiveDivisionId;
                _subId = effectiveSubId;
                final isEdit = _editingId != null;
                await ref.read(workspaceRepositoryProvider).upsertMasterRecord(
                  _col,
                  {
                    'name': _name.text.trim(),
                    'divisionId': _divisionId,
                    'substationId': _subId,
                    'cellCount': num.tryParse(_cells.text.trim()) ?? _cells.text.trim(),
                    'nominalVoltage': num.tryParse(_volts.text.trim()) ?? _volts.text.trim(),
                  },
                  id: _editingId,
                );
                _clear();
                await _reload();
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(isEdit ? 'Battery set updated' : 'Battery set created')),
                );
              },
              child: Text(_editingId == null ? 'Save' : 'Update'),
            ),
            const SizedBox(width: 8),
            OutlinedButton(onPressed: _clear, child: const Text('Clear')),
          ],
        ),
        const Divider(),
        TextField(
          controller: _search,
          decoration: InputDecoration(
            labelText: 'Search battery set',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _search.text.isEmpty
                ? null
                : IconButton(
                    onPressed: () {
                      _search.clear();
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
              'Showing ${visibleRows.length} / ${_rows.length}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const Spacer(),
            OutlinedButton.icon(
              onPressed: () => setState(() => _sortAsc = !_sortAsc),
              icon: Icon(_sortAsc ? Icons.arrow_upward : Icons.arrow_downward),
              label: Text(_sortAsc ? 'A-Z' : 'Z-A'),
            ),
          ],
        ),
        ...visibleRows.map(
          (r) => ListTile(
            title: Text(r['name']?.toString() ?? ''),
            subtitle: Text('cells ${r['cellCount']} · ${r['nominalVoltage']} V'),
            onTap: () => _load(r),
            trailing: Wrap(
              spacing: 0,
              children: [
                IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _load(r),
                ),
                IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (c) => AlertDialog(
                        title: const Text('Delete battery set?'),
                        content: Text((r['name'] ?? '').toString()),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')),
                          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Yes')),
                        ],
                      ),
                    );
                    if (ok != true) return;
                    await ref.read(workspaceRepositoryProvider).deleteMasterRecord(_col, r['id'].toString());
                    if (_editingId == r['id']) _clear();
                    await _reload();
                  },
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

// --- Transformers ---

class _TransformersTab extends ConsumerStatefulWidget {
  const _TransformersTab();

  @override
  ConsumerState<_TransformersTab> createState() => _TransformersTabState();
}

class _TransformersTabState extends ConsumerState<_TransformersTab> {
  static const _col = 'transformers';
  final _name = TextEditingController();
  final _order = TextEditingController();
  final _mva = TextEditingController();
  final _search = TextEditingController();
  String? _subId;
  String? _editingId;
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _substations = [];
  var _loading = true;
  bool _sortAsc = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _name.dispose();
    _order.dispose();
    _mva.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final repo = ref.read(workspaceRepositoryProvider);
    _substations = await repo.listSubstations();
    _rows = await repo.listMasterRecords(_col);
    if (mounted) setState(() => _loading = false);
  }

  void _clear() {
    setState(() {
      _editingId = null;
      _name.clear();
      _order.clear();
      _mva.clear();
      _subId = _substations.isNotEmpty ? _substations.first['id']?.toString() : null;
    });
  }

  void _load(Map<String, dynamic> r) {
    setState(() {
      _editingId = r['id']?.toString();
      _name.text = (r['name'] ?? '').toString();
      _subId = (r['substationId'] ?? r['substation_id'])?.toString();
      _order.text = (r['displayOrder'] ?? r['display_order'] ?? '').toString();
      _mva.text = (r['ratedCapacityMva'] ?? r['rated_capacity_mva'] ?? '').toString();
    });
  }

  List<Map<String, dynamic>> _visibleRows(String? effectiveSubId) {
    final q = _search.text.trim().toLowerCase();
    final out = _rows.where((r) {
      if (effectiveSubId != null && effectiveSubId.isNotEmpty) {
        final sub = (r['substationId'] ?? r['substation_id'] ?? '').toString();
        if (sub != effectiveSubId) return false;
      }
      if (q.isEmpty) return true;
      final hay = '${r['name'] ?? ''} ${r['ratedCapacityMva'] ?? ''} ${r['displayOrder'] ?? ''}'.toLowerCase();
      return hay.contains(q);
    }).toList();
    out.sort((a, b) {
      final aName = (a['name'] ?? '').toString().toLowerCase();
      final bName = (b['name'] ?? '').toString().toLowerCase();
      final cmp = aName.compareTo(bName);
      return _sortAsc ? cmp : -cmp;
    });
    return out;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_substations.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('आधी Substation add करा.'),
        ),
      );
    }
    final effectiveSubId = _subId ?? (_substations.isNotEmpty ? _substations.first['id']?.toString() : null);
    final visibleRows = _visibleRows(effectiveSubId);

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Name *')),
        DropdownButtonFormField<String>(
          value: effectiveSubId,
          decoration: const InputDecoration(labelText: 'Substation *'),
          items: _substations
              .map((s) => DropdownMenuItem(value: s['id']?.toString(), child: Text(s['name']?.toString() ?? '')))
              .toList(),
          onChanged: (v) => setState(() => _subId = v),
        ),
        TextField(controller: _order, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Display order')),
        TextField(
          controller: _mva,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Rated capacity (MVA)'),
        ),
        Row(
          children: [
            FilledButton(
              onPressed: () async {
                if (_name.text.trim().isEmpty || (effectiveSubId == null || effectiveSubId.isEmpty)) return;
                final isEdit = _editingId != null;
                _subId = effectiveSubId;
                await ref.read(workspaceRepositoryProvider).upsertMasterRecord(
                  _col,
                  {
                    'name': _name.text.trim(),
                    'substationId': _subId,
                    'displayOrder': _order.text.trim().isEmpty ? null : num.tryParse(_order.text.trim()),
                    'ratedCapacityMva': _mva.text.trim().isEmpty ? null : num.tryParse(_mva.text.trim()),
                  },
                  id: _editingId,
                );
                _clear();
                await _reload();
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(isEdit ? 'Transformer updated' : 'Transformer created')),
                );
              },
              child: Text(_editingId == null ? 'Save' : 'Update'),
            ),
            const SizedBox(width: 8),
            OutlinedButton(onPressed: _clear, child: const Text('Clear')),
          ],
        ),
        const Divider(),
        TextField(
          controller: _search,
          decoration: InputDecoration(
            labelText: 'Search transformer',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _search.text.isEmpty
                ? null
                : IconButton(
                    onPressed: () {
                      _search.clear();
                      setState(() {});
                    },
                    icon: const Icon(Icons.close),
                  ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Text(
              'Showing ${visibleRows.length} / ${_rows.length}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const Spacer(),
            OutlinedButton.icon(
              onPressed: () => setState(() => _sortAsc = !_sortAsc),
              icon: Icon(_sortAsc ? Icons.arrow_upward : Icons.arrow_downward),
              label: Text(_sortAsc ? 'A-Z' : 'Z-A'),
            ),
          ],
        ),
        ...visibleRows.map(
          (r) => ListTile(
            title: Text(r['name']?.toString() ?? ''),
            subtitle: Text('order ${r['displayOrder'] ?? '-'} · MVA ${r['ratedCapacityMva'] ?? '-'}'),
            onTap: () => _load(r),
            trailing: Wrap(
              spacing: 0,
              children: [
                IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _load(r),
                ),
                IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (c) => AlertDialog(
                        title: const Text('Delete transformer?'),
                        content: Text((r['name'] ?? '').toString()),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')),
                          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Yes')),
                        ],
                      ),
                    );
                    if (ok != true) return;
                    await ref.read(workspaceRepositoryProvider).deleteMasterRecord(_col, r['id'].toString());
                    if (_editingId == r['id']) _clear();
                    await _reload();
                  },
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

// --- Settings ---

class _SettingsTab extends ConsumerStatefulWidget {
  const _SettingsTab();

  @override
  ConsumerState<_SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends ConsumerState<_SettingsTab> {
  final _company = TextEditingController();
  final _office = TextEditingController();
  final _address = TextEditingController();
  final _contact = TextEditingController();
  final _footer = TextEditingController();
  final _fontScale = TextEditingController();
  String _orientation = 'portrait';
  String _themeMode = 'system';
  bool _compact = true;
  var _loading = true;

  @override
  void dispose() {
    _company.dispose();
    _office.dispose();
    _address.dispose();
    _contact.dispose();
    _footer.dispose();
    _fontScale.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final s = await ref.read(workspaceRepositoryProvider).getSettingsBundle();
    if (!mounted) return;
    final cp = s['companyProfile'] as Map? ?? {};
    final ps = s['printSettings'] as Map? ?? {};
    _company.text = cp['companyName']?.toString() ?? '';
    _office.text = cp['officeName']?.toString() ?? '';
    _address.text = cp['address']?.toString() ?? '';
    _contact.text = cp['contactNumber']?.toString() ?? '';
    _footer.text = cp['reportFooter']?.toString() ?? '';
    _orientation = ps['defaultOrientation']?.toString() ?? 'portrait';
    _fontScale.text = (ps['fontScale'] ?? 1).toString();
    _compact = ps['compactTables'] == true;
    final appUi = s['appUi'] as Map? ?? {};
    _themeMode = appUi['themeMode']?.toString().trim().isNotEmpty == true
        ? appUi['themeMode'].toString()
        : 'system';
    setState(() => _loading = false);
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        TextField(controller: _company, decoration: const InputDecoration(labelText: 'Company name')),
        TextField(controller: _office, decoration: const InputDecoration(labelText: 'Office name')),
        TextField(controller: _address, decoration: const InputDecoration(labelText: 'Address')),
        TextField(controller: _contact, decoration: const InputDecoration(labelText: 'Contact')),
        TextField(controller: _footer, decoration: const InputDecoration(labelText: 'Report footer')),
        DropdownButtonFormField<String>(
          value: _orientation,
          decoration: const InputDecoration(labelText: 'Print orientation'),
          items: const [
            DropdownMenuItem(value: 'portrait', child: Text('Portrait')),
            DropdownMenuItem(value: 'landscape', child: Text('Landscape')),
          ],
          onChanged: (v) => setState(() => _orientation = v ?? 'portrait'),
        ),
        TextField(controller: _fontScale, decoration: const InputDecoration(labelText: 'Font scale')),
        SwitchListTile(
          title: const Text('Compact tables'),
          value: _compact,
          onChanged: (v) => setState(() => _compact = v),
        ),
        DropdownButtonFormField<String>(
          value: _themeMode,
          decoration: const InputDecoration(labelText: 'App theme (Light / Dark)'),
          items: const [
            DropdownMenuItem(value: 'system', child: Text('System (फोन सेटिंग प्रमाणे)')),
            DropdownMenuItem(value: 'light', child: Text('Light')),
            DropdownMenuItem(value: 'dark', child: Text('Dark')),
          ],
          onChanged: (v) async {
            final next = v ?? 'system';
            setState(() => _themeMode = next);
            final mode = switch (next) {
              'light' => ThemeMode.light,
              'dark' => ThemeMode.dark,
              _ => ThemeMode.system,
            };
            await ref.read(themeModeProvider.notifier).setThemeMode(mode);
          },
        ),
        FilledButton(
          onPressed: () async {
            await ref.read(workspaceRepositoryProvider).saveSettingsBundle({
              'companyProfile': {
                'companyName': _company.text.trim(),
                'officeName': _office.text.trim(),
                'address': _address.text.trim(),
                'contactNumber': _contact.text.trim(),
                'reportFooter': _footer.text.trim(),
              },
              'printSettings': {
                'defaultOrientation': _orientation,
                'fontScale': num.tryParse(_fontScale.text.trim()) ?? 1,
                'compactTables': _compact,
              },
              'appUi': {
                'themeMode': _themeMode,
              },
            });
            final mode = switch (_themeMode) {
              'light' => ThemeMode.light,
              'dark' => ThemeMode.dark,
              _ => ThemeMode.system,
            };
            await ref.read(themeModeProvider.notifier).setThemeMode(mode);
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Settings saved')));
            }
          },
          child: const Text('Save settings'),
        ),
      ],
    );
  }
}

// --- Backup ---

class _BackupTab extends ConsumerWidget {
  const _BackupTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repo = ref.watch(workspaceRepositoryProvider);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'Web प्रमाणे पूर्ण JSON backup export / import. Import पूर्ण replace करतो (masters + substations + DLR module records).',
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          icon: const Icon(Icons.upload_file),
          label: const Text('Export backup JSON'),
          onPressed: () async {
            final snap = await repo.buildBackupSnapshot();
            final dir = await getTemporaryDirectory();
            final file = File('${dir.path}/qt33-backup.json');
            await file.writeAsString(const JsonEncoder.withIndent('  ').convert(snap));
            await Share.shareXFiles([XFile(file.path)], text: 'QT33 backup');
          },
        ),
        const SizedBox(height: 12),
        FilledButton.tonalIcon(
          icon: const Icon(Icons.download),
          label: const Text('Import backup JSON'),
          onPressed: () async {
            final res = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['json']);
            final path = res?.files.single.path;
            if (path == null) return;
            final text = await File(path).readAsString();
            final data = jsonDecode(text) as Map<String, dynamic>;
            await repo.importBackupSnapshot(data);
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Import complete')));
            }
          },
        ),
      ],
    );
  }
}
