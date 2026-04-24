import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class DraftStore {
  Future<void> saveDraft({
    required String moduleKey,
    required Map<String, dynamic> data,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('draft:$moduleKey', jsonEncode(data));
  }

  Future<Map<String, dynamic>> loadDraft(String moduleKey) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('draft:$moduleKey');
    if (raw == null || raw.isEmpty) return {};
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> clearDraft(String moduleKey) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('draft:$moduleKey');
  }
}
