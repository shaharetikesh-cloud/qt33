// ignore_for_file: deprecated_member_use
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/providers.dart';
import 'package:qt33/src/domain/daily_log_derive.dart';
import 'package:qt33/src/domain/daily_log_kwh_gap_fill.dart';

class DailyLogMobilePage extends ConsumerStatefulWidget {
  const DailyLogMobilePage({super.key});

  @override
  ConsumerState<DailyLogMobilePage> createState() => _DailyLogMobilePageState();
}

class _DailyLogMobilePageState extends ConsumerState<DailyLogMobilePage> {
  static final List<String> _dailyHours =
      List<String>.generate(25, (i) => '${i.toString().padLeft(2, '0')}:00');
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

  String _getCellValue(String hour, String feederId, String key) {
    final row = _rows.where((r) => (r['time'] ?? '') == hour && (r['feederId'] ?? '') == feederId).firstOrNull;
    return (row?[key] ?? '').toString();
  }

  Map<String, dynamic> _blankRow(String hour, String feederId) => {
        'time': hour,
        'feederId': feederId,
        'kwh': '',
        'amp': '',
        'kv': '',
        'remark': '',
      };

  List<Map<String, dynamic>> _orderedRowsForFeeder(String feederId) {
    final byHour = <String, Map<String, dynamic>>{};
    for (final row in _rows) {
      if ((row['feederId'] ?? '').toString() != feederId) continue;
      final t = _normalizeTime((row['time'] ?? '').toString(), allowTwentyFour: true);
      if (t.isEmpty) continue;
      byHour[t] = Map<String, dynamic>.from(row);
    }
    return _dailyHours.map((h) => Map<String, dynamic>.from(byHour[h] ?? _blankRow(h, feederId))).toList(growable: false);
  }

  void _applyOrderedFeederSlice(String feederId, List<Map<String, dynamic>> ordered25) {
    if (ordered25.length != 25) return;
    final next = _rows
        .where((r) => (r['feederId'] ?? '').toString() != feederId)
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    for (final row in ordered25) {
      final t = row['time']?.toString() ?? '';
      if (t.isEmpty) continue;
      next.add(Map<String, dynamic>.from(row));
    }
    setState(() => _rows = next);
  }

  void _setCellValue(String hour, String feederId, String key, String value) {
    final idx = _rows.indexWhere((r) => (r['time'] ?? '') == hour && (r['feederId'] ?? '') == feederId);
    if (idx >= 0) {
      final next = [..._rows];
      next[idx] = {...next[idx], key: value};
      setState(() => _rows = next);
    } else {
      setState(() {
        _rows = [
          ..._rows,
          {
            'time': hour,
            'feederId': feederId,
            'kwh': key == 'kwh' ? value : '',
            'amp': key == 'amp' ? value : '',
            'kv': key == 'kv' ? value : '',
            'remark': key == 'remark' ? value : '',
          },
        ];
      });
    }

    if (key != 'kwh') return;

    final hourNorm = _normalizeTime(hour, allowTwentyFour: true);
    final currentIndex = _dailyHours.indexOf(hourNorm);
    if (currentIndex < 0) return;

    final trimmed = value.trim();
    if (trimmed.isEmpty) return;
    // Avoid gap-filling while the operator is still typing partial numbers (web-side uses full-row re-derive).
    if (trimmed.endsWith('.') || trimmed.endsWith(',')) return;

    final ordered = _orderedRowsForFeeder(feederId);
    final manualInterruptions =
        _interruptions.where((i) => (i['source']?.toString() ?? '') != 'auto').toList(growable: false);
    final filled = applyAutomaticKwhGapFill(ordered, feederId, currentIndex, manualInterruptions);
    _applyOrderedFeederSlice(feederId, filled);
  }

  String _normalizeTime(String raw, {bool allowTwentyFour = false}) {
    final text = raw.trim();
    if (text.isEmpty) return '';
    String candidate = text;
    if (!text.contains(':')) {
      final digits = text.replaceAll(RegExp(r'[^0-9]'), '');
      if (digits.length == 4) {
        candidate = '${digits.substring(0, 2)}:${digits.substring(2, 4)}';
      } else if (digits.length == 3) {
        candidate = '0${digits.substring(0, 1)}:${digits.substring(1, 3)}';
      }
    }
    final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(candidate);
    if (m == null) return '';
    final h = int.tryParse(m.group(1) ?? '');
    final min = int.tryParse(m.group(2) ?? '');
    if (h == null || min == null || min < 0 || min > 59) return '';
    if (h == 24) return allowTwentyFour && min == 0 ? '24:00' : '';
    if (h < 0 || h > 23) return '';
    return '${h.toString().padLeft(2, '0')}:${min.toString().padLeft(2, '0')}';
  }

