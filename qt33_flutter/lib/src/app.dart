import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qt33/src/data/theme_mode_controller.dart';
import 'package:qt33/src/features/dashboard/home_shell.dart';
import 'package:qt33/src/features/dlr/battery_mobile_page.dart';
import 'package:qt33/src/features/dlr/charge_handover_mobile_page.dart';
import 'package:qt33/src/features/dlr/daily_log_mobile_page.dart';
import 'package:qt33/src/features/dlr/faults_mobile_page.dart';
import 'package:qt33/src/features/dlr/history_register_mobile_page.dart';
import 'package:qt33/src/features/dlr/maintenance_mobile_page.dart';
import 'package:qt33/src/features/dlr/month_end_pack_mobile_page.dart';
import 'package:qt33/src/features/dlr/report_center_mobile_page.dart';
import 'package:qt33/src/features/dlr/session_mobile_page.dart';
import 'package:qt33/src/features/dlr/users_mobile_page.dart';
import 'package:qt33/src/features/masters/masters_workspace_page.dart';
import 'package:qt33/src/features/modules/module_page.dart';

final _routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const HomeShell(),
      ),
      GoRoute(
        path: '/module/:key',
        builder: (context, state) {
          final key = state.pathParameters['key'] ?? '';
          if (key == 'masters') {
            return const MastersWorkspacePage();
          }
          if (key == 'daily_log') {
            return const DailyLogMobilePage();
          }
          if (key == 'battery') {
            return const BatteryMobilePage();
          }
          if (key == 'faults') {
            return const FaultsMobilePage();
          }
          if (key == 'charge_handover') {
            return const ChargeHandoverMobilePage();
          }
          if (key == 'maintenance') {
            return const MaintenanceMobilePage();
          }
          if (key == 'reports') {
            return const ReportCenterMobilePage();
          }
          if (key == 'month_end_pack') {
            return const MonthEndPackMobilePage();
          }
          if (key == 'history_register') {
            return const HistoryRegisterMobilePage();
          }
          if (key == 'session') {
            return const SessionMobilePage();
          }
          if (key == 'users') {
            return const UsersMobilePage();
          }
          return ModulePage(moduleKey: key);
        },
      ),
    ],
  );
});

class Qt33App extends ConsumerWidget {
  const Qt33App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(_routerProvider);
    final themeMode = ref.watch(themeModeProvider);
    return MaterialApp.router(
      title: 'QT33',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0A6DFF),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
        ),
        cardTheme: const CardThemeData(
          elevation: 0.5,
          margin: EdgeInsets.symmetric(vertical: 6),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF6EA8FF),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
        ),
        cardTheme: const CardThemeData(
          elevation: 0.5,
          margin: EdgeInsets.symmetric(vertical: 6),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        visualDensity: VisualDensity.adaptivePlatformDensity,
      ),
      themeMode: themeMode,
      routerConfig: router,
    );
  }
}
