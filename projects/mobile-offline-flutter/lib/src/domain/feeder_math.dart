// Same rules as web `MastersPage.jsx` (CT ratio → MF suggestion).

String normalizeCtRatioValue(String? value) {
  return (value ?? '').trim().replaceAll(RegExp(r'\s+'), '');
}

bool isValidCtRatio(String? value) {
  return RegExp(r'^\d+/\d+$').hasMatch(normalizeCtRatioValue(value));
}

String suggestMfFromCtRatio(String? value) {
  if (!isValidCtRatio(value)) return '';
  final parts = normalizeCtRatioValue(value).split('/');
  final primary = num.tryParse(parts[0]);
  final secondary = num.tryParse(parts[1]);
  if (primary == null || secondary == null || secondary == 0) return '';
  final ratio = (primary / secondary).toDouble();
  if (!ratio.isFinite) return '';
  return ratio.toStringAsFixed(2);
}

Map<String, dynamic> applyFeederCtRatioChange(
  Map<String, dynamic> currentForm,
  String nextCtRatio,
) {
  final previousSuggestion = suggestMfFromCtRatio(
    currentForm['ctRatio']?.toString(),
  );
  final nextSuggestion = suggestMfFromCtRatio(nextCtRatio);
  final currentMf = (currentForm['mf'] ?? '').toString().trim();
  final shouldAutoUpdateMf =
      currentMf.isEmpty || (previousSuggestion.isNotEmpty && currentMf == previousSuggestion);

  return {
    ...currentForm,
    'ctRatio': nextCtRatio,
    'mf': shouldAutoUpdateMf ? nextSuggestion : currentForm['mf'],
  };
}

/// Web `handleMasterSave` normalizes feeder expected unit fields.
Map<String, dynamic> normalizeFeederRecordForSave(Map<String, dynamic> record) {
  final eu =
      record['expectedUnit'] ??
      record['expected_unit'] ??
      record['daily_expected_unit'] ??
      '';
  return {
    ...record,
    'expectedUnit': eu,
    'expected_unit': eu,
    'daily_expected_unit': eu,
  };
}