  int? _timeToMinutes(String raw, {bool allowTwentyFour = false}) {
    final normalized = _normalizeTime(raw, allowTwentyFour: allowTwentyFour);
    if (normalized.isEmpty) return null;
    final parts = normalized.split(':');
    return int.parse(parts[0]) * 60 + int.parse(parts[1]);
  }

  String _formatDuration(int minutes) =>
      '${(minutes ~/ 60).toString().padLeft(2, '0')}:${(minutes % 60).toString().padLeft(2, '0')}';

  void _normalizeTimeFields() {
    _rows = _rows.map((r) {
      final t = _normalizeTime((r['time'] ?? '').toString(), allowTwentyFour: true);
      return {...r, 'time': t.isEmpty ? (r['time'] ?? '').toString() : t};
    }).toList(growable: false);
    _interruptions = _interruptions.map((r) {
      final from = _normalizeTime((r['from_time'] ?? '').toString());
      final to = _normalizeTime((r['to_time'] ?? '').toString(), allowTwentyFour: true);
      final fromM = _timeToMinutes(from);
      final toM = _timeToMinutes(to, allowTwentyFour: true);
      final duration = (fromM != null && toM != null && toM >= fromM) ? toM - fromM : null;
      return {
        ...r,
        'from_time': from.isEmpty ? (r['from_time'] ?? '').toString() : from,
        'to_time': to.isEmpty ? (r['to_time'] ?? '').toString() : to,
        'duration_minutes': duration,
        'duration_label': duration == null ? '' : _formatDuration(duration),
      };
    }).toList(growable: false);
    _meterChanges = _meterChanges.map((r) {
      final t = _normalizeTime((r['effective_time'] ?? '').toString(), allowTwentyFour: true);
      return {...r, 'effective_time': t.isEmpty ? (r['effective_time'] ?? '').toString() : t};
    }).toList(growable: false);
  }

  void _generateFullDayRows() {
    final feeders = _substationFeeders;
    if (feeders.isEmpty) return;
    final existing = <String, Map<String, dynamic>>{};
    for (final row in _rows) {
      final time = _normalizeTime((row['time'] ?? '').toString(), allowTwentyFour: true);
      final feederId = (row['feederId'] ?? '').toString();
      if (time.isEmpty || feederId.isEmpty) continue;
      existing['$time#$feederId'] = row;
    }
    final generated = <Map<String, dynamic>>[];
    for (final hour in _dailyHours) {
      for (final feeder in feeders) {
        final feederId = (feeder['id'] ?? '').toString();
        final key = '$hour#$feederId';
        generated.add(existing[key] ?? {
          'time': hour,
          'feederId': feederId,
          'kwh': '',
          'amp': '',
          'kv': '',
          'remark': '',
        });
      }
    }
    setState(() => _rows = generated);
  }

  List<Map<String, dynamic>> _hourlySummary() {
    final map = <String, Map<String, dynamic>>{};
    for (final h in _dailyHours) {
      map[h] = {'time': h, 'ampTotal': 0.0, 'kwhTotal': 0.0, 'kvAvg': 0.0, 'kvCount': 0};
    }
    for (final row in _rows) {
      final time = _normalizeTime((row['time'] ?? '').toString(), allowTwentyFour: true);
      if (!map.containsKey(time)) continue;
      final amp = num.tryParse((row['amp'] ?? '').toString()) ?? 0;
      final kwh = num.tryParse((row['kwh'] ?? '').toString()) ?? 0;
      final kv = num.tryParse((row['kv'] ?? '').toString());
      map[time]!['ampTotal'] = (map[time]!['ampTotal'] as double) + amp.toDouble();
      map[time]!['kwhTotal'] = (map[time]!['kwhTotal'] as double) + kwh.toDouble();
      if (kv != null) {
        map[time]!['kvAvg'] = (map[time]!['kvAvg'] as double) + kv.toDouble();
        map[time]!['kvCount'] = (map[time]!['kvCount'] as int) + 1;
      }
    }
    return _dailyHours.map((h) {
      final entry = map[h]!;
      final kvCount = entry['kvCount'] as int;
      final avgKv = kvCount == 0 ? 0.0 : (entry['kvAvg'] as double) / kvCount;
      return {
        'time': h,
        'ampTotal': (entry['ampTotal'] as double),
        'kwhTotal': (entry['kwhTotal'] as double),
        'kvAvg': avgKv,
      };
    }).toList(growable: false);
  }

