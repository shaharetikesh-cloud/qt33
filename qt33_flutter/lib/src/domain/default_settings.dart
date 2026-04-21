// Mirrors web `defaultSettings` in `unifiedDataService.js`.

Map<String, dynamic> defaultSettingsBundle() => {
      'companyProfile': {
        'companyName': 'Maharashtra State Electricity Distribution Co. Ltd.',
        'officeName': 'Unified MSEDCL Office',
        'address': '',
        'contactNumber': '',
        'reportFooter': 'Generated from Unified MSEDCL Software',
      },
      'printSettings': {
        'compactTables': true,
        'defaultOrientation': 'portrait',
        'fontScale': 1,
      },
      'attendanceRules': {
        'operatorShiftCycle': ['OFF', 'II', 'III', 'I', 'II', 'III', 'I'],
        'operatorGeneralDutyPattern': ['OFF', 'II', 'III', 'I', 'G', 'G', 'G'],
        'generalDutyCode': 'G',
        'weeklyOffCode': 'WO',
        'weeklyOffShiftCode': 'OFF',
        'presentCode': 'P',
        'defaultWeeklyOffDay': 0,
        'nightAllowanceRate': 150,
        'abnormalConsumptionThresholdPercent': 20,
      },
      'appUi': {
        'themeMode': 'system',
      },
    };
