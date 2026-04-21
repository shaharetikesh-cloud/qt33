import 'dart:math' as math;

/// Web parity helpers ported from `src/lib/dailyLog.js`:
/// `applyAutomaticKwhGapFill`, `getEstimatableGapIndexes`, `buildDistributedCumulativeValues`,
/// `buildExplicitOverlayMap`, `findPreviousActualAnchorIndex`, `timeToHourIndex`.

double? _numericOrNull(Object? v) {
  if (v == null) return null;
  final s = v.toString().trim();
  if (s.isEmpty) return null;
  return num.tryParse(s)?.toDouble();
}

int _countDecimalPlaces(Object? raw) {
  final s = raw?.toString().trim() ?? '';
  if (s.isEmpty) return 2;
  final lower = s.toLowerCase();
  if (lower.contains('e')) {
    return 2;
  }
  final idx = s.indexOf('.');
  if (idx < 0) return 0;
  return math.max(0, s.length - idx - 1);
}

String _formatKwhValue(double value, int precision) {
  if (precision <= 0) {
    return value.round().toString();
  }
  return value.toStringAsFixed(precision);
}

/// Same rounding / remainder distribution as web `buildDistributedCumulativeValues`.
List<double> buildDistributedCumulativeValues(
  double startValue,
  double endValue,
  int intervalCount,
  int precision,
) {
  if (!startValue.isFinite || !endValue.isFinite || intervalCount <= 0) {
    return const [];
  }
  final scale = math.pow(10, precision).toInt();
  final startScaled = (startValue * scale).round();
  final endScaled = (endValue * scale).round();
  final deltaScaled = endScaled - startScaled;
  if (deltaScaled < 0) return const [];

  final baseIncrement = deltaScaled ~/ intervalCount;
  final remainder = deltaScaled - baseIncrement * intervalCount;
  final out = <double>[];
  var running = startScaled;
  for (var stepIndex = 0; stepIndex < intervalCount; stepIndex++) {
    final extra = stepIndex >= intervalCount - remainder ? 1 : 0;
    running += baseIncrement + extra;
    out.add(running / scale);
  }
  return out;
}

int? _parseTimeToMinutes(String? raw) {
  final s = (raw ?? '').trim();
  if (s.isEmpty) return null;
  final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(s);
  if (m == null) return null;
  final h = int.tryParse(m.group(1)!);
  final min = int.tryParse(m.group(2)!);
  if (h == null || min == null || min < 0 || min > 59) return null;
  if (h == 24) return min == 0 ? 24 * 60 : null;
  if (h < 0 || h > 23) return null;
  return h * 60 + min;
}

int timeToHourIndex(String? value, {bool preferEnd = false}) {
  final minutes = _parseTimeToMinutes(value);
  if (minutes == null) return -1;
  final raw = preferEnd ? (minutes / 60).ceil() : (minutes / 60).floor();
  return math.max(0, math.min(24, raw));
}

Map<String, Map<String, dynamic>> buildExplicitOverlayMap(List<Map<String, dynamic>> interruptions) {
  final overlay = <String, Map<String, dynamic>>{};
  for (final interruption in interruptions) {
    final from = interruption['from_time']?.toString() ?? '';
    final to = interruption['to_time']?.toString() ?? '';
    final startHourIndex = timeToHourIndex(from);
    final endHourIndex = timeToHourIndex(to, preferEnd: true);
    if (startHourIndex < 0 || endHourIndex < 0 || endHourIndex < startHourIndex) {
      continue;
    }
    final affected = interruption['affectedFeederIds'] as List?;
    final single = interruption['feeder_id'] ?? interruption['feederId'];
    final feederIds = (affected != null && affected.isNotEmpty)
        ? affected.map((e) => e.toString()).toList()
        : [single?.toString() ?? ''].where((e) => e.isNotEmpty).toList();
    for (final feederId in feederIds) {
      for (var hourIndex = startHourIndex; hourIndex < endHourIndex; hourIndex++) {
        overlay['$feederId:$hourIndex'] = {
          'code': interruption['event_type'] ?? interruption['eventType'],
          'source': interruption['source'] ?? 'explicit',
          'interruptionId': interruption['id'],
        };
      }
    }
  }
  return overlay;
}