  List<Map<String, dynamic>> _feederSummary() {
    final byFeeder = <String, Map<String, dynamic>>{};
    for (final f in _substationFeeders) {
      byFeeder[(f['id'] ?? '').toString()] = {
        'name': (f['name'] ?? '').toString(),
        'ampMax': 0.0,
        'kwhTotal': 0.0,
      };
    }
    for (final row in _rows) {
      final feederId = (row['feederId'] ?? '').toString();
      final entry = byFeeder[feederId];
      if (entry == null) continue;
      final amp = num.tryParse((row['amp'] ?? '').toString()) ?? 0;
      final kwh = num.tryParse((row['kwh'] ?? '').toString()) ?? 0;
      entry['ampMax'] = math.max((entry['ampMax'] as double), amp.toDouble());
      entry['kwhTotal'] = (entry['kwhTotal'] as double) + kwh.toDouble();
    }
    return byFeeder.values.toList(growable: false);
  }

  Future<void> _save({bool finalize = false}) async {
    final repo = ref.read(moduleRecordRepositoryProvider);
    _normalizeTimeFields();
    final nextDayStatus = finalize ? 'finalized' : _dayStatus;
    final manualInterruptions = _interruptions
        .where((i) => (i['source']?.toString() ?? '') != 'auto')
        .map((e) => Map<String, dynamic>.from(e))
        .toList(growable: false);
    final derived = deriveDailyLogFlatForSave(
      dailyHours: _dailyHours,
      rows: _rows.map((e) => Map<String, dynamic>.from(e)).toList(growable: false),
      manualInterruptionsOnly: manualInterruptions,
      feeders: _substationFeeders,
      mode: nextDayStatus == 'finalized' ? 'finalized' : 'draft',
    );
    if (!mounted) return;
    setState(() {
      _rows = derived.rows;
      _interruptions = [...manualInterruptions, ...derived.autoInterruptions];
    });
    _normalizeTimeFields();
    final payload = {
      'operationalDate': _date.text,
      'shift': _shift.text.trim(),
      'operatorName': _operator.text.trim(),
      'inChargeName': _inCharge.text.trim(),
      'dayStatus': nextDayStatus,
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
    final monthKey = _date.text.trim().length >= 7 ? _date.text.trim().substring(0, 7) : '';
    if (monthKey.isNotEmpty && _substationId.isNotEmpty) {
      await ref.read(monthlyReportAutomationServiceProvider).regenerateForMonth(
            substationId: _substationId,
            monthKey: monthKey,
          );
    }
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
            OutlinedButton.icon(
              onPressed: _generateFullDayRows,
              icon: const Icon(Icons.auto_mode),
              label: const Text('00:00-24:00 Auto Grid'),
            ),
          ]),
          const SizedBox(height: 8),
          Card(
            color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.35),
            child: const ListTile(
              leading: Icon(Icons.tips_and_updates_outlined),
              title: Text('Smart time entry enabled'),
              subtitle: Text(
                '1300 -> 13:00, 930 -> 09:30, interruption duration auto-calculated. Missing KWH rows auto-filled (web-style) when gaps are clean.',
              ),
            ),
          ),
          const Divider(),
          _DailyLogChartTable(
            hours: _dailyHours,
            feeders: _substationFeeders,
            getCellValue: _getCellValue,
            onChangedCell: _setCellValue,
          ),
          const SizedBox(height: 8),
          _DynamicRowsCard(
            title: 'Interruptions',
            columns: const ['feederId', 'from_time', 'to_time', 'event_type', 'remark'],
            feeders: _substationFeeders,
            rows: _interruptions,
            onChanged: (v) => setState(() => _interruptions = v),
          ),
          if (_interruptions.isNotEmpty)
            Card(
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Interruption durations', style: TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    ..._interruptions.map((r) {
                      final from = _normalizeTime((r['from_time'] ?? '').toString());
                      final to = _normalizeTime((r['to_time'] ?? '').toString(), allowTwentyFour: true);
                      final fromM = _timeToMinutes(from);
                      final toM = _timeToMinutes(to, allowTwentyFour: true);
                      final duration = (fromM != null && toM != null && toM >= fromM) ? toM - fromM : null;
                      final feeder = _substationFeeders
                          .where((f) => (f['id'] ?? '').toString() == (r['feederId'] ?? '').toString())
                          .map((f) => (f['name'] ?? '').toString())
                          .firstOrNull;
                      return ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text('${feeder ?? '-'} | ${r['event_type'] ?? '-'}'),
                        subtitle: Text('${from.isEmpty ? '--:--' : from} -> ${to.isEmpty ? '--:--' : to}'),
                        trailing: Text(duration == null ? '-' : _formatDuration(duration)),
                      );
                    }),
                  ],
                ),
              ),
            ),
          _DynamicRowsCard(
            title: 'Meter changes',
            columns: const ['feederId', 'effective_time', 'oldMeterLastReading', 'newMeterStartReading', 'remark'],
            feeders: _substationFeeders,
            rows: _meterChanges,
            onChanged: (v) => setState(() => _meterChanges = v),
          ),
          Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('00:00-24:00 Hourly Total (Auto)', style: TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  ..._hourlySummary().map(
                    (h) => ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(h['time'].toString()),
                      subtitle: Text(
                        'Total Amp: ${(h['ampTotal'] as double).toStringAsFixed(2)} | Avg KV: ${(h['kvAvg'] as double).toStringAsFixed(2)}',
                      ),
                      trailing: Text((h['kwhTotal'] as double).toStringAsFixed(2)),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Feeder Summary (Auto)', style: TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  ..._feederSummary().map(
                    (f) => ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text((f['name'] ?? '-').toString()),
                      subtitle: Text('Max Amp: ${(f['ampMax'] as double).toStringAsFixed(2)}'),
                      trailing: Text((f['kwhTotal'] as double).toStringAsFixed(2)),
                    ),
                  ),
                ],
              ),
            ),
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
                          keyboardType: c.contains('time')
                              ? TextInputType.datetime
                              : ((c == 'kwh' || c == 'amp' || c == 'kv')
                                  ? const TextInputType.numberWithOptions(decimal: true)
                                  : TextInputType.text),
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

