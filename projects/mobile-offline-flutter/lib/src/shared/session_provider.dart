import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qt33/src/shared/rbac.dart';

class SessionUser {
  const SessionUser({
    required this.userId,
    required this.fullName,
    required this.role,
  });

  final String userId;
  final String fullName;
  final Qt33Role role;
}

class SessionController extends StateNotifier<SessionUser?> {
  /// Single-user offline: full app access without a separate “admin” login flow.
  SessionController() : super(_offlineUser);

  static const SessionUser _offlineUser = SessionUser(
    userId: 'offline',
    fullName: 'QT33 Offline',
    role: Qt33Role.superAdmin,
  );

  void login({
    required String userId,
    required String fullName,
    required String role,
  }) {
    state = SessionUser(
      userId: userId,
      fullName: fullName,
      role: parseRole(role),
    );
  }

  void logout() => state = _offlineUser;
}

final sessionControllerProvider =
    StateNotifierProvider<SessionController, SessionUser?>((ref) {
  return SessionController();
});
