import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qt33/src/data/workspace_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _kThemeModePref = 'qt33_theme_mode';

final themeModeProvider = StateNotifierProvider<ThemeModeController, ThemeMode>((ref) {
  return ThemeModeController();
});

class ThemeModeController extends StateNotifier<ThemeMode> {
  ThemeModeController() : super(ThemeMode.system) {
    _init();
  }

  Future<void> _init() async {
    final prefs = await SharedPreferences.getInstance();
    final fromPref = _parse(prefs.getString(_kThemeModePref));
    if (fromPref != null) {
      state = fromPref;
      return;
    }
    try {
      final bundle = await WorkspaceRepository().getSettingsBundle();
      final appUi = bundle['appUi'] as Map?;
      final fromDb = _parse(appUi?['themeMode']?.toString());
      if (fromDb != null) {
        state = fromDb;
        await prefs.setString(_kThemeModePref, _serialize(fromDb));
      }
    } catch (_) {
      // keep system default
    }
  }

  static String _serialize(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'light';
      case ThemeMode.dark:
        return 'dark';
      case ThemeMode.system:
        return 'system';
    }
  }

  static ThemeMode? _parse(String? raw) {
    switch ((raw ?? '').trim().toLowerCase()) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      case 'system':
        return ThemeMode.system;
      default:
        return null;
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kThemeModePref, _serialize(mode));
  }
}
