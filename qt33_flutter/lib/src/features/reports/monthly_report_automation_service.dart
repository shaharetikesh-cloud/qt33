import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/workspace_repository.dart';

class MonthlyReportAutomationService {
  MonthlyReportAutomationService({
    required ModuleRecordRepository moduleRepo,
    required WorkspaceRepository workspaceRepo,
  })  : _moduleRepo = moduleRepo,
        _workspaceRepo = workspaceRepo;

  final ModuleRecordRepository _moduleRepo;
  final WorkspaceRepository _workspaceRepo;

  static const reportKeys = [
    'monthlyConsumption',
    'dailyMinMaxSummary',
    'monthlyMinMax',
    'monthlyInterruption',
    'monthlyEnergyBalance',
    'feederLoadTrend',
    'abnormalConsumption',
    'eventImpact',
    'dataCompleteness',
    'mainIncReconciliation',
  ];

  Future<void> regenerateForMonth({
    required String substationId,
    required String monthKey,
  }) async {
    if (substationId.trim().isEmpty || monthKey.trim().isEmpty) return;
    final daily = await _moduleRepo.listByModule('daily_log');
    final faultsA = await _moduleRepo.listByModule('fault');
    final faultsB = await _moduleRepo.listByModule('faults');
    final maintenance = await _moduleRepo.listByModule('maintenance');
    final battery = await _moduleRepo.listByModule('battery');
    final handover = await _moduleRepo.listByModule('charge_handover');
    final feeders = await _workspaceRepo.listMasterRecords('feeders');

    bool inScope(ModuleRecord r) {
      final p = r.payload;
      final date = (p['operationalDate'] ??
              p['date'] ??
              p['faultDate'] ??
              p['workDate'] ??
              p['handoverDate'] ??
              '')
          .toString();
      return (r.substationId ?? '') == substationId && date.startsWith(monthKey);
    }

    final dailyRows = daily.where(inScope).toList(growable: false);
    final faultRows = [...faultsA.where(inScope), ...faultsB.where(inScope)];
    final maintRows = maintenance.where(inScope).toList(growable: false);
    final batteryRows = battery.where(inScope).toList(growable: false);
    final handoverRows = handover.where(inScope).toList(growable: false);

    final counts = {
      'dailyLog': dailyRows.length,
      'faults': faultRows.length,
      'maintenance': maintRows.length,
      'battery': batteryRows.length,
      'handover': handoverRows.length,
    };

    for (final key in reportKeys) {
      final rows = _buildRowsForReport(
        reportKey: key,
        dailyRows: dailyRows,
        faultRows: faultRows,
        maintenanceRows: maintRows,
        batteryRows: batteryRows,
        handoverRows: handoverRows,
        feeders: feeders,
        substationId: substationId,
      );

      final id = 'report:$substationId:$monthKey:$key';
      await _moduleRepo.upsert(
        id: id,
        moduleKey: 'report_snapshot',
        substationId: substationId,
        title: '$monthKey|$key',
        payload: {
          'monthKey': monthKey,
          'reportKey': key,
          'rows': rows,
          'counts': counts,
          'generatedAt': DateTime.now().toUtc().toIso8601String(),
        },
      );
    }
  }

  Future<Map<String, dynamic>?> getSnapshot({
    required String substationId,
    required String monthKey,
    required String reportKey,
  }) async {
    final id = 'report:$substationId:$monthKey:$reportKey';
    final rows = await _moduleRepo.listByModule('report_snapshot');
    final hit = rows.where((r) => r.id == id).firstOrNull;
    return hit?.payload;
  }

