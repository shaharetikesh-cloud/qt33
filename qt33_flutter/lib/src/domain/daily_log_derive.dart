import 'dart:math' as math;

import 'package:qt33/src/domain/daily_log_kwh_gap_fill.dart';

/// Web `buildAutoLsState` ported for the Flutter **flat row** model
/// (`time`, `feederId`, `amp`, `kv`, `kwh`, `remark`, optional `metadata`).

class DailyLogDeriveResult {
  const DailyLogDeriveResult({
    required this.rows,
    required this.autoInterruptions,
  });

  final List<Map<String, dynamic>> rows;
  final List<Map<String, dynamic>> autoInterruptions;
}

double? _numericOrNull(Object? v) {
  if (v == null) return null;
  final s = v.toString().trim();
  if (s.isEmpty) return null;
  return num.tryParse(s)?.toDouble();
}

double _numericOrZero(Object? v) => _numericOrNull(v) ?? 0;

bool _isActualAnchor(Map<String, dynamic> row) {
  final meta = row['metadata'];
  final entryMode = meta is Map ? (meta['entryMode']?.toString() ?? '') : '';
  final kwh = _numericOrNull(row['kwh']);
  if (kwh == null) return false;
  return entryMode != 'estimated';
}

/// Matches web `countDecimalPlaces` for KWH strings (max 2 fractional digits).
int _kwhDecimalPlacesWeb(Object? raw) {
  final s = raw?.toString().trim() ?? '';
  final m = RegExp(r'\.(\d+)$').firstMatch(s);
  if (m == null) return 0;
  return math.min(2, m.group(1)!.length);
}

String _formatKwhWeb(double value, int precision) {
  if (!value.isFinite) return '';
  final rounded = double.parse(value.toStringAsFixed(precision));
  if (rounded == rounded.roundToDouble()) {
    return rounded.round().toString();
  }
  return rounded.toStringAsFixed(precision).replaceAll(RegExp(r'\.?0+$'), '');
}

String _formatAmpWeb(double value) {
  if (!value.isFinite) return '';
  return value.round().toString();
}

double? _manualAmp(Map<String, dynamic> row) {
  final meta = row['metadata'];
  if (meta is Map && meta['ampSourceType']?.toString() == 'auto_gap_fill') {
    return null;
  }
  return _numericOrNull(row['amp']);
}

List<double> _buildSoftAmpValues(double previousAmp, double? nextAmp, int intervalCount) {
  if (!previousAmp.isFinite || intervalCount <= 0) return const [];
  if (nextAmp == null || !nextAmp.isFinite) {
    return List<double>.filled(intervalCount, previousAmp);
  }
  final step = (nextAmp - previousAmp) / intervalCount;
  return List<double>.generate(intervalCount, (i) => previousAmp + step * (i + 1));
}

List<Map<String, dynamic>> _applyDistributedAmpFill(
  List<Map<String, dynamic>> ordered25,
  String feederId,
  int previousAnchorIndex,
  int currentRowIndex,
  List<int> gapIndexes,
) {
  final previousAmp = _manualAmp(ordered25[previousAnchorIndex]);
  final currentAmp = _manualAmp(ordered25[currentRowIndex]);
  final intervalCount = currentRowIndex - previousAnchorIndex;
  if (previousAmp == null || intervalCount <= 0) return ordered25;

  final distributedAmpValues = _buildSoftAmpValues(previousAmp, currentAmp, intervalCount);
  if (distributedAmpValues.length != intervalCount) return ordered25;

  final next = ordered25.map((e) => Map<String, dynamic>.from(e)).toList(growable: false);
  for (final rowIndex in gapIndexes) {
    final reading = Map<String, dynamic>.from(next[rowIndex]);
    final meta = Map<String, dynamic>.from((reading['metadata'] as Map?)?.cast<String, dynamic>() ?? {});
    if (meta['ampSourceType']?.toString() == 'manual') continue;

    final distributedAmp = distributedAmpValues[rowIndex - previousAnchorIndex - 1];
    if (!distributedAmp.isFinite) continue;

    meta['ampSourceType'] = 'auto_gap_fill';
    reading['amp'] = _formatAmpWeb(distributedAmp);
    reading['metadata'] = meta;
    next[rowIndex] = reading;
  }
  return next;
}

