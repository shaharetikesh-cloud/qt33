enum Qt33Role { superAdmin, substationAdmin, normalUser, viewer }

Qt33Role parseRole(String value) {
  switch (value) {
    case 'super_admin':
    case 'admin':
      return Qt33Role.superAdmin;
    case 'substation_admin':
      return Qt33Role.substationAdmin;
    case 'viewer':
      return Qt33Role.viewer;
    default:
      return Qt33Role.normalUser;
  }
}

class ModulePermission {
  const ModulePermission({
    required this.view,
    required this.create,
    required this.update,
    required this.delete,
  });

  final bool view;
  final bool create;
  final bool update;
  final bool delete;
}

ModulePermission permissionForRole(Qt33Role role) {
  if (role == Qt33Role.superAdmin || role == Qt33Role.substationAdmin) {
    return const ModulePermission(view: true, create: true, update: true, delete: true);
  }
  if (role == Qt33Role.viewer) {
    return const ModulePermission(view: true, create: false, update: false, delete: false);
  }
  return const ModulePermission(view: true, create: true, update: true, delete: false);
}