bool _isActualAnchor(Map<String, dynamic> row) {
  final meta = row['metadata'];
  final entryMode = meta is Map ? (meta['entryMode']?.toString() ?? '') : '';
  final kwh = _numericOrNull(row['kwh']);
  if (kwh == null) return false;
  return entryMode != 'estimated';
}

int findPreviousActualAnchorIndex(List<Map<String, dynamic>> orderedRows, int currentRowIndex) {
  for (var i = currentRowIndex - 1; i >= 0; i--) {
    final row = orderedRows[i];
    if (!_isActualAnchor(row)) continue;
    return i;
  }
  return -1;
}

/// Returns gap hour indexes between anchors, or null if estimation must abort (blocked / conflict).
List<int>? getEstimatableGapIndexes(
  List<Map<String, dynamic>> orderedRows,
  String feederId,
  int previousAnchorIndex,
  int currentRowIndex,
  Map<String, Map<String, dynamic>> explicitOverlayMap,
) {
  final gap = <int>[];
  for (var rowIndex = previousAnchorIndex + 1; rowIndex < currentRowIndex; rowIndex++) {
    if (explicitOverlayMap.containsKey('$feederId:$rowIndex')) {
      return null;
    }
    final reading = orderedRows[rowIndex];
    final hasKwh = _numericOrNull(reading['kwh']) != null;
    final meta = reading['metadata'];
    final entryMode = meta is Map ? (meta['entryMode']?.toString() ?? '') : '';
    if (!hasKwh || entryMode == 'estimated') {
      gap.add(rowIndex);
      continue;
    }
    return null;
  }
  return gap.isEmpty ? null : gap;
}

/// [orderedRows] must be exactly 25 rows for 00:00..24:00 for this feeder, in hour order.
List<Map<String, dynamic>> applyAutomaticKwhGapFill(
  List<Map<String, dynamic>> orderedRows,
  String feederId,
  int currentRowIndex,
  List<Map<String, dynamic>> interruptions,
) {
  if (orderedRows.length != 25 || currentRowIndex < 0 || currentRowIndex >= orderedRows.length) {
    return orderedRows;
  }
  final currentReading = orderedRows[currentRowIndex];
  final currentValue = _numericOrNull(currentReading['kwh']);
  if (currentValue == null) {
    return orderedRows;
  }
  final previousAnchorIndex = findPreviousActualAnchorIndex(orderedRows, currentRowIndex);
  if (previousAnchorIndex < 0) {
    return orderedRows;
  }
  final previousReading = orderedRows[previousAnchorIndex];
  final previousValue = _numericOrNull(previousReading['kwh']);
  if (previousValue == null || currentValue < previousValue) {
    return orderedRows;
  }
  final explicit = buildExplicitOverlayMap(interruptions);
  final gapIndexes = getEstimatableGapIndexes(
    orderedRows,
    feederId,
    previousAnchorIndex,
    currentRowIndex,
    explicit,
  );
  if (gapIndexes == null || gapIndexes.isEmpty) {
    return orderedRows;
  }
  final precision = math.max(
    _countDecimalPlaces(previousReading['kwh']),
    _countDecimalPlaces(currentReading['kwh']),
  );
  final intervalCount = currentRowIndex - previousAnchorIndex;
  final distributed = buildDistributedCumulativeValues(
    previousValue,
    currentValue,
    intervalCount,
    precision,
  );
  if (distributed.length != intervalCount) {
    return orderedRows;
  }
  final next = orderedRows.map((e) => Map<String, dynamic>.from(e)).toList(growable: false);
  final prevHour = next[previousAnchorIndex]['time']?.toString() ?? '';
  final curHour = next[currentRowIndex]['time']?.toString() ?? '';
  for (final rowIndex in gapIndexes) {
    final distributedValue = distributed[rowIndex - previousAnchorIndex - 1];
    final existing = Map<String, dynamic>.from(next[rowIndex]);
    final meta = Map<String, dynamic>.from((existing['metadata'] as Map?)?.cast<String, dynamic>() ?? {});
    meta['entryMode'] = 'estimated';
    meta['source'] = 'distributed:$prevHour-$curHour';
    meta['eventBlocked'] = false;
    meta['lsBlocked'] = false;
    existing['kwh'] = _formatKwhValue(distributedValue, precision);
    existing['metadata'] = meta;
    next[rowIndex] = existing;
  }
  return next;
}