  List<Map<String, String>> _buildRowsForReport({
    required String reportKey,
    required List<ModuleRecord> dailyRows,
    required List<ModuleRecord> faultRows,
    required List<ModuleRecord> maintenanceRows,
    required List<ModuleRecord> batteryRows,
    required List<ModuleRecord> handoverRows,
    required List<Map<String, dynamic>> feeders,
    required String substationId,
  }) {
    final feederRows = dailyRows
        .expand((d) => ((d.payload['rows'] as List?) ?? const []).whereType<Map>())
        .toList(growable: false);
    final interruptions = dailyRows
        .expand((d) => ((d.payload['interruptions'] as List?) ?? const []).whereType<Map>())
        .toList(growable: false);
    final meterChanges = dailyRows
        .expand((d) => ((d.payload['meterChangeEvents'] as List?) ?? const []).whereType<Map>())
        .toList(growable: false);

    num toNum(dynamic v) => num.tryParse((v ?? '').toString()) ?? 0;
    num sumKwh = feederRows.fold<num>(0, (p, r) => p + toNum(r['kwh']));

    if (reportKey == 'monthlyConsumption') {
      return [
        {'field': 'Total feeder rows', 'value': '${feederRows.length}'},
        {'field': 'Monthly kWh', 'value': sumKwh.toStringAsFixed(2)},
        {'field': 'Meter change events', 'value': '${meterChanges.length}'},
      ];
    }
    if (reportKey == 'dailyMinMaxSummary' || reportKey == 'monthlyMinMax') {
      num? minAmp;
      num? maxAmp;
      for (final r in feederRows) {
        final amp = toNum(r['amp']);
        minAmp = minAmp == null ? amp : (amp < minAmp ? amp : minAmp);
        maxAmp = maxAmp == null ? amp : (amp > maxAmp ? amp : maxAmp);
      }
      return [
        {'field': 'Min amp', 'value': (minAmp ?? 0).toStringAsFixed(2)},
        {'field': 'Max amp', 'value': (maxAmp ?? 0).toStringAsFixed(2)},
        {'field': 'Rows analysed', 'value': '${feederRows.length}'},
      ];
    }
    if (reportKey == 'monthlyInterruption') {
      final faultDuration = faultRows.fold<num>(
        0,
        (p, r) => p + toNum(r.payload['durationMinutes']) / 60.0,
      );
      return [
        {'field': 'Interruption rows (DLR)', 'value': '${interruptions.length}'},
        {'field': 'Fault rows', 'value': '${faultRows.length}'},
        {'field': 'Fault duration (hrs)', 'value': faultDuration.toStringAsFixed(2)},
      ];
    }
    if (reportKey == 'monthlyEnergyBalance' || reportKey == 'mainIncReconciliation') {
      final mainIncomingIds = feeders
          .where((f) =>
              (f['substationId'] ?? '').toString() == substationId &&
              ((f['isMainIncoming'] == true) || (f['feederType'] ?? '').toString() == 'main_incoming'))
          .map((f) => (f['id'] ?? '').toString())
          .where((id) => id.isNotEmpty)
          .toSet();
      num incoming = 0;
      num outgoing = 0;
      for (final row in feederRows) {
        final kwh = toNum(row['kwh']);
        final fid = (row['feederId'] ?? '').toString();
        if (mainIncomingIds.contains(fid)) {
          incoming += kwh;
        } else {
          outgoing += kwh;
        }
      }
      final loss = incoming - outgoing;
      final lossPct = incoming == 0 ? 0 : (loss / incoming) * 100;
      return [
        {'field': 'Incoming kWh', 'value': incoming.toStringAsFixed(2)},
        {'field': 'Outgoing kWh', 'value': outgoing.toStringAsFixed(2)},
        {'field': 'Loss kWh', 'value': loss.toStringAsFixed(2)},
        {'field': 'Loss %', 'value': '${lossPct.toStringAsFixed(2)}%'},
      ];
    }
    if (reportKey == 'feederLoadTrend') {
      final totals = <String, num>{};
      for (final row in feederRows) {
        final fid = (row['feederId'] ?? '').toString();
        totals[fid] = (totals[fid] ?? 0) + toNum(row['kwh']);
      }
      final sorted = totals.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
      if (sorted.isEmpty) {
        return [
          {'field': 'Trend', 'value': 'No data'},
        ];
      }
      return sorted
          .take(5)
          .map((e) => {'field': 'Feeder ${e.key}', 'value': e.value.toStringAsFixed(2)})
          .toList(growable: false);
    }
    if (reportKey == 'abnormalConsumption') {
      final high = feederRows.where((r) => toNum(r['kwh']) > 1000).length;
      final low = feederRows.where((r) => toNum(r['kwh']) > 0 && toNum(r['kwh']) < 10).length;
      return [
        {'field': 'High rows (>1000)', 'value': '$high'},
        {'field': 'Low rows (<10)', 'value': '$low'},
        {'field': 'Total rows', 'value': '${feederRows.length}'},
      ];
    }
    if (reportKey == 'eventImpact') {
      return [
        {'field': 'Fault events', 'value': '${faultRows.length}'},
        {'field': 'Maintenance events', 'value': '${maintenanceRows.length}'},
        {'field': 'Battery events', 'value': '${batteryRows.length}'},
        {'field': 'Charge handover events', 'value': '${handoverRows.length}'},
      ];
    }
    if (reportKey == 'dataCompleteness') {
      final withRows = dailyRows.where((d) => ((d.payload['rows'] as List?) ?? const []).isNotEmpty).length;
      final withInt = dailyRows.where((d) => ((d.payload['interruptions'] as List?) ?? const []).isNotEmpty).length;
      return [
        {'field': 'Daily logs', 'value': '${dailyRows.length}'},
        {'field': 'With feeder rows', 'value': '$withRows'},
        {'field': 'With interruptions', 'value': '$withInt'},
      ];
    }
    return [
      {'field': 'Details', 'value': 'No details'},
    ];
  }
}
