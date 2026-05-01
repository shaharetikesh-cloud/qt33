(function (global) {
  const App = global.SubstationRegisterApp = global.SubstationRegisterApp || {};

  const STORAGE_KEY = "msedcl-substation-register-system";
  const SAFETY_BACKUP_KEY = "msedcl-substation-register-system-safety-backups";
  const SETTINGS_STORAGE_KEY = STORAGE_KEY + "-settings";
  const SUMMARY_STORAGE_KEY = STORAGE_KEY + "-summary";
  const STORAGE_RUNTIME_KEY = STORAGE_KEY + "-runtime";
  const INDEXED_DB_NAME = STORAGE_KEY + "-indexeddb";
  const INDEXED_DB_VERSION = 3;
  const SYSTEM_STORE_NAME = "__system";
  const SAFETY_BACKUP_STORE_NAME = "__safetyBackups";
  const SCHEMA_VERSION = 11;
  const BACKUP_FORMAT_VERSION = 1;
  const MAX_SAFETY_BACKUPS = 5;
  const IMPORT_BATCH_SIZE = 200;
  const RECENT_ACTIVITY_LIMIT = 12;
  const FEEDER_TYPES = ["INCOMING_11KV", "OUTGOING_11KV", "INCOMING_33KV", "EXPRESS_33KV", "OTHER", "TOTAL"];
  const COLLECTION_NAMES = [
    "substations",
    "users",
    "dailyLogs",
    "meterChangeEvents",
    "faultAutoSuppressions",
    "faults",
    "maintenanceLogs",
    "batteryRecords",
    "transformerHistory",
    "vcbHistory",
    "equipmentChangeHistory",
    "modificationHistory",
    "chargeHandoverRecords",
    "settings"
  ];
  const OPERATIONAL_COLLECTION_NAMES = COLLECTION_NAMES.filter(function (name) {
    return name !== "settings";
  });
  const SUBSTATION_SCOPED_COLLECTIONS = [
    "dailyLogs",
    "meterChangeEvents",
    "faultAutoSuppressions",
    "faults",
    "maintenanceLogs",
    "batteryRecords",
    "transformerHistory",
    "vcbHistory",
    "equipmentChangeHistory",
    "modificationHistory",
    "chargeHandoverRecords"
  ];

  const defaultSettings = {
    theme: "light",
    appName: "MSEDCL Substation Register System",
    companyName: "Maharashtra State Electricity Distribution Co. Ltd.",
    officeNote: "Offline local operation and maintenance register",
    futureSync: {
      enabled: false,
      provider: "Supabase + Cloudflare Pages",
      projectId: "",
      notes: ""
    }
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix) {
    return [prefix, Date.now(), Math.random().toString(36).slice(2, 8)].join("-");
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function ensureArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function mergeSettings(source) {
    const input = source || {};
    return {
      theme: input.theme || defaultSettings.theme,
      appName: input.appName || defaultSettings.appName,
      companyName: input.companyName || defaultSettings.companyName,
      officeNote: input.officeNote || defaultSettings.officeNote,
      futureSync: {
        enabled: Boolean(input.futureSync && input.futureSync.enabled),
        provider: (input.futureSync && input.futureSync.provider) || defaultSettings.futureSync.provider,
        projectId: (input.futureSync && input.futureSync.projectId) || "",
        notes: (input.futureSync && input.futureSync.notes) || ""
      }
    };
  }

  function numericString(value, fallback) {
    const text = value === null || value === undefined ? "" : String(value).trim();
    if (!text) {
      return fallback;
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) ? String(parsed) : fallback;
  }

  function normalizeCtRatioString(value, fallback) {
    const text = value === null || value === undefined ? "" : String(value).trim();
    if (!text) {
      return fallback;
    }

    const compact = text.replace(/\s+/g, "");
    if (/^\d+\/\d+$/.test(compact)) {
      return compact;
    }

    if (/^\d+$/.test(compact)) {
      return compact + "/1";
    }

    return fallback;
  }

  function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
  }

  function boundedCount(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(1, Math.min(3, Math.round(parsed)));
  }

  function stringValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function isBlankValue(value) {
    return value === "" || value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  }

  function normalizeReadingEntryMode(entryMode, hasValue) {
    const normalized = String(entryMode || "").trim().toLowerCase();

    if (normalized === "actual" || normalized === "estimated") {
      return hasValue ? normalized : "missing";
    }

    if (normalized === "ls_blocked") {
      return hasValue ? "actual" : "ls_blocked";
    }

    if (normalized === "missing") {
      return hasValue ? "actual" : "missing";
    }

    return hasValue ? "actual" : "missing";
  }

  function normalizeReadingEntrySource(entryMode, source, fallbackSource) {
    const normalizedSource = String(source || "").trim();
    if (normalizedSource) {
      return normalizedSource;
    }

    if (entryMode === "estimated") {
      return "auto_interpolated";
    }

    if (entryMode === "actual") {
      return fallbackSource || "manual";
    }

    if (entryMode === "ls_blocked") {
      return "ls_blocked";
    }

    return "";
  }

  function normalizeReadingEntryMeta(value, meta, fallbackSource) {
    const source = meta && typeof meta === "object" ? meta : {};
    const hasValue = !isBlankValue(value);
    const entryMode = normalizeReadingEntryMode(source.entryMode, hasValue);

    return {
      entryMode: entryMode,
      source: normalizeReadingEntrySource(entryMode, source.source, fallbackSource)
    };
  }

  function getLegacyReadingMeta(reading, fieldName) {
    if (!reading || typeof reading !== "object") {
      return null;
    }

    return {
      entryMode: reading[fieldName + "EntryMode"],
      source: reading[fieldName + "Source"]
    };
  }

  function normalizeDailyLogFeederReading(reading) {
    const source = reading && typeof reading === "object" ? reading : {};
    const metaSource = source.meta && typeof source.meta === "object" ? source.meta : {};
    const normalized = {
      amp: stringValue(source.amp).trim(),
      kv: stringValue(source.kv).trim(),
      kwh: stringValue(source.kwh).trim()
    };

    normalized.meta = {
      amp: normalizeReadingEntryMeta(normalized.amp, metaSource.amp || getLegacyReadingMeta(source, "amp"), "manual"),
      kv: normalizeReadingEntryMeta(normalized.kv, metaSource.kv || getLegacyReadingMeta(source, "kv"), "manual"),
      kwh: normalizeReadingEntryMeta(normalized.kwh, metaSource.kwh || getLegacyReadingMeta(source, "kwh"), "manual")
    };

    if (normalized.meta.kwh.entryMode === "ls_blocked") {
      normalized.kwh = "";
    }

    return normalized;
  }

  function normalizeFaultSource(value) {
    const normalized = String(value || "MANUAL").trim().toUpperCase();

    if (normalized === "AUTO") {
      return "AUTO_GAP";
    }

    if (["MANUAL", "AUTO_GAP", "AUTO_EVENT", "PROPAGATED_EVENT"].indexOf(normalized) >= 0) {
      return normalized;
    }

    return "MANUAL";
  }

  function normalizeAuditValue(value) {
    return String(value || "").trim();
  }

  function readAuditFields(source) {
    const record = source || {};
    return {
      createdByUserId: normalizeAuditValue(record.createdByUserId),
      createdByUsername: normalizeAuditValue(record.createdByUsername),
      updatedByUserId: normalizeAuditValue(record.updatedByUserId),
      updatedByUsername: normalizeAuditValue(record.updatedByUsername)
    };
  }

  function applyAuditFields(target, source) {
    return Object.assign(target, readAuditFields(source));
  }

  function normalizeUserRole(value) {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized === "SUBSTATION_USER" ? "SUBSTATION_USER" : "MAIN_ADMIN";
  }

  function normalizeUserRecord(user) {
    const source = user || {};
    const role = normalizeUserRole(source.role);
    return {
      id: source.id || createId("user"),
      username: String(source.username || "").trim(),
      usernameKey: String(source.usernameKey || source.username || "").trim().toLowerCase(),
      passwordHash: String(source.passwordHash || "").trim(),
      passwordSalt: String(source.passwordSalt || "").trim(),
      role: role,
      assignedSubstationId: role === "SUBSTATION_USER" ? String(source.assignedSubstationId || "").trim() : "",
      isActive: source.isActive !== false,
      mustChangePassword: Boolean(source.mustChangePassword),
      lastLoginAt: String(source.lastLoginAt || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    };
  }

  function normalizeDailyLogEvent(record) {
    const source = record || {};
    return {
      id: source.id || createId("dlrevent"),
      type: String(source.type || source.eventType || "").trim().toUpperCase(),
      source: String(source.source || "MANUAL_EVENT").trim().toUpperCase(),
      scopeType: String(source.scopeType || "single_feeder").trim(),
      baseFeederId: String(source.baseFeederId || "").trim(),
      baseFeederName: String(source.baseFeederName || "").trim(),
      affectedFeederIds: ensureArray(source.affectedFeederIds).map(function (item) {
        return String(item || "").trim();
      }).filter(Boolean),
      affectedFeederNames: ensureArray(source.affectedFeederNames).map(function (item) {
        return String(item || "").trim();
      }).filter(Boolean),
      fromTime: String(source.fromTime || "").trim(),
      toTime: String(source.toTime || "").trim(),
      remark: String(source.remark || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    };
  }

  function getFeederLabel(feeder) {
    return String((feeder && (feeder.feederName || feeder.name)) || "").trim();
  }

  function createDefaultTotalFeeder(sortOrder) {
    const order = positiveInteger(sortOrder, 999);
    return {
      id: createId("feeder"),
      feederName: "TOTAL",
      name: "TOTAL",
      feederType: "TOTAL",
      ctRatio: "1/1",
      mf: "1",
      parentFeederId: "",
      isMainInc: false,
      isVisible: true,
      sortOrder: order
    };
  }

  function createFeederTemplate(overrides) {
    return Object.assign({
      id: createId("feeder"),
      feederName: "",
      name: "",
      feederType: "OUTGOING_11KV",
      ctRatio: "",
      mf: "",
      parentFeederId: "",
      isMainInc: false,
      is33kvFeeder: false,
      is33kvExpress: false,
      isVisible: true,
      sortOrder: 1
    }, overrides || {});
  }

  function normalizeFeederRecord(feeder, index, legacyDefaults) {
    const source = feeder || {};
    const fallback = legacyDefaults || { ctRatio: "1/1", mf: "1" };
    let feederType = String(source.feederType || "").trim().toUpperCase();

    if (FEEDER_TYPES.indexOf(feederType) === -1) {
      if (feederType === "INCOMING") {
        feederType = source.is33kvFeeder ? "INCOMING_33KV" : "INCOMING_11KV";
      } else if (feederType === "OUTGOING") {
        feederType = "OUTGOING_11KV";
      } else if (feederType === "TRANSFORMER") {
        feederType = "OTHER";
      } else {
        feederType = source.isMainInc ? "INCOMING_11KV" : (source.is33kvFeeder ? "INCOMING_33KV" : "OUTGOING_11KV");
      }
    }

    const feederName = getFeederLabel(source) || (feederType === "TOTAL" ? "TOTAL" : "");
    const normalized = createFeederTemplate({
      id: source.id || createId("feeder"),
      feederName: feederType === "TOTAL" ? "TOTAL" : feederName,
      name: feederType === "TOTAL" ? "TOTAL" : feederName,
      feederType: feederType,
      ctRatio: normalizeCtRatioString(source.ctRatio, fallback.ctRatio || "1/1"),
      mf: numericString(source.mf || source.multiplierFactor, fallback.mf || "1"),
      parentFeederId: feederType === "TOTAL" ? "" : String(source.parentFeederId || "").trim(),
      isMainInc: feederType === "INCOMING_11KV" && Boolean(source.isMainInc),
      is33kvFeeder: feederType === "INCOMING_33KV" || feederType === "EXPRESS_33KV" || Boolean(source.is33kvFeeder),
      is33kvExpress: feederType === "EXPRESS_33KV" || Boolean(source.is33kvExpress),
      isVisible: feederType === "TOTAL" ? true : source.isVisible !== false,
      sortOrder: positiveInteger(source.sortOrder, index + 1)
    });

    if (normalized.parentFeederId === normalized.id) {
      normalized.parentFeederId = "";
    }

    if (normalized.isMainInc || normalized.feederType === "INCOMING_33KV" || normalized.feederType === "EXPRESS_33KV") {
      normalized.parentFeederId = "";
    }

    if (normalized.feederType !== "INCOMING_11KV") {
      normalized.isMainInc = false;
    }

    return normalized;
  }

  function ensureSingleTotalFeeder(feeders) {
    const ordered = ensureArray(feeders).slice();
    let totalKept = false;

    ordered.forEach(function (feeder, index) {
      if (feeder.feederType !== "TOTAL") {
        return;
      }

      if (!totalKept) {
        totalKept = true;
        feeder.feederName = "TOTAL";
        feeder.name = "TOTAL";
        feeder.parentFeederId = "";
        feeder.isMainInc = false;
        feeder.isVisible = true;
        feeder.sortOrder = positiveInteger(feeder.sortOrder, index + 1);
        return;
      }

      feeder.feederType = "OUTGOING_11KV";
      feeder.parentFeederId = "";
      feeder.isMainInc = false;
      feeder.feederName = feeder.feederName || ("Converted Feeder " + (index + 1));
      feeder.name = feeder.feederName;
    });

    if (!totalKept) {
      ordered.push(createDefaultTotalFeeder((ordered.length || 0) + 1));
    }

    return ordered;
  }

  function validateParentMappings(feeders) {
    const mainIncomingIds = {};

    feeders.forEach(function (feeder) {
      if (feeder.feederType === "INCOMING_11KV" && feeder.isMainInc) {
        mainIncomingIds[feeder.id] = true;
      }
    });

    feeders.forEach(function (feeder) {
      if (feeder.feederType === "TOTAL") {
        feeder.parentFeederId = "";
        feeder.isMainInc = false;
        feeder.isVisible = true;
        return;
      }

      if (feeder.isMainInc) {
        feeder.parentFeederId = "";
      }

      if (feeder.parentFeederId && !mainIncomingIds[feeder.parentFeederId]) {
        feeder.parentFeederId = "";
      }
    });

    return feeders;
  }

  function sortFeeders(feeders) {
    return ensureArray(feeders).slice().sort(function (left, right) {
      const leftOrder = positiveInteger(left.sortOrder, 999);
      const rightOrder = positiveInteger(right.sortOrder, 999);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (left.feederType === "TOTAL" && right.feederType !== "TOTAL") {
        return 1;
      }
      if (left.feederType !== "TOTAL" && right.feederType === "TOTAL") {
        return -1;
      }
      return getFeederLabel(left).localeCompare(getFeederLabel(right));
    });
  }

  function normalizeSubstationRecord(substation) {
    const source = substation || {};
    const legacyDefaults = {
      ctRatio: normalizeCtRatioString(source.ctRatio, "1/1"),
      mf: numericString(source.multiplierFactor || source.mf, "1")
    };

    let feeders = ensureArray(source.feeders).map(function (feeder, index) {
      return normalizeFeederRecord(feeder, index, legacyDefaults);
    });

    feeders = ensureSingleTotalFeeder(feeders);
    feeders = validateParentMappings(feeders);
    feeders = sortFeeders(feeders);

    return {
      id: source.id || createId("substation"),
      name: String(source.name || "").trim(),
      voltageLevel: String(source.voltageLevel || "").trim(),
      division: String(source.division || "").trim(),
      circle: String(source.circle || "").trim(),
      location: String(source.location || "").trim(),
      batterySetCount: boundedCount(source.batterySetCount, 1),
      transformerCount: boundedCount(source.transformerCount, 1),
      feeders: feeders,
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    };
  }

  function buildDailyLogFeederSnapshot(record, substation) {
    const sourceFeeders = ensureArray(record && record.feederSnapshot);
    const currentFeeders = ensureArray(substation && substation.feeders);
    const currentById = currentFeeders.reduce(function (accumulator, feeder) {
      accumulator[feeder.id] = feeder;
      return accumulator;
    }, {});

    const currentByName = currentFeeders.reduce(function (accumulator, feeder) {
      accumulator[getFeederLabel(feeder).toLowerCase()] = feeder;
      return accumulator;
    }, {});

    const baseFeeders = sourceFeeders.length ? sourceFeeders : currentFeeders;
    let snapshot = baseFeeders.map(function (feeder, index) {
      const matched = currentById[feeder.id] || currentByName[getFeederLabel(feeder).toLowerCase()] || null;
      const merged = Object.assign({}, matched || {}, feeder);
      return normalizeFeederRecord(merged, index, {
        ctRatio: normalizeCtRatioString(matched && matched.ctRatio, "1/1"),
        mf: numericString(matched && matched.mf, "1")
      });
    });

    snapshot = ensureSingleTotalFeeder(snapshot);
    snapshot = validateParentMappings(snapshot);
    return sortFeeders(snapshot);
  }

  function normalizeDailyLogRows(rows, feederSnapshot, substation) {
    const batterySetCount = boundedCount(substation && substation.batterySetCount, 1);
    const transformerCount = boundedCount(substation && substation.transformerCount, 1);

    return Array.from({ length: 25 }, function (_, index) {
      const hourLabel = String(index).padStart(2, "0") + ":00";
      const row = Array.isArray(rows) && rows[index] ? clone(rows[index]) : {};
      const feederReadings = row.feederReadings || {};

      feederSnapshot.forEach(function (feeder) {
        feederReadings[feeder.id] = normalizeDailyLogFeederReading(feederReadings[feeder.id]);
      });

      return {
        hour: row.hour || hourLabel,
        feederReadings: feederReadings,
        busVoltage: row.busVoltage || "",
        batteryVoltage: row.batteryVoltage || "",
        incomer: row.incomer || "",
        transformer: row.transformer || "",
        batteryVoltages: Array.from({ length: batterySetCount }, function (_, batteryIndex) {
          return Array.isArray(row.batteryVoltages) && row.batteryVoltages[batteryIndex] !== undefined
            ? String(row.batteryVoltages[batteryIndex] || "")
            : (batteryIndex === 0 ? String(row.batteryVoltage || "") : "");
        }),
        tapPositions: Array.from({ length: transformerCount }, function (_, tapIndex) {
          return Array.isArray(row.tapPositions) && row.tapPositions[tapIndex] !== undefined
            ? String(row.tapPositions[tapIndex] || "")
            : (tapIndex === 0 ? String(row.transformer || "") : "");
        }),
        remark: row.remark || ""
      };
    });
  }

  function normalizeDailyLogRecord(record, substation) {
    const source = record || {};
    const feederSnapshot = buildDailyLogFeederSnapshot(source, substation);
    return applyAuditFields({
      id: source.id || createId("dailylog"),
      substationId: source.substationId || (substation ? substation.id : ""),
      date: source.date || "",
      operatorName: String(source.operatorName || "").trim(),
      feederSnapshot: feederSnapshot,
      substationSnapshot: Object.assign({}, source.substationSnapshot || {}, substation ? {
        name: substation.name,
        division: substation.division,
        circle: substation.circle,
        location: substation.location,
        voltageLevel: substation.voltageLevel,
        batterySetCount: boundedCount(substation.batterySetCount, 1),
        transformerCount: boundedCount(substation.transformerCount, 1)
      } : {}),
      rows: normalizeDailyLogRows(source.rows, feederSnapshot, substation),
      events: ensureArray(source.events).map(normalizeDailyLogEvent),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeMeterChangeEvent(event) {
    const source = event || {};
    return applyAuditFields({
      id: source.id || createId("meterchange"),
      substationId: String(source.substationId || "").trim(),
      feederId: String(source.feederId || "").trim(),
      feederName: String(source.feederName || "").trim(),
      effectiveDate: String(source.effectiveDate || source.date || "").trim(),
      effectiveTime: String(source.effectiveTime || source.time || "").trim(),
      oldMeterLastReading: numericString(source.oldMeterLastReading, ""),
      newMeterStartReading: numericString(source.newMeterStartReading, ""),
      remark: String(source.remark || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeFaultRecord(fault) {
    const source = fault || {};
    return applyAuditFields({
      id: source.id || createId("fault"),
      date: String(source.date || "").trim(),
      substationId: String(source.substationId || "").trim(),
      substationName: String(source.substationName || "").trim(),
      feederId: String(source.feederId || "").trim(),
      feederName: String(source.feederName || "").trim(),
      operatorName: String(source.operatorName || "").trim(),
      startTime: String(source.startTime || "").trim(),
      endTime: String(source.endTime || "").trim(),
      durationMinutes: Number.isFinite(Number(source.durationMinutes)) ? Number(source.durationMinutes) : 0,
      faultType: String(source.faultType || "").trim().toUpperCase(),
      source: normalizeFaultSource(source.source),
      autoKey: String(source.autoKey || "").trim(),
      autoRule: String(source.autoRule || "").trim(),
      linkedEventId: String(source.linkedEventId || "").trim(),
      remark: String(source.remark || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeFaultSuppression(record) {
    const source = record || {};
    return applyAuditFields({
      id: source.id || createId("faultsuppress"),
      autoKey: String(source.autoKey || "").trim(),
      substationId: String(source.substationId || "").trim(),
      feederId: String(source.feederId || "").trim(),
      date: String(source.date || "").trim(),
      startTime: String(source.startTime || "").trim(),
      endTime: String(source.endTime || "").trim(),
      faultType: String(source.faultType || "").trim().toUpperCase(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeBatteryCellReading(record, index) {
    const source = record || {};
    return {
      srNo: positiveInteger(source.srNo || source.serialNo, index + 1),
      serialNo: positiveInteger(source.serialNo || source.srNo, index + 1),
      specificGravity: String(source.specificGravity !== undefined ? source.specificGravity : (source.gravity !== undefined ? source.gravity : "")).trim(),
      voltage: String(source.voltage !== undefined ? source.voltage : "").trim(),
      remark: String(source.remark || "").trim()
    };
  }

  function normalizeBatteryRecord(record, substation) {
    const source = record || {};
    const sourceCells = ensureArray(source.cellReadings).length ? source.cellReadings : source.cells;
    const cellReadings = Array.from({ length: 15 }, function (_, index) {
      return normalizeBatteryCellReading(sourceCells[index], index);
    });
    const substationSnapshot = Object.assign({}, source.substationSnapshot || {}, substation ? {
      name: substation.name,
      division: substation.division,
      circle: substation.circle,
      location: substation.location,
      voltageLevel: substation.voltageLevel
    } : {});

    return applyAuditFields({
      id: source.id || createId("battery"),
      substationId: String(source.substationId || (substation ? substation.id : "")).trim(),
      substationName: String(source.substationName || substationSnapshot.name || "").trim(),
      date: String(source.date || "").trim(),
      day: String(source.day || "").trim(),
      weekKey: String(source.weekKey || "").trim(),
      weekLabel: String(source.weekLabel || "").trim(),
      batterySetName: String(source.batterySetName || "Battery 1").trim(),
      cellReadings: cellReadings,
      cells: cellReadings.map(function (cell) {
        return clone(cell);
      }),
      remarkChecks: ensureArray(source.remarkChecks).map(function (item) {
        return String(item || "").trim();
      }).filter(Boolean),
      generatedRemarkText: String(source.generatedRemarkText || "").trim(),
      legacyRemarkText: String(source.legacyRemarkText || source.remarkText || source.remark || "").trim(),
      gravityMax: isBlankValue(source.gravityMax) ? "" : Number(source.gravityMax),
      gravityMin: isBlankValue(source.gravityMin) ? "" : Number(source.gravityMin),
      voltageMax: isBlankValue(source.voltageMax) ? "" : Number(source.voltageMax),
      voltageMin: isBlankValue(source.voltageMin) ? "" : Number(source.voltageMin),
      totalVoltage: isBlankValue(source.totalVoltage) ? "" : Number(source.totalVoltage),
      gravityCondition: String(source.gravityCondition || "").trim(),
      voltageCondition: String(source.voltageCondition || "").trim(),
      overallBatteryCondition: String(source.overallBatteryCondition || source.condition || "").trim(),
      condition: String(source.condition || source.overallBatteryCondition || "").trim(),
      operatorName: String(source.operatorName || "").trim(),
      inchargeName: String(source.inchargeName || "").trim(),
      substationSnapshot: substationSnapshot,
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeTransformerHistoryRecord(record) {
    const source = record || {};
    return applyAuditFields({
      id: source.id || createId("transformerhistory"),
      substationId: String(source.substationId || "").trim(),
      substationName: String(source.substationName || "").trim(),
      transformerName: String(source.transformerName || "").trim(),
      mvaCapacity: String(source.mvaCapacity || "").trim(),
      voltageRatio: String(source.voltageRatio || "").trim(),
      serialNumber: String(source.serialNumber || "").trim(),
      manufacturerCompany: String(source.manufacturerCompany || "").trim(),
      manufacturingDate: String(source.manufacturingDate || "").trim(),
      installedDate: String(source.installedDate || source.commissionedDate || "").trim(),
      installedByAgency: String(source.installedByAgency || "").trim(),
      coolingType: String(source.coolingType || "").trim(),
      oltcType: String(source.oltcType || "").trim(),
      status: String(source.status || "").trim(),
      remark: String(source.remark || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeVcbHistoryRecord(record) {
    const source = record || {};
    return applyAuditFields({
      id: source.id || createId("vcbhistory"),
      substationId: String(source.substationId || "").trim(),
      substationName: String(source.substationName || "").trim(),
      feederId: String(source.feederId || "").trim(),
      feederName: String(source.feederName || "").trim(),
      vcbName: String(source.vcbName || "").trim(),
      vcbType: String(source.vcbType || "").trim(),
      manufacturerCompany: String(source.manufacturerCompany || "").trim(),
      serialNumber: String(source.serialNumber || "").trim(),
      manufacturingDate: String(source.manufacturingDate || "").trim(),
      installedDate: String(source.installedDate || "").trim(),
      installedByAgency: String(source.installedByAgency || "").trim(),
      panelName: String(source.panelName || "").trim(),
      ctRatio: String(source.ctRatio || "").trim(),
      ptRatio: String(source.ptRatio || "").trim(),
      status: String(source.status || "").trim(),
      remark: String(source.remark || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeEquipmentChangeHistoryRecord(record) {
    const source = record || {};
    return applyAuditFields({
      id: source.id || createId("equipmentchange"),
      date: String(source.date || "").trim(),
      substationId: String(source.substationId || "").trim(),
      substationName: String(source.substationName || "").trim(),
      equipmentType: String(source.equipmentType || "").trim(),
      feederId: String(source.feederId || "").trim(),
      feederName: String(source.feederName || "").trim(),
      equipmentName: String(source.equipmentName || "").trim(),
      oldDetails: String(source.oldDetails || "").trim(),
      newDetails: String(source.newDetails || "").trim(),
      reasonForChange: String(source.reasonForChange || "").trim(),
      agency: String(source.agency || "").trim(),
      approvedBy: String(source.approvedBy || "").trim(),
      remark: String(source.remark || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeModificationHistoryRecord(record) {
    const source = record || {};
    return applyAuditFields({
      id: source.id || createId("modificationhistory"),
      date: String(source.date || "").trim(),
      substationId: String(source.substationId || "").trim(),
      substationName: String(source.substationName || "").trim(),
      category: String(source.category || "").trim(),
      relatedEquipment: String(source.relatedEquipment || "").trim(),
      oldDetails: String(source.oldDetails || "").trim(),
      newDetails: String(source.newDetails || "").trim(),
      workDoneBy: String(source.workDoneBy || "").trim(),
      agency: String(source.agency || "").trim(),
      remark: String(source.remark || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeChargeHandoverRecord(record) {
    const source = record || {};
    return applyAuditFields({
      id: source.id || createId("chargehandover"),
      date: String(source.date || "").trim(),
      substationId: String(source.substationId || "").trim(),
      substationName: String(source.substationName || "").trim(),
      dutyType: String(source.dutyType || "").trim(),
      shiftType: String(source.shiftType || "").trim(),
      chargeGivenBy: String(source.chargeGivenBy || "").trim(),
      chargeTakenBy: String(source.chargeTakenBy || "").trim(),
      chargeGivenTime: String(source.chargeGivenTime || "").trim(),
      chargeTakenTime: String(source.chargeTakenTime || "").trim(),
      dutyStartTime: String(source.dutyStartTime || "").trim(),
      dutyEndTime: String(source.dutyEndTime || "").trim(),
      generalStatus: String(source.generalStatus || "").trim(),
      pendingWork: String(source.pendingWork || "").trim(),
      faultPending: String(source.faultPending || "").trim(),
      shutdownPending: String(source.shutdownPending || "").trim(),
      importantInstructions: String(source.importantInstructions || "").trim(),
      logbookUpdated: String(source.logbookUpdated || "").trim(),
      remark: String(source.remark || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function normalizeMaintenanceRecord(record) {
    const source = record || {};
    return applyAuditFields({
      id: source.id || createId("maintenance"),
      date: String(source.date || "").trim(),
      substationId: String(source.substationId || "").trim(),
      substationName: String(source.substationName || "").trim(),
      operatorName: String(source.operatorName || "").trim(),
      time: String(source.time || "").trim(),
      workDetail: String(source.workDetail || "").trim(),
      remark: String(source.remark || "").trim(),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    }, source);
  }

  function getSubstationFromDatabase(database, substationId) {
    return ensureArray(database && database.substations).find(function (item) {
      return item.id === substationId;
    }) || null;
  }

  function normalizeRecordForCollection(collectionName, record, database) {
    const target = String(collectionName || "").trim();
    const source = record || {};

    if (target === "substations") {
      return normalizeSubstationRecord(source);
    }

    if (target === "users") {
      return normalizeUserRecord(source);
    }

    if (target === "dailyLogs") {
      return normalizeDailyLogRecord(source, getSubstationFromDatabase(database, source.substationId));
    }

    if (target === "meterChangeEvents") {
      return normalizeMeterChangeEvent(source);
    }

    if (target === "faults") {
      return normalizeFaultRecord(source);
    }

    if (target === "faultAutoSuppressions") {
      return normalizeFaultSuppression(source);
    }

    if (target === "maintenanceLogs") {
      return normalizeMaintenanceRecord(source);
    }

    if (target === "batteryRecords") {
      return normalizeBatteryRecord(source, getSubstationFromDatabase(database, source.substationId));
    }

    if (target === "transformerHistory") {
      return normalizeTransformerHistoryRecord(source);
    }

    if (target === "vcbHistory") {
      return normalizeVcbHistoryRecord(source);
    }

    if (target === "equipmentChangeHistory") {
      return normalizeEquipmentChangeHistoryRecord(source);
    }

    if (target === "modificationHistory") {
      return normalizeModificationHistoryRecord(source);
    }

    if (target === "chargeHandoverRecords") {
      return normalizeChargeHandoverRecord(source);
    }

    if (target === "settings") {
      return mergeSettings(source);
    }

    return clone(source);
  }

  function buildBackupEnvelope(backupType, data, metadata) {
    return {
      backupType: backupType || "full_system",
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      generatedAt: nowIso(),
      metadata: Object.assign({}, metadata || {}),
      data: clone(data)
    };
  }

  function unwrapBackupPayload(payload) {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : clone(payload);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Backup payload is invalid.");
    }

    if (parsed.backupFormatVersion && parsed.data && typeof parsed.data === "object") {
      return {
        wrapped: true,
        envelope: parsed,
        data: parsed.data
      };
    }

    if (parsed.meta && parsed.substations !== undefined) {
      return {
        wrapped: false,
        envelope: buildBackupEnvelope("legacy_full_system", parsed, { legacy: true }),
        data: parsed
      };
    }

    throw new Error("Unsupported backup file structure.");
  }

  function readSafetyBackups() {
    const raw = global.localStorage.getItem(SAFETY_BACKUP_KEY);
    if (!raw) {
      return [];
    }

    try {
      return ensureArray(JSON.parse(raw)).filter(function (item) {
        return item && item.id;
      });
    } catch (error) {
      console.error("Unable to parse safety backups.", error);
      return [];
    }
  }

  function writeSafetyBackups(backups) {
    global.localStorage.setItem(SAFETY_BACKUP_KEY, JSON.stringify(ensureArray(backups)));
  }

  function createEmptyDatabase() {
    const timestamp = nowIso();
    return {
      meta: {
        schemaVersion: SCHEMA_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      substations: [],
      users: [],
      dailyLogs: [],
      meterChangeEvents: [],
      faultAutoSuppressions: [],
      faults: [],
      maintenanceLogs: [],
      batteryRecords: [],
      transformerHistory: [],
      vcbHistory: [],
      equipmentChangeHistory: [],
      modificationHistory: [],
      chargeHandoverRecords: [],
      settings: mergeSettings(defaultSettings)
    };
  }

  function normalizeDatabase(input) {
    const db = input && typeof input === "object" ? clone(input) : createEmptyDatabase();
    const substations = ensureArray(db.substations).map(normalizeSubstationRecord);
    const users = ensureArray(db.users).map(normalizeUserRecord);
    const substationById = substations.reduce(function (accumulator, item) {
      accumulator[item.id] = item;
      return accumulator;
    }, {});

    db.meta = db.meta || {};
    db.meta.schemaVersion = SCHEMA_VERSION;
    db.meta.createdAt = db.meta.createdAt || nowIso();
    db.meta.updatedAt = db.meta.updatedAt || nowIso();
    db.substations = substations;
    db.users = users;
    db.dailyLogs = ensureArray(db.dailyLogs).map(function (record) {
      return normalizeDailyLogRecord(record, substationById[record.substationId] || null);
    });
    db.meterChangeEvents = ensureArray(db.meterChangeEvents).map(normalizeMeterChangeEvent);
    db.faultAutoSuppressions = ensureArray(db.faultAutoSuppressions).map(normalizeFaultSuppression);
    db.faults = ensureArray(db.faults).map(normalizeFaultRecord);
    db.maintenanceLogs = ensureArray(db.maintenanceLogs).map(normalizeMaintenanceRecord);
    db.batteryRecords = ensureArray(db.batteryRecords).map(function (record) {
      return normalizeBatteryRecord(record, substationById[record.substationId] || null);
    });
    db.transformerHistory = ensureArray(db.transformerHistory).map(normalizeTransformerHistoryRecord);
    db.vcbHistory = ensureArray(db.vcbHistory).map(normalizeVcbHistoryRecord);
    db.equipmentChangeHistory = ensureArray(db.equipmentChangeHistory).map(normalizeEquipmentChangeHistoryRecord);
    db.modificationHistory = ensureArray(db.modificationHistory).map(normalizeModificationHistoryRecord);
    db.chargeHandoverRecords = ensureArray(db.chargeHandoverRecords).map(normalizeChargeHandoverRecord);
    db.settings = mergeSettings(db.settings);
    return db;
  }

  function readDatabase() {
    const raw = global.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createEmptyDatabase();
    }

    try {
      return normalizeDatabase(JSON.parse(raw));
    } catch (error) {
      console.error("Unable to parse stored data. Resetting local storage.", error);
      return createEmptyDatabase();
    }
  }

  function dispatchChange(detail) {
    global.dispatchEvent(new CustomEvent("substation-register:data-changed", { detail: detail || {} }));
  }

  function writeDatabase(database, detail) {
    const db = normalizeDatabase(database);
    db.meta.updatedAt = nowIso();
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    dispatchChange(detail);
    return clone(db);
  }

  function createEmptySummary() {
    const counts = {};
    COLLECTION_NAMES.forEach(function (collectionName) {
      counts[collectionName] = collectionName === "settings" ? 1 : 0;
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      lastUpdated: "",
      counts: counts,
      recentActivity: [],
      storageMode: global.indexedDB ? "indexeddb" : "localstorage"
    };
  }

  function readLocalSettings() {
    const raw = global.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (raw) {
      try {
        return mergeSettings(JSON.parse(raw));
      } catch (error) {
        console.error("Unable to parse stored settings. Falling back to defaults.", error);
      }
    }

    const legacy = readDatabase();
    return mergeSettings(legacy.settings || defaultSettings);
  }

  function writeLocalSettings(settings) {
    global.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(mergeSettings(settings)));
  }

  function readLocalSummary() {
    const raw = global.localStorage.getItem(SUMMARY_STORAGE_KEY);

    if (!raw) {
      return createEmptySummary();
    }

    try {
      const parsed = JSON.parse(raw);
      const summary = createEmptySummary();
      summary.schemaVersion = parsed && parsed.schemaVersion ? parsed.schemaVersion : SCHEMA_VERSION;
      summary.lastUpdated = parsed && parsed.lastUpdated ? parsed.lastUpdated : "";
      summary.counts = Object.assign(summary.counts, parsed && parsed.counts);
      summary.recentActivity = ensureArray(parsed && parsed.recentActivity).slice(0, RECENT_ACTIVITY_LIMIT).map(function (item) {
        return {
          collection: String(item.collection || "").trim(),
          recordId: String(item.recordId || "").trim(),
          type: String(item.type || "").trim(),
          date: String(item.date || "").trim(),
          substationName: String(item.substationName || "").trim(),
          details: String(item.details || "").trim(),
          timestamp: String(item.timestamp || "").trim()
        };
      });
      summary.storageMode = parsed && parsed.storageMode ? String(parsed.storageMode) : summary.storageMode;
      return summary;
    } catch (error) {
      console.error("Unable to parse stored summary. Rebuilding defaults.", error);
      return createEmptySummary();
    }
  }

  function writeLocalSummary(summary) {
    const next = createEmptySummary();
    next.schemaVersion = summary && summary.schemaVersion ? summary.schemaVersion : SCHEMA_VERSION;
    next.lastUpdated = summary && summary.lastUpdated ? summary.lastUpdated : "";
    next.counts = Object.assign(next.counts, summary && summary.counts);
    next.recentActivity = ensureArray(summary && summary.recentActivity).slice(0, RECENT_ACTIVITY_LIMIT).map(function (item) {
      return {
        collection: String(item.collection || "").trim(),
        recordId: String(item.recordId || "").trim(),
        type: String(item.type || "").trim(),
        date: String(item.date || "").trim(),
        substationName: String(item.substationName || "").trim(),
        details: String(item.details || "").trim(),
        timestamp: String(item.timestamp || "").trim()
      };
    });
    next.storageMode = summary && summary.storageMode ? String(summary.storageMode) : next.storageMode;
    global.localStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function getSubstationLookup(records) {
    return ensureArray(records).reduce(function (accumulator, item) {
      accumulator[item.id] = item;
      return accumulator;
    }, {});
  }

  function buildActivityEntry(collectionName, record, substationLookup) {
    if (!record || !collectionName) {
      return null;
    }

    const substationName = String(record.substationName ||
      (record.substationId && substationLookup && substationLookup[record.substationId] && substationLookup[record.substationId].name) ||
      "Unknown Substation").trim();

    if (collectionName === "dailyLogs") {
      return {
        collection: collectionName,
        recordId: String(record.id || "").trim(),
        type: "Daily Log",
        date: String(record.date || "").trim(),
        substationId: String(record.substationId || "").trim(),
        substationName: substationName,
        details: "Hourly log updated",
        timestamp: String(record.updatedAt || record.createdAt || nowIso())
      };
    }

    if (collectionName === "faults") {
      return {
        collection: collectionName,
        recordId: String(record.id || "").trim(),
        type: "Fault",
        date: String(record.date || "").trim(),
        substationId: String(record.substationId || "").trim(),
        substationName: substationName,
        details: String((record.feederName || "") + (record.faultType ? (" - " + record.faultType) : "")).trim(),
        timestamp: String(record.updatedAt || record.createdAt || nowIso())
      };
    }

    if (collectionName === "maintenanceLogs") {
      return {
        collection: collectionName,
        recordId: String(record.id || "").trim(),
        type: "Maintenance",
        date: String(record.date || "").trim(),
        substationId: String(record.substationId || "").trim(),
        substationName: substationName,
        details: String(record.workDetail || "").trim(),
        timestamp: String(record.updatedAt || record.createdAt || nowIso())
      };
    }

    if (collectionName === "batteryRecords") {
      return {
        collection: collectionName,
        recordId: String(record.id || "").trim(),
        type: "Battery Record",
        date: String(record.date || "").trim(),
        substationId: String(record.substationId || "").trim(),
        substationName: substationName,
        details: "Weekly battery maintenance record",
        timestamp: String(record.updatedAt || record.createdAt || nowIso())
      };
    }

    return null;
  }

  function buildRecentActivityFromDatabase(database) {
    const substationLookup = getSubstationLookup(database.substations);
    return ["dailyLogs", "faults", "maintenanceLogs", "batteryRecords"].reduce(function (accumulator, collectionName) {
      ensureArray(database[collectionName]).forEach(function (record) {
        const activity = buildActivityEntry(collectionName, record, substationLookup);
        if (activity) {
          accumulator.push(activity);
        }
      });
      return accumulator;
    }, []).sort(function (left, right) {
      return new Date(right.timestamp || 0) - new Date(left.timestamp || 0);
    }).slice(0, RECENT_ACTIVITY_LIMIT);
  }

  function buildSummaryFromDatabase(database) {
    const normalized = normalizeDatabase(database);
    const summary = createEmptySummary();

    summary.lastUpdated = normalized.meta.updatedAt || nowIso();
    COLLECTION_NAMES.forEach(function (collectionName) {
      summary.counts[collectionName] = collectionName === "settings"
        ? 1
        : ensureArray(normalized[collectionName]).length;
    });
    summary.recentActivity = buildRecentActivityFromDatabase(normalized);
    summary.storageMode = global.indexedDB ? "indexeddb" : "localstorage";
    return summary;
  }

  const runtime = {
    adapterMode: global.indexedDB ? "indexeddb" : "localstorage",
    initPromise: null,
    dbPromise: null,
    writeQueue: Promise.resolve(),
    cache: {},
    loaded: {},
    settings: readLocalSettings(),
    summary: readLocalSummary()
  };

  function getCurrentAuthUser() {
    return App.auth && typeof App.auth.getCurrentUser === "function" ? App.auth.getCurrentUser() : null;
  }
  function isCloudModeEnabled() {
    return Boolean(App.cloudSync && typeof App.cloudSync.isEnabled === "function" && App.cloudSync.isEnabled());
  }

  async function tryLoadCloudBootstrap() {
    if (!isCloudModeEnabled()) {
      return false;
    }

    try {
      await App.cloudSync.ensureInitialized();
      const cloudData = await App.cloudSync.loadBootstrapData();
      if (!cloudData) {
        return false;
      }

      OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
        const incoming = Array.isArray(cloudData[collectionName]) ? cloudData[collectionName] : [];
        runtime.cache[collectionName] = clone(incoming);
        runtime.loaded[collectionName] = true;
      });

      if (cloudData.settings && cloudData.settings.length) {
        syncRuntimeSettings(cloudData.settings[cloudData.settings.length - 1]);
      }

      syncRuntimeSummary(buildSummaryFromDatabase(getCachedDatabaseSnapshot()));
      return true;
    } catch (error) {
      console.error("Cloud bootstrap load failed.", error);
      return false;
    }
  }

  function queueCloudRecordSync(collectionName, record, operation) {
    if (!isCloudModeEnabled()) {
      return Promise.resolve(false);
    }

    return queueWrite(function () {
      return App.cloudSync.syncRecord(collectionName, record, operation);
    });
  }

  function queueCloudCollectionReplace(collectionName, records) {
    if (!isCloudModeEnabled()) {
      return Promise.resolve(false);
    }

    return queueWrite(function () {
      return App.cloudSync.syncCollectionReplace(collectionName, records);
    });
  }

  function isMainAdminUser(user) {
    return Boolean(user && String(user.role || "").toUpperCase() === "MAIN_ADMIN");
  }

  function isSubstationScopedUser(user) {
    return Boolean(user && String(user.role || "").toUpperCase() === "SUBSTATION_USER" && String(user.assignedSubstationId || "").trim());
  }

  function isSubstationScopedCollection(collectionName) {
    return SUBSTATION_SCOPED_COLLECTIONS.indexOf(String(collectionName || "").trim()) >= 0;
  }

  function isAdminOnlyCollection(collectionName) {
    return ["users"].indexOf(String(collectionName || "").trim()) >= 0;
  }

  function getScopedSubstationIdForUser(user) {
    return isSubstationScopedUser(user) ? String(user.assignedSubstationId || "").trim() : "";
  }

  function canUserAccessRecord(collectionName, record, user) {
    if (!user || isMainAdminUser(user)) {
      return true;
    }

    const scopedSubstationId = getScopedSubstationIdForUser(user);
    if (!scopedSubstationId) {
      return false;
    }

    if (String(collectionName || "").trim() === "substations") {
      return String(record && record.id || "").trim() === scopedSubstationId;
    }

    if (isSubstationScopedCollection(collectionName)) {
      return String(record && record.substationId || "").trim() === scopedSubstationId;
    }

    return !isAdminOnlyCollection(collectionName);
  }

  function getScopedRecordsForUser(collectionName, records) {
    const user = getCurrentAuthUser();
    const rows = ensureArray(records);

    if (!user || isMainAdminUser(user)) {
      return clone(rows);
    }

    return rows.filter(function (record) {
      return canUserAccessRecord(collectionName, record, user);
    }).map(clone);
  }

  function assertCollectionPermission(collectionName, action, record) {
    const user = getCurrentAuthUser();
    const target = String(collectionName || "").trim();

    if (!user || isMainAdminUser(user)) {
      return;
    }

    if (target === "settings" || isAdminOnlyCollection(target) || target === "substations") {
      throw new Error("You do not have permission to " + action + " this data.");
    }

    if (record && !canUserAccessRecord(target, record, user)) {
      throw new Error("You do not have permission to access another substation's data.");
    }
  }

  function mergeScopedCollectionWrite(collectionName, records) {
    const user = getCurrentAuthUser();
    const nextRecords = ensureArray(records);

    if (!isSubstationScopedUser(user) || !isSubstationScopedCollection(collectionName)) {
      return nextRecords;
    }

    const preservedRecords = ensureArray(runtime.cache[collectionName]).filter(function (record) {
      return !canUserAccessRecord(collectionName, record, user);
    });

    return preservedRecords.concat(nextRecords);
  }

  function applyAuditStamp(record, existingRecord) {
    const user = getCurrentAuthUser();
    if (!user) {
      return record;
    }

    return Object.assign({}, record, {
      createdByUserId: existingRecord && existingRecord.createdByUserId ? existingRecord.createdByUserId : String(record.createdByUserId || user.id || "").trim(),
      createdByUsername: existingRecord && existingRecord.createdByUsername ? existingRecord.createdByUsername : String(record.createdByUsername || user.username || "").trim(),
      updatedByUserId: String(user.id || "").trim(),
      updatedByUsername: String(user.username || "").trim()
    });
  }

  OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
    runtime.cache[collectionName] = [];
    runtime.loaded[collectionName] = false;
  });

  function getCachedDatabaseSnapshot() {
    const snapshot = createEmptyDatabase();
    snapshot.settings = mergeSettings(runtime.settings);
    snapshot.meta.updatedAt = runtime.summary.lastUpdated || snapshot.meta.updatedAt;

    OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
      snapshot[collectionName] = runtime.loaded[collectionName]
        ? clone(runtime.cache[collectionName])
        : [];
    });

    return snapshot;
  }

  function syncRuntimeSettings(settings) {
    runtime.settings = mergeSettings(settings);
    writeLocalSettings(runtime.settings);
    return clone(runtime.settings);
  }

  function syncRuntimeSummary(summary) {
    runtime.summary = writeLocalSummary(summary || createEmptySummary());
    runtime.summary.storageMode = runtime.adapterMode;
    writeLocalSummary(runtime.summary);
    return clone(runtime.summary);
  }

  function updateSummaryForCollection(collectionName, records, detail) {
    const nextSummary = clone(runtime.summary || createEmptySummary());
    nextSummary.schemaVersion = SCHEMA_VERSION;
    nextSummary.storageMode = runtime.adapterMode;
    nextSummary.lastUpdated = nowIso();
    nextSummary.counts[collectionName] = ensureArray(records).length;

    if (detail && detail.type === "delete" && detail.recordId) {
      nextSummary.recentActivity = ensureArray(nextSummary.recentActivity).filter(function (item) {
        return !(item.collection === collectionName && item.recordId === detail.recordId);
      });
    } else {
      const record = detail && detail.record ? detail.record : null;
      const activity = buildActivityEntry(collectionName, record, getSubstationLookup(runtime.loaded.substations ? runtime.cache.substations : []));
      if (activity) {
        nextSummary.recentActivity = ensureArray(nextSummary.recentActivity).filter(function (item) {
          return !(item.collection === activity.collection && item.recordId === activity.recordId);
        });
        nextSummary.recentActivity.unshift(activity);
        nextSummary.recentActivity = nextSummary.recentActivity.slice(0, RECENT_ACTIVITY_LIMIT);
      }
    }

    syncRuntimeSummary(nextSummary);
  }

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("IndexedDB request failed."));
      };
    });
  }

  function waitForTransaction(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () {
        resolve();
      };
      transaction.onerror = function () {
        reject(transaction.error || new Error("IndexedDB transaction failed."));
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error("IndexedDB transaction aborted."));
      };
    });
  }

  function yieldToBrowser() {
    return new Promise(function (resolve) {
      global.setTimeout(resolve, 0);
    });
  }

  function openIndexedDatabase() {
    if (runtime.dbPromise) {
      return runtime.dbPromise;
    }

    runtime.dbPromise = new Promise(function (resolve, reject) {
      const request = global.indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);

      request.onupgradeneeded = function (event) {
        const database = event.target.result;
        OPERATIONAL_COLLECTION_NAMES.concat([SYSTEM_STORE_NAME, SAFETY_BACKUP_STORE_NAME]).forEach(function (storeName) {
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName, { keyPath: "id" });
          }
        });

        if (database.objectStoreNames.contains(SYSTEM_STORE_NAME)) {
          const transaction = event.target.transaction;
          if (transaction) {
            const systemStore = transaction.objectStore(SYSTEM_STORE_NAME);
            if (!systemStore.indexNames.contains("kind")) {
              systemStore.createIndex("kind", "kind", { unique: false });
            }
          }
        }
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error || new Error("Unable to open IndexedDB."));
      };
    });

    return runtime.dbPromise;
  }

  async function getSystemRecord(recordId) {
    const database = await openIndexedDatabase();
    const transaction = database.transaction(SYSTEM_STORE_NAME, "readonly");
    const store = transaction.objectStore(SYSTEM_STORE_NAME);
    const result = await requestToPromise(store.get(recordId));
    await waitForTransaction(transaction);
    return result && result.value ? clone(result.value) : null;
  }

  async function putSystemRecord(recordId, value) {
    const database = await openIndexedDatabase();
    const transaction = database.transaction(SYSTEM_STORE_NAME, "readwrite");
    const store = transaction.objectStore(SYSTEM_STORE_NAME);
    store.put({
      id: recordId,
      kind: "system",
      value: clone(value),
      updatedAt: nowIso()
    });
    await waitForTransaction(transaction);
    return clone(value);
  }

  async function putSafetyBackupPayload(backupId, payload) {
    if (runtime.adapterMode !== "indexeddb") {
      return clone(payload);
    }

    const database = await openIndexedDatabase();
    const transaction = database.transaction(SAFETY_BACKUP_STORE_NAME, "readwrite");
    const store = transaction.objectStore(SAFETY_BACKUP_STORE_NAME);
    store.put({
      id: backupId,
      kind: "safety-backup",
      data: clone(payload),
      updatedAt: nowIso()
    });
    await waitForTransaction(transaction);
    return clone(payload);
  }

  async function getSafetyBackupPayload(backupId) {
    if (runtime.adapterMode !== "indexeddb") {
      return null;
    }

    const database = await openIndexedDatabase();
    const transaction = database.transaction(SAFETY_BACKUP_STORE_NAME, "readonly");
    const store = transaction.objectStore(SAFETY_BACKUP_STORE_NAME);
    const result = await requestToPromise(store.get(backupId));
    await waitForTransaction(transaction);
    return result && result.data ? clone(result.data) : null;
  }

  async function pruneSafetyBackupPayloads(validBackupIds) {
    if (runtime.adapterMode !== "indexeddb") {
      return;
    }

    const validIds = ensureArray(validBackupIds).reduce(function (accumulator, item) {
      accumulator[String(item || "")] = true;
      return accumulator;
    }, {});
    const database = await openIndexedDatabase();
    const existingTransaction = database.transaction(SAFETY_BACKUP_STORE_NAME, "readonly");
    const existingStore = existingTransaction.objectStore(SAFETY_BACKUP_STORE_NAME);
    const existingRows = await requestToPromise(existingStore.getAll());
    await waitForTransaction(existingTransaction);

    const staleRows = ensureArray(existingRows).filter(function (item) {
      return item && item.id && !validIds[item.id];
    });

    if (!staleRows.length) {
      return;
    }

    const deleteTransaction = database.transaction(SAFETY_BACKUP_STORE_NAME, "readwrite");
    const deleteStore = deleteTransaction.objectStore(SAFETY_BACKUP_STORE_NAME);
    staleRows.forEach(function (item) {
      deleteStore.delete(item.id);
    });
    await waitForTransaction(deleteTransaction);
  }

  async function readCollectionFromAdapter(collectionName) {
    if (runtime.adapterMode !== "indexeddb") {
      return clone(readDatabase()[collectionName] || []);
    }

    const database = await openIndexedDatabase();
    const transaction = database.transaction(collectionName, "readonly");
    const store = transaction.objectStore(collectionName);
    const result = await requestToPromise(store.getAll());
    await waitForTransaction(transaction);
    return ensureArray(result).map(clone);
  }

  async function replaceCollectionInAdapter(collectionName, records, options) {
    const progress = options && typeof options.onProgress === "function" ? options.onProgress : null;

    if (runtime.adapterMode !== "indexeddb") {
      const database = readDatabase();
      database[collectionName] = ensureArray(records);
      writeDatabase(database, { collection: collectionName, type: "replace" });
      if (progress) {
        progress({
          collectionName: collectionName,
          processed: ensureArray(records).length,
          total: ensureArray(records).length
        });
      }
      return;
    }

    const database = await openIndexedDatabase();
    let startIndex = 0;

    {
      const clearTransaction = database.transaction(collectionName, "readwrite");
      clearTransaction.objectStore(collectionName).clear();
      await waitForTransaction(clearTransaction);
    }

    while (startIndex < records.length) {
      const chunk = records.slice(startIndex, startIndex + IMPORT_BATCH_SIZE);
      const transaction = database.transaction(collectionName, "readwrite");
      const store = transaction.objectStore(collectionName);
      chunk.forEach(function (record) {
        store.put(clone(record));
      });
      await waitForTransaction(transaction);
      startIndex += IMPORT_BATCH_SIZE;
      if (progress) {
        progress({
          collectionName: collectionName,
          processed: Math.min(startIndex, records.length),
          total: records.length
        });
      }
      if (startIndex < records.length) {
        await yieldToBrowser();
      }
    }
  }

  async function putRecordInAdapter(collectionName, record) {
    if (runtime.adapterMode !== "indexeddb") {
      const database = readDatabase();
      const collection = ensureArray(database[collectionName]);
      const index = collection.findIndex(function (item) {
        return item.id === record.id;
      });
      if (index >= 0) {
        collection[index] = clone(record);
      } else {
        collection.push(clone(record));
      }
      database[collectionName] = collection;
      writeDatabase(database, { collection: collectionName, type: "upsert", recordId: record.id });
      return;
    }

    const database = await openIndexedDatabase();
    const transaction = database.transaction(collectionName, "readwrite");
    transaction.objectStore(collectionName).put(clone(record));
    await waitForTransaction(transaction);
  }

  async function deleteRecordFromAdapter(collectionName, recordId) {
    if (runtime.adapterMode !== "indexeddb") {
      const database = readDatabase();
      database[collectionName] = ensureArray(database[collectionName]).filter(function (item) {
        return item.id !== recordId;
      });
      writeDatabase(database, { collection: collectionName, type: "delete", recordId: recordId });
      return;
    }

    const database = await openIndexedDatabase();
    const transaction = database.transaction(collectionName, "readwrite");
    transaction.objectStore(collectionName).delete(recordId);
    await waitForTransaction(transaction);
  }

  async function clearOperationalAdapter() {
    if (runtime.adapterMode !== "indexeddb") {
      writeDatabase(createEmptyDatabase(), { collection: "all", type: "clear" });
      return;
    }

    const database = await openIndexedDatabase();
    let index;

    for (index = 0; index < OPERATIONAL_COLLECTION_NAMES.length; index += 1) {
      const collectionName = OPERATIONAL_COLLECTION_NAMES[index];
      const transaction = database.transaction(collectionName, "readwrite");
      transaction.objectStore(collectionName).clear();
      await waitForTransaction(transaction);
    }
  }

  async function rebuildSummaryFromAdapter() {
    const database = await getDatabaseAsync();
    const summary = buildSummaryFromDatabase(database);
    syncRuntimeSummary(summary);
    if (runtime.adapterMode === "indexeddb") {
      await putSystemRecord("summary", summary);
    }
    return clone(summary);
  }

  async function replaceDatabaseInAdapter(database, detail) {
    const normalized = normalizeDatabase(database);

    if (runtime.adapterMode !== "indexeddb") {
      writeDatabase(normalized, detail);
      syncRuntimeSettings(normalized.settings);
      syncRuntimeSummary(buildSummaryFromDatabase(normalized));
      return clone(normalized);
    }

    let index;
    for (index = 0; index < OPERATIONAL_COLLECTION_NAMES.length; index += 1) {
      const collectionName = OPERATIONAL_COLLECTION_NAMES[index];
      await replaceCollectionInAdapter(collectionName, normalized[collectionName], {
        onProgress: detail && typeof detail.onProgress === "function" ? function (progress) {
          detail.onProgress({
            collectionName: progress.collectionName,
            processed: progress.processed,
            total: progress.total,
            collectionIndex: index + 1,
            totalCollections: OPERATIONAL_COLLECTION_NAMES.length
          });
        } : null
      });
    }

    syncRuntimeSettings(normalized.settings);
    const summary = buildSummaryFromDatabase(normalized);
    syncRuntimeSummary(summary);

    await putSystemRecord("state", {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: summary.lastUpdated,
      storageMode: runtime.adapterMode
    });
    await putSystemRecord("summary", summary);

    OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
      if (runtime.loaded[collectionName]) {
        runtime.cache[collectionName] = clone(normalized[collectionName]);
      } else {
        runtime.cache[collectionName] = [];
      }
    });

    dispatchChange(detail || { collection: "all", type: "replace" });
    return clone(normalized);
  }

  async function ensureStorageInitialized() {
    if (runtime.initPromise) {
      return runtime.initPromise;
    }

    runtime.initPromise = (async function () {
      syncRuntimeSettings(runtime.settings);
      syncRuntimeSummary(runtime.summary);

      if (runtime.adapterMode !== "indexeddb") {
        const legacyDatabase = readDatabase();
        OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
          runtime.cache[collectionName] = clone(legacyDatabase[collectionName] || []);
          runtime.loaded[collectionName] = true;
        });
        syncRuntimeSettings(legacyDatabase.settings || runtime.settings);
        syncRuntimeSummary(buildSummaryFromDatabase(legacyDatabase));
        await tryLoadCloudBootstrap();
        global.localStorage.setItem(STORAGE_RUNTIME_KEY, JSON.stringify({
          storageMode: runtime.adapterMode,
          initializedAt: nowIso()
        }));
        return;
      }

      await openIndexedDatabase();

      const stateRecord = await getSystemRecord("state");
      if (!stateRecord) {
        const hasLegacyData = Boolean(global.localStorage.getItem(STORAGE_KEY));
        const seedDatabase = hasLegacyData ? readDatabase() : createEmptyDatabase();
        await replaceDatabaseInAdapter(seedDatabase, { collection: "all", type: hasLegacyData ? "migrate" : "initialize" });
        if (hasLegacyData) {
          global.localStorage.removeItem(STORAGE_KEY);
        }
      } else {
        const summaryRecord = await getSystemRecord("summary");
        if (summaryRecord) {
          syncRuntimeSummary(summaryRecord);
        } else {
          await rebuildSummaryFromAdapter();
        }
      }

      await tryLoadCloudBootstrap();
      global.localStorage.setItem(STORAGE_RUNTIME_KEY, JSON.stringify({
        storageMode: runtime.adapterMode,
        initializedAt: nowIso(),
        schemaVersion: SCHEMA_VERSION
      }));
    })();

    return runtime.initPromise;
  }

  async function ensureCollectionLoaded(collectionName) {
    if (collectionName === "settings") {
      return [clone(runtime.settings)];
    }

    await ensureStorageInitialized();

    if (runtime.loaded[collectionName]) {
      return clone(runtime.cache[collectionName] || []);
    }

    const records = await readCollectionFromAdapter(collectionName);
    runtime.cache[collectionName] = records.map(clone);
    runtime.loaded[collectionName] = true;
    runtime.summary.counts[collectionName] = runtime.cache[collectionName].length;
    syncRuntimeSummary(runtime.summary);
    return clone(runtime.cache[collectionName]);
  }

  async function ensureCollectionsLoaded(collectionNames) {
    const list = ensureArray(collectionNames).filter(Boolean);
    let index;

    for (index = 0; index < list.length; index += 1) {
      await ensureCollectionLoaded(list[index]);
    }

    return list.reduce(function (accumulator, collectionName) {
      accumulator[collectionName] = clone(runtime.cache[collectionName] || []);
      return accumulator;
    }, {});
  }

  function queueWrite(task) {
    runtime.writeQueue = runtime.writeQueue.then(function () {
      return task();
    }).catch(function (error) {
      // AUDIT-FIX MED-11: Write failures must be visible to users, not just silently logged.
      console.error("Storage write failed.", error);
      if (App.toast && typeof App.toast === "function") {
        App.toast(
          "Warning: A background save operation failed. Your data may not be saved. " +
          "Please reload the page and verify your data.",
          "error"
        );
      }
    });
    return runtime.writeQueue;
  }

  async function getDatabaseAsync() {
    await ensureStorageInitialized();
    await ensureCollectionsLoaded(OPERATIONAL_COLLECTION_NAMES);
    const database = createEmptyDatabase();
    database.meta.updatedAt = runtime.summary.lastUpdated || nowIso();
    database.settings = mergeSettings(runtime.settings);
    OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
      database[collectionName] = clone(runtime.cache[collectionName] || []);
    });
    return clone(database);
  }

  const storage = {
    getDatabase: function () {
      assertCollectionPermission("settings", "view");
      return clone(getCachedDatabaseSnapshot());
    },

    getDatabaseAsync: function () {
      assertCollectionPermission("settings", "view");
      return getDatabaseAsync();
    },

    saveDatabase: function (database, detail) {
      // AUDIT-FIX CRIT-02: saveDatabase (sync) cannot write IndexedDB — only localStorage is
      // reachable synchronously. In IDB mode this would silently drop all data.
      // Callers MUST use saveDatabaseAsync. This method is kept for backward compatibility
      // (legacy localStorage callers) but now logs a deprecation warning if used in IDB mode.
      if (runtime.adapterMode === "indexeddb") {
        console.warn(
          "[storage] saveDatabase (sync) called while in IndexedDB mode. " +
          "Data will NOT be persisted. Use saveDatabaseAsync instead."
        );
        // Return normalized data but do NOT write to any storage layer in IDB mode.
        return { success: false, reason: "unsupported_in_indexeddb", data: clone(normalizeDatabase(database)) };
      }
      // localStorage mode: write synchronously as before.
      const normalized = normalizeDatabase(database);
      writeDatabase(normalized, detail || { collection: "all", type: "replace" });
      syncRuntimeSettings(normalized.settings);
      syncRuntimeSummary(buildSummaryFromDatabase(normalized));
      return { success: true, data: clone(normalized) };
    },

    saveDatabaseAsync: function (database, detail) {
      return replaceDatabaseInAdapter(database, detail);
    },

    getCollection: function (collectionName) {
      if (collectionName === "settings") {
        return [this.getSettings()];
      }
      return getScopedRecordsForUser(collectionName, runtime.cache[collectionName] || []);
    },

    getCollectionAsync: function (collectionName) {
      return ensureCollectionLoaded(collectionName).then(function (records) {
        return getScopedRecordsForUser(collectionName, records);
      });
    },

    ensureCollection: function (collectionName) {
      return ensureCollectionLoaded(collectionName);
    },

    ensureCollections: function (collectionNames) {
      return ensureCollectionsLoaded(collectionNames);
    },

    setCollection: function (collectionName, records) {
      assertCollectionPermission(collectionName, "replace");
      const normalizedRecords = ensureArray(records).map(function (record) {
        return normalizeRecordForCollection(collectionName, record, getCachedDatabaseSnapshot());
      });
      const writableRecords = mergeScopedCollectionWrite(collectionName, normalizedRecords);
      runtime.cache[collectionName] = clone(writableRecords);
      runtime.loaded[collectionName] = true;
      updateSummaryForCollection(collectionName, writableRecords, {
        type: "replace"
      });
      queueWrite(function () {
        return replaceCollectionInAdapter(collectionName, writableRecords);
      });
      dispatchChange({ collection: collectionName, type: "replace" });
      return getScopedRecordsForUser(collectionName, writableRecords);
    },

    setCollectionAsync: function (collectionName, records, options) {
      assertCollectionPermission(collectionName, "replace");
      const normalizedRecords = ensureArray(records).map(function (record) {
        return normalizeRecordForCollection(collectionName, record, getCachedDatabaseSnapshot());
      });
      const writableRecords = mergeScopedCollectionWrite(collectionName, normalizedRecords);
      runtime.cache[collectionName] = clone(writableRecords);
      runtime.loaded[collectionName] = true;
      updateSummaryForCollection(collectionName, writableRecords, {
        type: "replace"
      });
      dispatchChange({ collection: collectionName, type: "replace" });
      return replaceCollectionInAdapter(collectionName, writableRecords, options).then(function () {
        return getScopedRecordsForUser(collectionName, writableRecords);
      });
    },

    findById: function (collectionName, recordId) {
      const records = this.getCollection(collectionName);
      return records.find(function (item) {
        return item.id === recordId;
      }) || null;
    },

    upsert: function (collectionName, record, prefix) {
      assertCollectionPermission(collectionName, "save", record);
      const collection = ensureArray(runtime.cache[collectionName]);
      const recordId = record.id || createId(prefix || collectionName);
      const existingIndex = collection.findIndex(function (item) {
        return item.id === recordId;
      });
      const existingRecord = existingIndex >= 0 ? collection[existingIndex] : null;
      if (existingRecord) {
        assertCollectionPermission(collectionName, "update", existingRecord);
      }
      const timestamp = nowIso();
      let nextRecord = Object.assign({}, existingRecord || {}, record, {
        id: recordId,
        createdAt: existingRecord ? existingRecord.createdAt : (record.createdAt || timestamp),
        updatedAt: timestamp
      });
      nextRecord = applyAuditStamp(nextRecord, existingRecord);

      nextRecord = normalizeRecordForCollection(collectionName, nextRecord, getCachedDatabaseSnapshot());
      assertCollectionPermission(collectionName, "save", nextRecord);

      if (existingIndex >= 0) {
        collection[existingIndex] = nextRecord;
      } else {
        collection.push(nextRecord);
      }

      runtime.cache[collectionName] = clone(collection);
      runtime.loaded[collectionName] = true;
      updateSummaryForCollection(collectionName, collection, {
        type: existingIndex >= 0 ? "update" : "create",
        recordId: recordId,
        record: nextRecord
      });
      queueWrite(function () {
        return putRecordInAdapter(collectionName, nextRecord);
      });
      queueCloudRecordSync(collectionName, nextRecord, existingIndex >= 0 ? "update" : "create");
      dispatchChange({ collection: collectionName, type: existingIndex >= 0 ? "update" : "create", recordId: recordId });
      return clone(canUserAccessRecord(collectionName, nextRecord, getCurrentAuthUser()) ? nextRecord : {});
    },

    remove: function (collectionName, recordId) {
      const collection = ensureArray(runtime.cache[collectionName]);
      const existingRecord = collection.find(function (item) {
        return item.id === recordId;
      }) || null;
      assertCollectionPermission(collectionName, "delete", existingRecord);
      runtime.cache[collectionName] = collection.filter(function (item) {
        return item.id !== recordId;
      });
      runtime.loaded[collectionName] = true;
      updateSummaryForCollection(collectionName, runtime.cache[collectionName], {
        type: "delete",
        recordId: recordId
      });
      queueWrite(function () {
        return deleteRecordFromAdapter(collectionName, recordId);
      });
      if (existingRecord) {
        queueCloudRecordSync(collectionName, existingRecord, "delete");
      }
      dispatchChange({ collection: collectionName, type: "delete", recordId: recordId });
      return clone(runtime.cache[collectionName]);
    },

    clearAll: function () {
      assertCollectionPermission("settings", "clear");
      const fresh = createEmptyDatabase();
      OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
        runtime.cache[collectionName] = [];
        runtime.loaded[collectionName] = true;
      });
      syncRuntimeSettings(fresh.settings);
      syncRuntimeSummary(buildSummaryFromDatabase(fresh));
      queueWrite(function () {
        return clearOperationalAdapter();
      });
      if (isCloudModeEnabled()) {
        OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
          queueCloudCollectionReplace(collectionName, []);
        });
      }
      dispatchChange({ collection: "all", type: "clear" });
      return clone(fresh);
    },

    clearAllAsync: function () {
      assertCollectionPermission("settings", "clear");
      const fresh = createEmptyDatabase();
      OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
        runtime.cache[collectionName] = [];
        runtime.loaded[collectionName] = true;
      });
      syncRuntimeSettings(fresh.settings);
      syncRuntimeSummary(buildSummaryFromDatabase(fresh));
      return clearOperationalAdapter().then(function () {
        if (isCloudModeEnabled()) {
          OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
            queueCloudCollectionReplace(collectionName, []);
          });
        }
        dispatchChange({ collection: "all", type: "clear" });
        return clone(fresh);
      });
    },

    exportData: function () {
      assertCollectionPermission("settings", "export");
      return JSON.stringify(this.getDatabase(), null, 2);
    },

    exportDataAsync: function () {
      assertCollectionPermission("settings", "export");
      return getDatabaseAsync().then(function (database) {
        return JSON.stringify(database, null, 2);
      });
    },

    exportBackupPackage: function (metadata) {
      assertCollectionPermission("settings", "export");
      return JSON.stringify(buildBackupEnvelope("full_system", this.getDatabase(), metadata), null, 2);
    },

    exportBackupPackageAsync: function (metadata) {
      assertCollectionPermission("settings", "export");
      return getDatabaseAsync().then(function (database) {
        return JSON.stringify(buildBackupEnvelope("full_system", database, metadata), null, 2);
      });
    },

    importData: function (payload) {
      // AUDIT-FIX CRIT-04: importData (sync) previously only normalized/returned — it did NOT
      // persist. In localStorage mode we now persist. In IndexedDB mode we cannot write
      // synchronously — callers must use importDataAsync.
      const unwrapped = unwrapBackupPayload(payload);
      const normalized = normalizeDatabase(unwrapped.data);

      const summary = {
        success: false,
        schemaVersion: normalized.meta && normalized.meta.schemaVersion,
        counts: {},
        warnings: [],
        data: clone(normalized)
      };

      OPERATIONAL_COLLECTION_NAMES.forEach(function (name) {
        summary.counts[name] = Array.isArray(normalized[name]) ? normalized[name].length : 0;
      });

      if (runtime.adapterMode === "indexeddb") {
        summary.warnings.push(
          "importData (sync) cannot persist to IndexedDB. Use importDataAsync to complete the import."
        );
        console.warn("[storage] importData (sync) called in IndexedDB mode — data not persisted. Use importDataAsync.");
        return summary;
      }

      // localStorage mode: persist immediately.
      writeDatabase(normalized, { collection: "all", type: "import" });
      syncRuntimeSettings(normalized.settings);
      syncRuntimeSummary(buildSummaryFromDatabase(normalized));
      OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
        runtime.cache[collectionName] = clone(normalized[collectionName] || []);
        runtime.loaded[collectionName] = true;
      });
      dispatchChange({ collection: "all", type: "import" });
      summary.success = true;
      return summary;
    },

    importDataAsync: function (payload, options) {
      assertCollectionPermission("settings", "import");
      const unwrapped = unwrapBackupPayload(payload);
      return replaceDatabaseInAdapter(unwrapped.data, Object.assign({ collection: "all", type: "import" }, options || {})).then(function (result) {
        if (isCloudModeEnabled()) {
          OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
            queueCloudCollectionReplace(collectionName, result[collectionName] || []);
          });
          queueCloudCollectionReplace("settings", [Object.assign({ id: "settings-primary" }, result.settings || runtime.settings)]);
        }
        return result;
      });
    },

    importBackupPackage: function (payload) {
      return this.importData(payload);
    },

    importBackupPackageAsync: function (payload, options) {
      return this.importDataAsync(payload, options);
    },

    getSettings: function () {
      return clone(runtime.settings);
    },

    updateSettings: function (partialSettings) {
      assertCollectionPermission("settings", "update");
      const nextSettings = mergeSettings(Object.assign({}, runtime.settings, partialSettings, {
        futureSync: Object.assign({}, runtime.settings.futureSync, partialSettings && partialSettings.futureSync)
      }));
      syncRuntimeSettings(nextSettings);
      runtime.summary.lastUpdated = nowIso();
      syncRuntimeSummary(runtime.summary);
      dispatchChange({ collection: "settings", type: "update" });
      queueCloudCollectionReplace("settings", [Object.assign({ id: "settings-primary" }, nextSettings)]);
      return clone(nextSettings);
    },

    getLastUpdated: function () {
      return runtime.summary.lastUpdated;
    },

    getCollectionCount: function (collectionName) {
      if (collectionName === "settings") {
        return 1;
      }
      return this.getCollection(collectionName).length;
    },

    getRecentActivity: function (limit) {
      const user = getCurrentAuthUser();
      const scopedSubstationId = getScopedSubstationIdForUser(user);
      const rows = ensureArray(runtime.summary.recentActivity).filter(function (item) {
        return !scopedSubstationId || String(item.substationId || "").trim() === scopedSubstationId;
      });
      return clone(rows.slice(0, Number(limit) > 0 ? Number(limit) : 8));
    },

    getStorageSummary: function () {
      return clone(runtime.summary);
    },

    getCollectionNames: function () {
      return COLLECTION_NAMES.slice();
    },

    getSchemaVersion: function () {
      return SCHEMA_VERSION;
    },

    getBackupFormatVersion: function () {
      return BACKUP_FORMAT_VERSION;
    },

    normalizeRecord: function (collectionName, record, databaseOverride) {
      const database = databaseOverride ? normalizeDatabase(databaseOverride) : getCachedDatabaseSnapshot();
      return clone(normalizeRecordForCollection(collectionName, record, database));
    },

    unwrapBackupPayload: function (payload) {
      return clone(unwrapBackupPayload(payload));
    },

    saveSafetyBackup: function (reason, metadata) {
      assertCollectionPermission("settings", "backup");
      const backups = readSafetyBackups();
      const entry = {
        id: createId("safety"),
        createdAt: nowIso(),
        reason: String(reason || "Manual safety backup").trim(),
        schemaVersion: SCHEMA_VERSION,
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        metadata: Object.assign({}, metadata || {}),
        data: readDatabase()
      };
      backups.unshift(entry);
      writeSafetyBackups(backups.slice(0, MAX_SAFETY_BACKUPS));
      return clone(entry);
    },

    saveSafetyBackupAsync: function (reason, metadata) {
      assertCollectionPermission("settings", "backup");
      return getDatabaseAsync().then(function (database) {
        const backups = readSafetyBackups();
        const entry = {
          id: createId("safety"),
          createdAt: nowIso(),
          reason: String(reason || "Manual safety backup").trim(),
          schemaVersion: SCHEMA_VERSION,
          backupFormatVersion: BACKUP_FORMAT_VERSION,
          metadata: Object.assign({}, metadata || {}),
          storedInAdapter: runtime.adapterMode === "indexeddb"
        };
        backups.unshift(entry);
        const limitedBackups = backups.slice(0, MAX_SAFETY_BACKUPS);
        writeSafetyBackups(limitedBackups);
        return putSafetyBackupPayload(entry.id, database).then(function () {
          return pruneSafetyBackupPayloads(limitedBackups.map(function (item) {
            return item.id;
          }));
        }).then(function () {
          return clone(entry);
        });
      });
    },

    listSafetyBackups: function () {
      assertCollectionPermission("settings", "view");
      return readSafetyBackups().map(function (entry) {
        return {
          id: entry.id,
          createdAt: entry.createdAt,
          reason: entry.reason,
          schemaVersion: entry.schemaVersion,
          backupFormatVersion: entry.backupFormatVersion,
          metadata: clone(entry.metadata || {})
        };
      });
    },

    rollbackSafetyBackup: function (backupId) {
      // AUDIT-FIX CRIT-01: This sync method can only write localStorage. If the adapter is
      // currently in IndexedDB mode, calling this would leave IndexedDB untouched — the app
      // would reload from the old IDB data and silently ignore the rollback.
      // We throw a clear error in IDB mode to prevent false-success scenarios.
      // Use rollbackSafetyBackupAsync for IndexedDB mode.
      assertCollectionPermission("settings", "rollback");

      if (runtime.adapterMode === "indexeddb") {
        throw new Error(
          "Sync safety backup rollback is not supported in IndexedDB mode. " +
          "Use rollbackSafetyBackupAsync instead."
        );
      }

      const backups = readSafetyBackups();
      const target = backups.find(function (entry) {
        return entry.id === backupId;
      });
      if (!target) {
        throw new Error("Selected safety backup was not found.");
      }
      if (!target.data) {
        throw new Error("Selected safety backup has no restorable data (may be stored in IndexedDB).");
      }

      const currentState = readDatabase();
      const rollbackSnapshot = {
        id: createId("safety"),
        createdAt: nowIso(),
        reason: "Pre-rollback automatic backup",
        schemaVersion: SCHEMA_VERSION,
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        metadata: { rollbackFrom: backupId },
        data: currentState
      };
      backups.unshift(rollbackSnapshot);
      writeSafetyBackups(backups.slice(0, MAX_SAFETY_BACKUPS));

      const normalized = normalizeDatabase(target.data);
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      // Reset in-memory caches so next render uses restored data.
      OPERATIONAL_COLLECTION_NAMES.forEach(function (collectionName) {
        runtime.cache[collectionName] = clone(normalized[collectionName] || []);
        runtime.loaded[collectionName] = true;
      });
      syncRuntimeSettings(normalized.settings);
      syncRuntimeSummary(buildSummaryFromDatabase(normalized));
      dispatchChange({ collection: "all", type: "rollback", backupId: backupId });
      return clone(normalized);
    },

    rollbackSafetyBackupAsync: function (backupId) {
      assertCollectionPermission("settings", "rollback");
      const backups = readSafetyBackups();
      const target = backups.find(function (entry) {
        return entry.id === backupId;
      });
      if (!target) {
        return Promise.reject(new Error("Selected safety backup was not found."));
      }

      return Promise.all([getDatabaseAsync(), target.data ? Promise.resolve(clone(target.data)) : getSafetyBackupPayload(backupId)]).then(function (results) {
        const currentState = results[0];
        const targetData = results[1];
        if (!targetData) {
          throw new Error("Selected safety backup data is not available.");
        }
        const rollbackSnapshot = {
          id: createId("safety"),
          createdAt: nowIso(),
          reason: "Pre-rollback automatic backup",
          schemaVersion: SCHEMA_VERSION,
          backupFormatVersion: BACKUP_FORMAT_VERSION,
          metadata: { rollbackFrom: backupId },
          storedInAdapter: runtime.adapterMode === "indexeddb"
        };
        backups.unshift(rollbackSnapshot);
        const limitedBackups = backups.slice(0, MAX_SAFETY_BACKUPS);
        writeSafetyBackups(limitedBackups);
        // AUDIT-FIX HIGH-09: prune IDB payloads BEFORE writing localStorage metadata.
        // If we write metadata first and the tab closes mid-prune, localStorage entries
        // reference non-existent IDB payloads. By pruning first, any partial state
        // leaves the metadata list as the source of truth for which backups exist.
        return pruneSafetyBackupPayloads(limitedBackups.map(function (item) {
          return item.id;
        })).then(function () {
          return putSafetyBackupPayload(rollbackSnapshot.id, currentState);
        }).then(function () {
          return replaceDatabaseInAdapter(targetData, { collection: "all", type: "rollback", backupId: backupId });
        });
      });
    },

    initialize: function () {
      return ensureStorageInitialized();
    },

    isCollectionLoaded: function (collectionName) {
      return collectionName === "settings" ? true : Boolean(runtime.loaded[collectionName]);
    },

    getAdapterInfo: function () {
      return {
        mode: runtime.adapterMode,
        indexedDbName: runtime.adapterMode === "indexeddb" ? INDEXED_DB_NAME : "",
        localSettingsKey: SETTINGS_STORAGE_KEY,
        localSummaryKey: SUMMARY_STORAGE_KEY,
        cloudEnabled: isCloudModeEnabled(),
        cloudProvider: isCloudModeEnabled() ? "supabase" : ""
      };
    },

    createId: createId,
    createFeederTemplate: createFeederTemplate,
    normalizeSubstationRecord: normalizeSubstationRecord
  };

  App.storage = storage;
  App.defaultSettings = mergeSettings(defaultSettings);
  App.constants = Object.assign({}, App.constants || {}, {
    dailyHours: Array.from({ length: 25 }, function (_, index) {
      return String(index).padStart(2, "0") + ":00";
    }),
    feederTypes: FEEDER_TYPES.slice()
  });
})(window);
