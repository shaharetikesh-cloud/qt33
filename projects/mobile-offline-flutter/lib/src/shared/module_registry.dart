class ModuleDefinition {
  const ModuleDefinition({
    required this.key,
    required this.title,
    required this.group,
    required this.allowCreate,
  });

  final String key;
  final String title;
  final String group;
  final bool allowCreate;
}

const qt33Modules = <ModuleDefinition>[
  ModuleDefinition(key: 'daily_log', title: 'Daily Log', group: 'operations', allowCreate: true),
  ModuleDefinition(key: 'battery', title: 'Battery', group: 'operations', allowCreate: true),
  ModuleDefinition(key: 'faults', title: 'Fault Register', group: 'operations', allowCreate: true),
  ModuleDefinition(key: 'maintenance', title: 'Maintenance', group: 'operations', allowCreate: true),
  ModuleDefinition(key: 'charge_handover', title: 'Charge Handover', group: 'operations', allowCreate: true),
  ModuleDefinition(key: 'history_register', title: 'History Register', group: 'operations', allowCreate: false),
  ModuleDefinition(key: 'reports', title: 'Report Center', group: 'reports', allowCreate: false),
  ModuleDefinition(key: 'month_end_pack', title: 'Month End Pack', group: 'reports', allowCreate: false),
  ModuleDefinition(key: 'notices', title: 'Notice Board', group: 'communication', allowCreate: true),
  ModuleDefinition(key: 'feedback', title: 'Feedback', group: 'communication', allowCreate: true),
  ModuleDefinition(key: 'substations', title: 'Substations', group: 'admin', allowCreate: true),
  ModuleDefinition(key: 'employees', title: 'Employees', group: 'admin', allowCreate: true),
  ModuleDefinition(key: 'masters', title: 'Masters', group: 'admin', allowCreate: true),
  ModuleDefinition(key: 'users', title: 'Users', group: 'admin', allowCreate: true),
  ModuleDefinition(key: 'audit', title: 'Audit Trail', group: 'admin', allowCreate: false),
  ModuleDefinition(key: 'session', title: 'Session', group: 'admin', allowCreate: false),
];
