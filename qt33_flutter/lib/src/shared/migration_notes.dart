/// QT33 migration checklist from existing unifiedDataService:
/// - masters/settings/user mappings
/// - attendance documents
/// - DLR records
/// - report snapshots
/// - notices and feedback
/// - audit events
///
/// Keep this file as a source-of-truth checklist while porting logic.
const migrationChecklist = <String>[
  'loadWorkspaceConfiguration',
  'saveMasterRecord',
  'saveSettingsBundle',
  'saveUserSubstationMapping',
  'saveAttendanceDocument',
  'saveDlrRecord',
  'listHistoryRegisterEntries',
  'saveReportSnapshot',
  'saveNotice',
  'saveFeedbackEntry',
  'updateFeedbackEntry',
  'buildBackupSnapshot',
  'importBackupSnapshot',
];