class _DailyLogChartTable extends StatelessWidget {
  const _DailyLogChartTable({
    required this.hours,
    required this.feeders,
    required this.getCellValue,
    required this.onChangedCell,
  });

  final List<String> hours;
  final List<Map<String, dynamic>> feeders;
  final String Function(String hour, String feederId, String key) getCellValue;
  final void Function(String hour, String feederId, String key, String value) onChangedCell;

  @override
  Widget build(BuildContext context) {
    if (feeders.isEmpty) {
      return const Card(
        child: ListTile(
          title: Text('No feeders'),
          subtitle: Text('First add feeder in Masters, then chart table will appear'),
        ),
      );
    }

    final columns = <DataColumn>[
      const DataColumn(label: SizedBox(width: 64, child: Text('Hour'))),
    ];
    for (final feeder in feeders) {
      final name = (feeder['name'] ?? '-').toString();
      columns.add(DataColumn(label: SizedBox(width: 190, child: Text(name))));
    }

    final rows = hours.map((hour) {
      final cells = <DataCell>[
        DataCell(Text(hour, style: const TextStyle(fontWeight: FontWeight.w700))),
      ];
      for (final feeder in feeders) {
        final feederId = (feeder['id'] ?? '').toString();
        cells.add(
          DataCell(
            SizedBox(
              width: 190,
              child: Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      initialValue: getCellValue(hour, feederId, 'amp'),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'A', isDense: true),
                      onChanged: (v) => onChangedCell(hour, feederId, 'amp', v),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: TextFormField(
                      initialValue: getCellValue(hour, feederId, 'kv'),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'KV', isDense: true),
                      onChanged: (v) => onChangedCell(hour, feederId, 'kv', v),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: TextFormField(
                      initialValue: getCellValue(hour, feederId, 'kwh'),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'KWH', isDense: true),
                      onChanged: (v) => onChangedCell(hour, feederId, 'kwh', v),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      }
      return DataRow(cells: cells);
    }).toList(growable: false);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Daily Log Chart Table (Web style)', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: ConstrainedBox(
                constraints: BoxConstraints(minWidth: MediaQuery.of(context).size.width - 28),
                child: DataTable(
                  headingRowColor: WidgetStatePropertyAll(
                    Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.35),
                  ),
                  dataRowMinHeight: 72,
                  dataRowMaxHeight: 82,
                  columns: columns,
                  rows: rows,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