List<List<int>> _groupContiguousIndexes(List<int> indexes) {
  if (indexes.isEmpty) return const [];
  final groups = <List<int>>[];
  var current = <int>[indexes.first];
  for (var i = 1; i < indexes.length; i++) {
    if (indexes[i] == indexes[i - 1] + 1) {
      current.add(indexes[i]);
    } else {
      groups.add(current);
      current = [indexes[i]];
    }
  }
  groups.add(current);
  return groups;
}

List<Map<String, dynamic>> _createAutoLsInterruptionsForGroups({
  required Map<String, dynamic> feeder,
  required List<List<int>> groups,
  required List<String> dailyHours,
}) {
  final fid = feeder['id']?.toString() ?? '';
  final name = feeder['name']?.toString() ?? '';
  final out = <Map<String, dynamic>>[];
  for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    final group = groups[groupIndex];
    if (group.isEmpty) continue;
    final fromIdx = group.first;
    final toIdx = math.min(group.last + 1, dailyHours.length - 1);
    out.add({
      'id': 'auto-$fid-${group.first}-${group.last}-$groupIndex',
      'feederId': fid,
      'feeder_id': fid,
      'feeder_name': name,
      'from_time': dailyHours[fromIdx],
      'to_time': dailyHours[toIdx],
      'duration_minutes': group.length * 60,
      'duration_hours': double.parse((group.length).toStringAsFixed(2)),
      'event_type': 'LS',
      'source': 'auto',
      'is_auto': true,
      'generated_reason': 'unresolved_kwh_gap',
      'linked_auto_rule': 'unresolved_kwh_gap_finalize',
      'remark': 'Auto-generated from unresolved KWH gap.',
      'overlayHours': List<int>.from(group),
    });
  }
  return out;
}

Map<String, dynamic> _blankRow(String hour, String feederId) => {
      'time': hour,
      'feederId': feederId,
      'kwh': '',
      'amp': '',
      'kv': '',
      'remark': '',
    };

List<Map<String, dynamic>> _orderedRowsForFeeder({
  required List<Map<String, dynamic>> allRows,
  required String feederId,
  required List<String> dailyHours,
}) {
  final byHour = <String, Map<String, dynamic>>{};
  for (final row in allRows) {
    if ((row['feederId'] ?? '').toString() != feederId) continue;
    final t = (row['time'] ?? '').toString();
    if (t.isEmpty) continue;
    byHour[t] = Map<String, dynamic>.from(row);
  }
  return dailyHours
      .map((h) => Map<String, dynamic>.from(byHour[h] ?? _blankRow(h, feederId)))
      .toList(growable: false);
}

void _writeFeederSlice(
  List<Map<String, dynamic>> allRows,
  String feederId,
  List<Map<String, dynamic>> ordered25,
) {
  allRows.removeWhere((r) => (r['feederId'] ?? '').toString() == feederId);
  for (final r in ordered25) {
    allRows.add(Map<String, dynamic>.from(r));
  }
}

/// Runs web-equivalent `buildAutoLsState` over flat rows for substation [feeders].
/// [manualInterruptionsOnly] must already exclude `source == auto` rows (caller strips).
DailyLogDeriveResult deriveDailyLogFlatForSave({
  required List<String> dailyHours,
  required List<Map<String, dynamic>> rows,
  required List<Map<String, dynamic>> manualInterruptionsOnly,
  required List<Map<String, dynamic>> feeders,
  required String mode,
}) {
  final explicit = buildExplicitOverlayMap(manualInterruptionsOnly);
  final next = rows.map((r) => Map<String, dynamic>.from(r)).toList();
  final autoInterruptions = <Map<String, dynamic>>[];
  final isFinalized = mode == 'finalized';

  for (final feeder in feeders) {
    final fid = feeder['id']?.toString() ?? '';
    if (fid.isEmpty) continue;

    var ordered = _orderedRowsForFeeder(allRows: next, feederId: fid, dailyHours: dailyHours);
    if (ordered.length != dailyHours.length) continue;

    // Baseline: clear stale pending-gap flags before re-derive (web resets pendingGap each pass).
    for (var i = 0; i < ordered.length; i++) {
      final row = Map<String, dynamic>.from(ordered[i]);
      final meta = Map<String, dynamic>.from((row['metadata'] as Map?)?.cast<String, dynamic>() ?? {});
      meta['pendingGap'] = false;
      meta['eventCode'] = '';
      meta['eventOrigin'] = '';
      meta['interruptionLinkId'] = '';
      row['metadata'] = meta;
      ordered[i] = row;
    }

    final anchorIndexes = <int>[];
    for (var i = 0; i < ordered.length; i++) {
      if (_isActualAnchor(ordered[i])) anchorIndexes.add(i);
    }
    if (anchorIndexes.isEmpty) {
      _writeFeederSlice(next, fid, ordered);
      continue;
    }

    for (var a = 0; a < anchorIndexes.length - 1; a++) {
      final left = anchorIndexes[a];
      final right = anchorIndexes[a + 1];
      if (right - left <= 1) continue;

      final missing = getEstimatableGapIndexes(ordered, fid, left, right, explicit);
      if (missing == null || missing.isEmpty) continue;

      final startVal = _numericOrZero(ordered[left]['kwh']);
      final endVal = _numericOrZero(ordered[right]['kwh']);
      if (endVal < startVal) continue;

      final precision = math.max(
        _kwhDecimalPlacesWeb(ordered[left]['kwh']),
        _kwhDecimalPlacesWeb(ordered[right]['kwh']),
      );
      final intervalCount = right - left;
      final distributed = buildDistributedCumulativeValues(startVal, endVal, intervalCount, precision);
      if (distributed.length != intervalCount) continue;

      for (final rowIndex in missing) {
        final dv = distributed[rowIndex - left - 1];
        final row = Map<String, dynamic>.from(ordered[rowIndex]);
        final meta = Map<String, dynamic>.from((row['metadata'] as Map?)?.cast<String, dynamic>() ?? {});
        meta['entryMode'] = 'estimated';
        meta['source'] = 'distributed:${dailyHours[left]}-${dailyHours[right]}';
        meta['sourceType'] = 'auto_gap_fill';
        meta['pendingGap'] = false;
        meta['eventBlocked'] = false;
        meta['lsBlocked'] = false;
        row['kwh'] = _formatKwhWeb(dv, precision);
        row['metadata'] = meta;
        ordered[rowIndex] = row;
      }
      ordered = _applyDistributedAmpFill(ordered, fid, left, right, missing);
    }

    final lastAnchor = anchorIndexes.last;
    final trailing = <int>[];
    for (var rowIndex = lastAnchor + 1; rowIndex < dailyHours.length; rowIndex++) {
      if (_numericOrNull(ordered[rowIndex]['kwh']) != null) continue;
      if (explicit.containsKey('$fid:$rowIndex')) continue;
      trailing.add(rowIndex);
    }

    if (trailing.isNotEmpty) {
      if (isFinalized) {
        final groups = _groupContiguousIndexes(trailing);
        autoInterruptions.addAll(
          _createAutoLsInterruptionsForGroups(feeder: feeder, groups: groups, dailyHours: dailyHours),
        );
      } else {
        for (final hourIndex in trailing) {
          final row = Map<String, dynamic>.from(ordered[hourIndex]);
          final meta = Map<String, dynamic>.from((row['metadata'] as Map?)?.cast<String, dynamic>() ?? {});
          meta['pendingGap'] = true;
          meta['sourceType'] = '';
          meta['eventCode'] = '';
          meta['eventOrigin'] = '';
          row['metadata'] = meta;
          ordered[hourIndex] = row;
        }
      }
    }

    _writeFeederSlice(next, fid, ordered);
  }

  return DailyLogDeriveResult(rows: next, autoInterruptions: autoInterruptions);
}
