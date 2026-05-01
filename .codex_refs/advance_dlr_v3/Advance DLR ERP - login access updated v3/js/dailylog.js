(function (global) {
  const App = global.SubstationRegisterApp;

  function getModuleState() {
    return App.getModuleState("dailylog", {
      substationId: "",
      date: App.getTodayValue(),
      activeRecord: null,
      saveTimer: null,
      activeRowIndex: null,
      eventDraft: {
        id: "",
        type: "LS",
        scopeType: "single_feeder",
        baseFeederId: "",
        fromTime: "",
        toTime: "",
        remark: "",
        selectedFeederIds: []
      }
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function stringValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function isBlankCellValue(value) {
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
    const hasValue = !isBlankCellValue(value);
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

  function normalizeFeederReading(reading) {
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

  function ensureReadingMeta(reading) {
    const normalized = normalizeFeederReading(reading);

    if (!reading || typeof reading !== "object") {
      return normalized;
    }

    reading.amp = normalized.amp;
    reading.kv = normalized.kv;
    reading.kwh = normalized.kwh;
    reading.meta = normalized.meta;
    return reading;
  }

  function getFieldMeta(reading, fieldName) {
    return ensureReadingMeta(reading).meta[fieldName] || normalizeReadingEntryMeta("", null, "");
  }

  function setFieldMeta(reading, fieldName, entryMode, source) {
    const target = ensureReadingMeta(reading);
    target.meta[fieldName] = normalizeReadingEntryMeta(target[fieldName], {
      entryMode: entryMode,
      source: source
    }, source);

    if (fieldName === "kwh" && target.meta.kwh.entryMode === "ls_blocked") {
      target.kwh = "";
    }

    return target.meta[fieldName];
  }

  function getKwhMeta(reading) {
    return getFieldMeta(reading, "kwh");
  }

  function isActualKwhReading(reading) {
    return !isBlankCellValue(reading && reading.kwh) && getKwhMeta(reading).entryMode === "actual";
  }

  function isEstimatedKwhReading(reading) {
    return !isBlankCellValue(reading && reading.kwh) && getKwhMeta(reading).entryMode === "estimated";
  }

  const EVENT_TYPES = ["LS", "SD", "BD", "EF", "SF"];
  const EVENT_FAULT_SOURCES = {
    MANUAL: "MANUAL",
    AUTO_GAP: "AUTO_GAP",
    AUTO_EVENT: "AUTO_EVENT",
    PROPAGATED: "PROPAGATED_EVENT"
  };

  function buildTimelineKey(dateValue, hourValue) {
    return String(dateValue || "") + "|" + String(hourValue || "");
  }

  function buildMeterChangeEventId(substationId, feederId, dateValue, hourValue) {
    return [
      "meterchange",
      String(substationId || "").trim(),
      String(feederId || "").trim(),
      String(dateValue || "").trim(),
      String(hourValue || "").trim()
    ].join("|");
  }

  function getHourIndex(hourValue) {
    const hourText = String(hourValue || "").trim();
    const exactIndex = App.constants.dailyHours.indexOf(hourText);

    if (exactIndex >= 0) {
      return exactIndex;
    }

    const matched = hourText.match(/^(\d{1,2}):(\d{2})$/);
    if (!matched) {
      return Number.MAX_SAFE_INTEGER;
    }

    return (Number(matched[1]) * 60) + Number(matched[2]);
  }

  function compareDateHourValues(leftDate, leftHour, rightDate, rightHour) {
    if (leftDate !== rightDate) {
      return String(leftDate || "").localeCompare(String(rightDate || ""));
    }

    return getHourIndex(leftHour) - getHourIndex(rightHour);
  }

  function loadRecordMeterChangeEvents(substationId, dateValue) {
    if (!substationId || !dateValue) {
      return [];
    }

    return App.storage.getCollection("meterChangeEvents").filter(function (event) {
      return event.substationId === substationId && event.effectiveDate === dateValue;
    }).sort(function (left, right) {
      return compareDateHourValues(left.effectiveDate, left.effectiveTime, right.effectiveDate, right.effectiveTime);
    });
  }

  function normalizeMeterChangeEvent(event, defaults) {
    const source = event || {};
    const fallback = defaults || {};
    return {
      id: source.id || buildMeterChangeEventId(source.substationId || fallback.substationId, source.feederId || fallback.feederId, source.effectiveDate || fallback.effectiveDate, source.effectiveTime || fallback.effectiveTime),
      substationId: String(source.substationId || fallback.substationId || "").trim(),
      feederId: String(source.feederId || fallback.feederId || "").trim(),
      feederName: String(source.feederName || fallback.feederName || "").trim(),
      effectiveDate: String(source.effectiveDate || fallback.effectiveDate || "").trim(),
      effectiveTime: String(source.effectiveTime || fallback.effectiveTime || "").trim(),
      oldMeterLastReading: isBlankReadingValue(source.oldMeterLastReading) ? "" : String(source.oldMeterLastReading).trim(),
      newMeterStartReading: isBlankReadingValue(source.newMeterStartReading) ? "" : String(source.newMeterStartReading).trim(),
      remark: String(source.remark || "").trim()
    };
  }

  function isSameMeterChangePoint(event, feederId, dateValue, hourValue) {
    return Boolean(event && event.feederId === feederId && event.effectiveDate === dateValue && event.effectiveTime === hourValue);
  }

  function findRecordMeterChangeEvent(record, feederId, dateValue, hourValue) {
    return asArray(record && record.meterChangeEvents).find(function (event) {
      return isSameMeterChangePoint(event, feederId, dateValue, hourValue);
    }) || null;
  }

  function upsertRecordMeterChangeEvent(record, event) {
    const nextEvent = normalizeMeterChangeEvent(event);
    const events = asArray(record && record.meterChangeEvents).slice();
    const index = events.findIndex(function (item) {
      return item.id === nextEvent.id || isSameMeterChangePoint(item, nextEvent.feederId, nextEvent.effectiveDate, nextEvent.effectiveTime);
    });

    if (index >= 0) {
      events[index] = nextEvent;
    } else {
      events.push(nextEvent);
    }

    record.meterChangeEvents = events.sort(function (left, right) {
      return compareDateHourValues(left.effectiveDate, left.effectiveTime, right.effectiveDate, right.effectiveTime);
    });
  }

  function removeRecordMeterChangeEvent(record, feederId, dateValue, hourValue) {
    const events = asArray(record && record.meterChangeEvents);
    record.meterChangeEvents = events.filter(function (event) {
      return !isSameMeterChangePoint(event, feederId, dateValue, hourValue);
    });
  }

  function cloneFeeders(feeders) {
    return App.sortFeeders(feeders || []).map(function (feeder) {
      return Object.assign({}, feeder, {
        feederName: App.getFeederLabel(feeder),
        name: App.getFeederLabel(feeder)
      });
    });
  }

  function getBatterySetCount(source) {
    const count = App.toNumber(source && source.batterySetCount, 1);
    return Math.max(1, Math.min(3, count));
  }

  function getTransformerCount(source) {
    const count = App.toNumber(source && source.transformerCount, 1);
    return Math.max(1, Math.min(3, count));
  }

  function buildBlankRows(feederSnapshot, substation) {
    const batterySetCount = getBatterySetCount(substation);
    const transformerCount = getTransformerCount(substation);
    return App.constants.dailyHours.map(function (hour) {
      const feederReadings = {};
      feederSnapshot.forEach(function (feeder) {
        feederReadings[feeder.id] = normalizeFeederReading(null);
      });
      return {
        hour: hour,
        feederReadings: feederReadings,
        busVoltage: "",
        batteryVoltage: "",
        incomer: "",
        transformer: "",
        batteryVoltages: Array.from({ length: batterySetCount }, function () { return ""; }),
        tapPositions: Array.from({ length: transformerCount }, function () { return ""; }),
        remark: ""
      };
    });
  }

  function normalizeRows(rows, feederSnapshot, substation) {
    const batterySetCount = getBatterySetCount(substation);
    const transformerCount = getTransformerCount(substation);

    return App.constants.dailyHours.map(function (hour, index) {
      const row = Array.isArray(rows) && rows[index] ? clone(rows[index]) : {};
      const feederReadings = row.feederReadings || {};

      feederSnapshot.forEach(function (feeder) {
        feederReadings[feeder.id] = normalizeFeederReading(feederReadings[feeder.id]);
      });

      return {
        hour: row.hour || hour,
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

  function normalizeDailyLogEvent(event) {
    const source = event || {};
    return {
      id: String(source.id || ["dlrevent", Date.now(), Math.random().toString(36).slice(2, 7)].join("-")).trim(),
      type: String(source.type || source.eventType || "").trim().toUpperCase(),
      source: String(source.source || "MANUAL_EVENT").trim().toUpperCase(),
      scopeType: String(source.scopeType || "single_feeder").trim(),
      baseFeederId: String(source.baseFeederId || "").trim(),
      baseFeederName: String(source.baseFeederName || "").trim(),
      affectedFeederIds: asArray(source.affectedFeederIds).map(function (item) {
        return String(item || "").trim();
      }).filter(Boolean),
      affectedFeederNames: asArray(source.affectedFeederNames).map(function (item) {
        return String(item || "").trim();
      }).filter(Boolean),
      fromTime: String(source.fromTime || "").trim(),
      toTime: String(source.toTime || "").trim(),
      remark: String(source.remark || "").trim(),
      createdAt: String(source.createdAt || ""),
      updatedAt: String(source.updatedAt || "")
    };
  }

  function normalizeRecordEvents(events) {
    return asArray(events).map(normalizeDailyLogEvent).filter(function (event) {
      return EVENT_TYPES.indexOf(event.type) >= 0 && event.fromTime && event.toTime;
    });
  }

  function isBlankReadingValue(value) {
    return isBlankCellValue(value);
  }

  function getPreviousDateValue(dateValue) {
    const parts = String(dateValue || "").split("-");
    if (parts.length !== 3) {
      return "";
    }

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || Number.isNaN(date.getTime())) {
      return "";
    }

    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  function findMatchingFeederInSnapshot(snapshot, feeder) {
    const previousFeeders = cloneFeeders(snapshot || []);
    const byId = previousFeeders.find(function (item) {
      return item.id === feeder.id;
    });

    if (byId) {
      return byId;
    }

    const feederName = App.getFeederLabel(feeder).toLowerCase();
    return previousFeeders.find(function (item) {
      return App.getFeederLabel(item).toLowerCase() === feederName;
    }) || null;
  }

  function getLastClosingKwhValue(record, feederId) {
    if (!record || !Array.isArray(record.rows) || !feederId) {
      return "";
    }

    for (let index = record.rows.length - 1; index >= 0; index -= 1) {
      const row = record.rows[index];
      const reading = row && row.feederReadings ? row.feederReadings[feederId] : null;
      if (reading && !isBlankReadingValue(reading.kwh)) {
        return String(reading.kwh).trim();
      }
    }

    return "";
  }

  function applyOpeningCarryForward(record) {
    if (!record || !record.substationId || !record.date || !Array.isArray(record.rows) || !record.rows[0]) {
      return record;
    }

    const previousDate = getPreviousDateValue(record.date);
    if (!previousDate) {
      return record;
    }

    const previousRecord = App.storage.getCollection("dailyLogs").find(function (item) {
      return item.substationId === record.substationId && item.date === previousDate;
    });

    if (!previousRecord) {
      return record;
    }

    const openingRow = record.rows[0];

    record.feederSnapshot.forEach(function (feeder) {
      if (App.isTotalFeeder(feeder)) {
        return;
      }

      const currentReading = getReading(openingRow, feeder.id);
      if (!isBlankReadingValue(currentReading.kwh)) {
        return;
      }

      const previousFeeder = findMatchingFeederInSnapshot(previousRecord.feederSnapshot, feeder);
      if (!previousFeeder) {
        return;
      }

      const carryForwardValue = getLastClosingKwhValue(previousRecord, previousFeeder.id);
      if (!isBlankReadingValue(carryForwardValue)) {
        currentReading.kwh = carryForwardValue;
        setFieldMeta(currentReading, "kwh", "actual", "carry_forward");
      }
    });

    return record;
  }

  function createBlankRecord(substation, date) {
    const feederSnapshot = cloneFeeders(substation ? substation.feeders : []);
    return applyOpeningCarryForward({
      id: "",
      substationId: substation ? substation.id : "",
      date: date,
      feederSnapshot: feederSnapshot,
      substationSnapshot: substation ? {
        name: substation.name,
        division: substation.division,
        circle: substation.circle,
        location: substation.location,
        voltageLevel: substation.voltageLevel,
        batterySetCount: getBatterySetCount(substation),
        transformerCount: getTransformerCount(substation)
      } : null,
      rows: buildBlankRows(feederSnapshot, substation),
      meterChangeEvents: loadRecordMeterChangeEvents(substation ? substation.id : "", date),
      events: []
    });
  }

  function normalizeRecord(record, substation, date) {
    if (!record) {
      return createBlankRecord(substation, date);
    }

    const feederSnapshot = cloneFeeders(record.feederSnapshot && record.feederSnapshot.length ? record.feederSnapshot : (substation ? substation.feeders : []));
    return applyOpeningCarryForward({
      id: record.id || "",
      substationId: record.substationId || (substation ? substation.id : ""),
      date: record.date || date,
      feederSnapshot: feederSnapshot,
      substationSnapshot: Object.assign({}, record.substationSnapshot || {}, substation ? {
        name: substation.name,
        division: substation.division,
        circle: substation.circle,
        location: substation.location,
        voltageLevel: substation.voltageLevel,
        batterySetCount: getBatterySetCount(substation),
        transformerCount: getTransformerCount(substation)
      } : {}),
      rows: normalizeRows(record.rows, feederSnapshot, substation || record.substationSnapshot || {}),
      meterChangeEvents: loadRecordMeterChangeEvents(record.substationId || (substation ? substation.id : ""), record.date || date),
      events: normalizeRecordEvents(record.events),
      createdAt: record.createdAt || "",
      updatedAt: record.updatedAt || ""
    });
  }

  function getEventEligibleFeeders(record) {
    return getDisplayFeeders(record && record.feederSnapshot).filter(function (feeder) {
      return !App.isTotalFeeder(feeder) && feeder.isVisible !== false;
    });
  }

  function getDefaultEventBaseFeederId(record) {
    const feeders = getEventEligibleFeeders(record);
    return feeders.length ? feeders[0].id : "";
  }

  function getSuggestedScopeForEventType(eventType) {
    return String(eventType || "").trim().toUpperCase() === "SF" ? "selected_feeders" : "single_feeder";
  }

  function createEventDraft(record, overrides) {
    const source = overrides || {};
    return {
      id: String(source.id || "").trim(),
      type: String(source.type || "LS").trim().toUpperCase() || "LS",
      scopeType: String(source.scopeType || getSuggestedScopeForEventType(source.type || "LS")).trim(),
      baseFeederId: String(source.baseFeederId || getDefaultEventBaseFeederId(record)).trim(),
      fromTime: String(source.fromTime || "").trim(),
      toTime: String(source.toTime || "").trim(),
      remark: String(source.remark || "").trim(),
      selectedFeederIds: asArray(source.selectedFeederIds).filter(Boolean)
    };
  }

  function ensureEventDraftDefaults(state) {
    if (!state.eventDraft) {
      state.eventDraft = createEventDraft(state.activeRecord);
    }

    if (state.eventDraft.id && !getRecordEventById(state.activeRecord, state.eventDraft.id)) {
      state.eventDraft = createEventDraft(state.activeRecord, {
        type: state.eventDraft.type,
        scopeType: getSuggestedScopeForEventType(state.eventDraft.type)
      });
    }

    const defaultBaseFeederId = getDefaultEventBaseFeederId(state.activeRecord);
    const validFeederIds = getEventEligibleFeeders(state.activeRecord).map(function (feeder) {
      return feeder.id;
    });
    if (!state.eventDraft.baseFeederId || !state.activeRecord.feederSnapshot.some(function (feeder) { return feeder.id === state.eventDraft.baseFeederId; })) {
      state.eventDraft.baseFeederId = defaultBaseFeederId;
    }

    if (!Array.isArray(state.eventDraft.selectedFeederIds)) {
      state.eventDraft.selectedFeederIds = [];
    }

    if (EVENT_TYPES.indexOf(String(state.eventDraft.type || "").trim().toUpperCase()) === -1) {
      state.eventDraft.type = "LS";
    }

    if (!state.eventDraft.scopeType) {
      state.eventDraft.scopeType = getSuggestedScopeForEventType(state.eventDraft.type);
    }

    state.eventDraft.selectedFeederIds = state.eventDraft.selectedFeederIds.filter(function (feederId) {
      return validFeederIds.indexOf(feederId) >= 0;
    });
  }

  function ensureStateRecord() {
    const state = getModuleState();
    const substations = App.getSubstations();

    if (!substations.length) {
      state.substationId = "";
      state.activeRecord = null;
      return state;
    }

    if (!state.substationId || !App.findSubstation(state.substationId)) {
      state.substationId = substations[0].id;
    }

    if (!state.date) {
      state.date = App.getTodayValue();
    }

    const substation = App.findSubstation(state.substationId);
    const existing = App.storage.getCollection("dailyLogs").find(function (item) {
      return item.substationId === state.substationId && item.date === state.date;
    });
    state.activeRecord = normalizeRecord(existing, substation, state.date);
    ensureEventDraftDefaults(state);
    return state;
  }

  function buildChildMap(feeders) {
    return (feeders || []).reduce(function (accumulator, feeder) {
      if (feeder.parentFeederId) {
        accumulator[feeder.parentFeederId] = accumulator[feeder.parentFeederId] || [];
        accumulator[feeder.parentFeederId].push(feeder);
      }
      return accumulator;
    }, {});
  }

  function getTotalFeeder(feeders) {
    return App.sortFeeders(feeders || []).find(App.isTotalFeeder) || null;
  }

  function getDisplayFeeders(feeders) {
    const sorted = App.sortFeeders(feeders || []).filter(function (feeder) {
      return !App.isTotalFeeder(feeder);
    });
    const feederMap = App.getFeederMap(sorted);
    const childMap = buildChildMap(sorted);
    const visible = [];
    const usedIds = {};

    sorted.filter(App.isMainIncFeeder).forEach(function (feeder) {
      if (feeder.isVisible !== false) {
        visible.push(Object.assign({}, feeder, { depth: 0 }));
        usedIds[feeder.id] = true;
      }

      (childMap[feeder.id] || []).filter(function (child) {
        return child.isVisible !== false;
      }).forEach(function (child) {
        visible.push(Object.assign({}, child, { depth: 1 }));
        usedIds[child.id] = true;
      });
    });

    sorted.forEach(function (feeder) {
      if (usedIds[feeder.id] || feeder.isVisible === false || App.is33KvFeeder(feeder)) {
        return;
      }
      if (feeder.parentFeederId && feederMap[feeder.parentFeederId]) {
        return;
      }
      visible.push(Object.assign({}, feeder, { depth: 0 }));
      usedIds[feeder.id] = true;
    });

    sorted.filter(function (feeder) {
      return !usedIds[feeder.id] && feeder.isVisible !== false && App.is33KvIncomingFeeder(feeder) && !App.is33KvExpressFeeder(feeder);
    }).forEach(function (feeder) {
      visible.push(Object.assign({}, feeder, { depth: 0 }));
      usedIds[feeder.id] = true;
    });

    sorted.filter(function (feeder) {
      return !usedIds[feeder.id] && feeder.isVisible !== false && App.is33KvExpressFeeder(feeder);
    }).forEach(function (feeder) {
      visible.push(Object.assign({}, feeder, { depth: 0 }));
      usedIds[feeder.id] = true;
    });

    return visible;
  }

  function getReading(row, feederId) {
    if (!row.feederReadings[feederId]) {
      row.feederReadings[feederId] = normalizeFeederReading(null);
    }
    row.feederReadings[feederId] = ensureReadingMeta(row.feederReadings[feederId]);
    return row.feederReadings[feederId];
  }

  function isAutoAmpFeeder(feeder, childMap) {
    return App.isMainIncFeeder(feeder) && (childMap[feeder.id] || []).length > 0;
  }

  function getFeederSubcolumns(feeder) {
    return App.is33KvFeeder(feeder) ? ["amp", "kv", "kwh"] : ["amp", "kwh"];
  }

  function getEffectiveAmpState(row, feeder, feederMap, childMap, memo, trail) {
    if (memo[feeder.id]) {
      return memo[feeder.id];
    }

    const path = trail || {};
    if (path[feeder.id]) {
      return { text: "", number: 0, hasValue: false };
    }
    path[feeder.id] = true;

    if (App.isTotalFeeder(feeder)) {
      const mainFeeders = App.sortFeeders(Object.values(feederMap)).filter(App.isMainIncFeeder);
      let sum = 0;
      let hasValue = false;
      mainFeeders.forEach(function (mainFeeder) {
        const state = getEffectiveAmpState(row, mainFeeder, feederMap, childMap, memo, Object.assign({}, path));
        if (state.hasValue) {
          sum += state.number;
          hasValue = true;
        }
      });
      memo[feeder.id] = hasValue ? { text: sum.toFixed(2), number: Number(sum.toFixed(2)), hasValue: true } : { text: "", number: 0, hasValue: false };
      return memo[feeder.id];
    }

    if (isAutoAmpFeeder(feeder, childMap)) {
      let sum = 0;
      let hasValue = false;
      childMap[feeder.id].forEach(function (child) {
        const state = getEffectiveAmpState(row, child, feederMap, childMap, memo, Object.assign({}, path));
        if (state.hasValue) {
          sum += state.number;
          hasValue = true;
        }
      });
      memo[feeder.id] = hasValue ? { text: sum.toFixed(2), number: Number(sum.toFixed(2)), hasValue: true } : { text: "", number: 0, hasValue: false };
      return memo[feeder.id];
    }

    const rawAmp = getReading(row, feeder.id).amp;
    if (rawAmp === "" || rawAmp === null || rawAmp === undefined || rawAmp === " ") {
      memo[feeder.id] = { text: "", number: 0, hasValue: false };
      return memo[feeder.id];
    }

    const parsed = Number(rawAmp);
    memo[feeder.id] = Number.isFinite(parsed) ? { text: String(rawAmp), number: parsed, hasValue: true } : { text: "", number: 0, hasValue: false };
    return memo[feeder.id];
  }

  function synchronizeCalculatedAmps(record) {
    const totalFeeder = getTotalFeeder(record.feederSnapshot);
    const feeders = cloneFeeders(record.feederSnapshot);
    const feederMap = App.getFeederMap(feederSnapshotWithTotal(feeders, totalFeeder));
    const childMap = buildChildMap(feeders);

    record.rows.forEach(function (row) {
      const memo = {};
      if (totalFeeder) {
        const totalState = getEffectiveAmpState(row, totalFeeder, feederMap, childMap, memo, {});
        getReading(row, totalFeeder.id).amp = totalState.text;
      }

      feeders.forEach(function (feeder) {
        if (isAutoAmpFeeder(feeder, childMap)) {
          const state = getEffectiveAmpState(row, feeder, feederMap, childMap, memo, {});
          getReading(row, feeder.id).amp = state.text;
        }
      });
    });
  }

  function feederSnapshotWithTotal(feeders, totalFeeder) {
    const result = feeders.slice();
    if (totalFeeder) {
      result.push(totalFeeder);
    }
    return result;
  }

  function getCurrentAndStoredDailyLogs(activeRecord) {
    const substationId = activeRecord && activeRecord.substationId;
    if (!substationId) {
      return [];
    }

    const currentRecordId = activeRecord.id || "";
    return App.storage.getCollection("dailyLogs").filter(function (item) {
      if (item.substationId !== substationId) {
        return false;
      }

      if (item.date === activeRecord.date) {
        return false;
      }

      return item.id !== currentRecordId;
    }).concat([activeRecord]);
  }

  function isSameFeederAcrossSnapshots(feeder, candidate) {
    if (!feeder || !candidate) {
      return false;
    }

    if (feeder.id && candidate.id && feeder.id === candidate.id) {
      return true;
    }

    return App.getFeederLabel(feeder).toLowerCase() === App.getFeederLabel(candidate).toLowerCase();
  }

  function getCombinedMeterChangeEvents(activeRecord, feeder) {
    const substationId = activeRecord && activeRecord.substationId;
    const currentDate = activeRecord && activeRecord.date;
    const currentEvents = asArray(activeRecord && activeRecord.meterChangeEvents).filter(function (event) {
      return event.feederId === feeder.id || (event.feederName && event.feederName.toLowerCase() === App.getFeederLabel(feeder).toLowerCase());
    });

    const storedEvents = App.storage.getCollection("meterChangeEvents").filter(function (event) {
      if (event.substationId !== substationId) {
        return false;
      }

      if (event.effectiveDate === currentDate) {
        return false;
      }

      return event.feederId === feeder.id || (event.feederName && event.feederName.toLowerCase() === App.getFeederLabel(feeder).toLowerCase());
    });

    return storedEvents.concat(currentEvents).sort(function (left, right) {
      return compareDateHourValues(left.effectiveDate, left.effectiveTime, right.effectiveDate, right.effectiveTime);
    });
  }

  function buildFeederKwhTimeline(activeRecord, feeder) {
    const points = [];
    const eventMap = {};

    getCurrentAndStoredDailyLogs(activeRecord).forEach(function (record) {
      const recordEventContext = buildRecordEventContext(record);
      const recordFeeder = findMatchingFeederInSnapshot(record.feederSnapshot || [], feeder);
      if (!recordFeeder) {
        return;
      }

      asArray(record.rows).forEach(function (row, rowIndex) {
        const reading = row && row.feederReadings ? row.feederReadings[recordFeeder.id] : null;
        if (hasExplicitEventForCell(record, recordFeeder.id, rowIndex, recordEventContext)) {
          return;
        }
        if (!reading || isBlankReadingValue(reading.kwh)) {
          return;
        }

        const numericValue = Number(reading.kwh);
        if (!Number.isFinite(numericValue)) {
          return;
        }

        points.push({
          recordId: record.id || "",
          date: record.date,
          hour: row.hour,
          value: numericValue,
          raw: String(reading.kwh).trim()
        });
      });
    });

    getCombinedMeterChangeEvents(activeRecord, feeder).forEach(function (event) {
      eventMap[buildTimelineKey(event.effectiveDate, event.effectiveTime)] = event;
    });

    points.sort(function (left, right) {
      return compareDateHourValues(left.date, left.hour, right.date, right.hour);
    });

    return {
      points: points,
      eventMap: eventMap
    };
  }

  function getPreviousReadingContext(activeRecord, feeder, rowIndex) {
    const targetRow = activeRecord && activeRecord.rows ? activeRecord.rows[rowIndex] : null;
    if (!targetRow) {
      return {
        previousReading: null,
        hasMeterChangeAtPoint: false
      };
    }

    const targetDate = activeRecord.date;
    const targetHour = targetRow.hour;
    const timeline = buildFeederKwhTimeline(activeRecord, feeder);
    let lastReading = null;

    for (let index = 0; index < timeline.points.length; index += 1) {
      const point = timeline.points[index];
      if (compareDateHourValues(point.date, point.hour, targetDate, targetHour) >= 0) {
        break;
      }

      const pointKey = buildTimelineKey(point.date, point.hour);
      if (timeline.eventMap[pointKey]) {
        lastReading = point.value;
        continue;
      }

      lastReading = point.value;
    }

    return {
      previousReading: lastReading,
      hasMeterChangeAtPoint: Boolean(timeline.eventMap[buildTimelineKey(targetDate, targetHour)])
    };
  }

  function validateFeederTimeline(activeRecord, feeder) {
    const timeline = buildFeederKwhTimeline(activeRecord, feeder);
    let lastReading = null;

    for (let index = 0; index < timeline.points.length; index += 1) {
      const point = timeline.points[index];
      const pointKey = buildTimelineKey(point.date, point.hour);

      if (timeline.eventMap[pointKey]) {
        lastReading = point.value;
        continue;
      }

      if (lastReading !== null && point.value < lastReading) {
        return {
          valid: false,
          point: point,
          previousReading: lastReading
        };
      }

      lastReading = point.value;
    }

    return {
      valid: true
    };
  }

  function validateRecordBeforeSave(activeRecord) {
    const feeders = getDisplayFeeders(activeRecord && activeRecord.feederSnapshot);

    for (let index = 0; index < feeders.length; index += 1) {
      const feeder = feeders[index];
      const validation = validateFeederTimeline(activeRecord, feeder);
      if (!validation.valid) {
        return Object.assign({ feeder: feeder }, validation);
      }
    }

    return { valid: true };
  }

  function syncMeterChangeEventsForRecord(record) {
    const currentEvents = asArray(record && record.meterChangeEvents).map(function (event) {
      return normalizeMeterChangeEvent(event, {
        substationId: record.substationId,
        effectiveDate: record.date
      });
    });

    const remainingEvents = App.storage.getCollection("meterChangeEvents").filter(function (event) {
      return !(event.substationId === record.substationId && event.effectiveDate === record.date);
    });

    App.storage.setCollection("meterChangeEvents", remainingEvents.concat(currentEvents));
  }

  function getOpeningClosingKwh(record, feederId) {
    const eventContext = buildRecordEventContext(record);
    const values = record.rows.map(function (row, rowIndex) {
      if (hasExplicitEventForCell(record, feederId, rowIndex, eventContext)) {
        return null;
      }
      const rawValue = getReading(row, feederId).kwh;
      return isBlankReadingValue(rawValue) ? null : Number(rawValue);
    }).filter(function (value) {
      return Number.isFinite(value);
    });

    if (!values.length) {
      return { opening: "", closing: "" };
    }

    return {
      opening: values[0],
      closing: values[values.length - 1]
    };
  }

  function getRecordMeterChangeMap(record, feeder) {
    return asArray(record && record.meterChangeEvents).reduce(function (accumulator, event) {
      if (event.feederId === feeder.id || (event.feederName && event.feederName.toLowerCase() === App.getFeederLabel(feeder).toLowerCase())) {
        accumulator[buildTimelineKey(event.effectiveDate, event.effectiveTime)] = event;
      }
      return accumulator;
    }, {});
  }

  function withRecordMeterChangeEvents(record) {
    if (!record) {
      return record;
    }

    if (Array.isArray(record.meterChangeEvents)) {
      return record;
    }

    return Object.assign({}, record, {
      meterChangeEvents: loadRecordMeterChangeEvents(record.substationId, record.date)
    });
  }

  function calculateFeederConsumptionMetrics(record, feeder) {
    const matchedFeeder = findMatchingFeederInSnapshot(record && record.feederSnapshot, feeder);
    if (!matchedFeeder) {
      return {
        opening: "",
        closing: "",
        difference: "",
        consumption: "",
        hasMeterChange: false
      };
    }

    const eventContext = buildRecordEventContext(record);
    const eventMap = getRecordMeterChangeMap(record, feeder);
    const points = asArray(record && record.rows).map(function (row, rowIndex) {
      if (hasExplicitEventForCell(record, matchedFeeder.id, rowIndex, eventContext)) {
        return null;
      }
      const reading = row && row.feederReadings ? row.feederReadings[matchedFeeder.id] : null;
      if (!reading || isBlankReadingValue(reading.kwh)) {
        return null;
      }

      const numericValue = Number(reading.kwh);
      if (!Number.isFinite(numericValue)) {
        return null;
      }

      return {
        hour: row.hour,
        value: numericValue
      };
    }).filter(Boolean).sort(function (left, right) {
      return compareDateHourValues(record.date, left.hour, record.date, right.hour);
    });

    if (!points.length) {
      return {
        opening: "",
        closing: "",
        difference: "",
        consumption: "",
        hasMeterChange: false
      };
    }

    let opening = points[0].value;
    let closing = points[points.length - 1].value;
    let lastReading = null;
    let totalDifference = 0;
    let hasMeterChange = false;

    points.forEach(function (point) {
      const pointKey = buildTimelineKey(record.date, point.hour);
      if (lastReading === null) {
        lastReading = point.value;
        return;
      }

      if (eventMap[pointKey]) {
        hasMeterChange = true;
        lastReading = point.value;
        return;
      }

      if (point.value >= lastReading) {
        totalDifference += point.value - lastReading;
      }

      lastReading = point.value;
    });

    const difference = hasMeterChange ? Number(totalDifference.toFixed(2)) : calculateDifference(opening, closing);
    const mfValue = Number(feeder.mf);
    const consumption = difference === "" || !Number.isFinite(mfValue) ? "" : Number((difference * mfValue).toFixed(2));

    return {
      opening: opening,
      closing: closing,
      difference: difference,
      consumption: consumption,
      hasMeterChange: hasMeterChange
    };
  }

  function calculateDifference(openingValue, closingValue) {
    if (openingValue === "" || closingValue === "") {
      return "";
    }

    const opening = Number(openingValue);
    const closing = Number(closingValue);

    if (!Number.isFinite(opening) || !Number.isFinite(closing)) {
      return "";
    }

    return Number((closing - opening).toFixed(2));
  }

  function formatNumericDisplay(value, maxFractionDigits) {
    if (value === "" || value === null || value === undefined) {
      return "";
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return String(value);
    }

    return parsed.toLocaleString("en-IN", {
      useGrouping: false,
      maximumFractionDigits: typeof maxFractionDigits === "number" ? maxFractionDigits : 2
    });
  }

  function getColumnCellClass(column) {
    if (column === "amp") {
      return "numeric-cell amp-cell";
    }
    if (column === "kv") {
      return "numeric-cell kv-cell";
    }
    if (column === "kwh") {
      return "numeric-cell kwh-cell";
    }
    if (column === "battery") {
      return "numeric-cell kv-cell battery-cell";
    }
    if (column === "tap") {
      return "numeric-cell tap-cell";
    }
    return "";
  }

  function getColumnInputClass(column, isCalculated) {
    const classes = ["numeric-input"];

    if (column === "amp") {
      classes.push("amp-field");
    } else if (column === "kv") {
      classes.push("kv-field");
    } else if (column === "kwh") {
      classes.push("kwh-field");
    } else if (column === "battery") {
      classes.push("kv-field", "battery-field");
    } else if (column === "tap") {
      classes.push("tap-field");
    }

    if (isCalculated) {
      classes.push("calculated-input");
    }

    return classes.join(" ");
  }

  function getBatteryLabels(record) {
    const count = getBatterySetCount(record && (record.substationSnapshot || record));
    return Array.from({ length: count }, function (_, index) {
      return "Battery " + (index + 1);
    });
  }

  function getTapLabels(record) {
    const count = getTransformerCount(record && (record.substationSnapshot || record));
    return Array.from({ length: count }, function (_, index) {
      return "T" + (index + 1);
    });
  }

  function getSuggestedEventFeederIds(record, draft) {
    const feeders = getEventEligibleFeeders(record);
    const baseFeederId = String(draft && draft.baseFeederId || "").trim();
    const scopeType = String(draft && draft.scopeType || "single_feeder").trim();
    const eventType = String(draft && draft.type || "LS").trim().toUpperCase();

    if (scopeType === "single_feeder") {
      return baseFeederId ? [baseFeederId] : [];
    }

    if (scopeType === "all_11kv_only") {
      return feeders.filter(function (feeder) {
        return !App.is33KvFeeder(feeder);
      }).map(function (feeder) {
        return feeder.id;
      });
    }

    if (scopeType === "full_substation") {
      return feeders.map(function (feeder) {
        return feeder.id;
      });
    }

    if (eventType === "SF") {
      return feeders.filter(function (feeder) {
        return !App.is33KvExpressFeeder(feeder);
      }).map(function (feeder) {
        return feeder.id;
      });
    }

    return baseFeederId ? [baseFeederId] : [];
  }

  function getEventAffectedFeederIds(record, event) {
    const explicitIds = asArray(event && event.affectedFeederIds).filter(Boolean);
    if (explicitIds.length) {
      return explicitIds.slice();
    }

    if (event && event.baseFeederId) {
      return [event.baseFeederId];
    }

    return [];
  }

  function getDailyEventRowRange(event) {
    const startIndex = getDailyHourRowIndex(event && event.fromTime, false);
    const endIndex = getDailyHourRowIndex(event && event.toTime, true);
    if (startIndex < 0 || endIndex < 0) {
      return null;
    }

    return {
      startIndex: Math.min(startIndex, endIndex),
      endIndex: Math.max(startIndex, endIndex)
    };
  }

  function getFaultSourceForEvent(event, feederId) {
    const affectedIds = getEventAffectedFeederIds(null, event);
    if (affectedIds.length > 1 && feederId && feederId !== event.baseFeederId) {
      return EVENT_FAULT_SOURCES.PROPAGATED;
    }

    if (event.scopeType !== "single_feeder" && event.baseFeederId && feederId && feederId !== event.baseFeederId) {
      return EVENT_FAULT_SOURCES.PROPAGATED;
    }

    return EVENT_FAULT_SOURCES.AUTO_EVENT;
  }

  function buildManagedFaultKey(substationId, dateValue, feederId, feederName, faultType, startTime, endTime, source) {
    return [
      String(substationId || "").trim(),
      String(dateValue || "").trim(),
      String(feederId || "").trim() || String(feederName || "").trim().toLowerCase(),
      String(faultType || "").trim().toUpperCase(),
      String(startTime || "").trim(),
      String(endTime || "").trim(),
      String(source || "").trim().toUpperCase()
    ].join("|");
  }

  function buildExplicitEventDescriptors(record) {
    const feederMap = App.getFeederMap(record && record.feederSnapshot);

    return normalizeRecordEvents(record && record.events).map(function (event) {
      const range = getDailyEventRowRange(event);
      if (!range) {
        return null;
      }

      const affectedFeederIds = getEventAffectedFeederIds(record, event).filter(function (feederId) {
        return Boolean(feederMap[feederId]);
      });

      if (!affectedFeederIds.length) {
        return null;
      }

      return Object.assign({}, event, {
        affectedFeederIds: affectedFeederIds,
        displayStartIndex: range.startIndex,
        displayEndIndex: range.endIndex
      });
    }).filter(Boolean);
  }

  function buildAutoGapEventDescriptors(record, explicitEvents) {
    if (!record || !Array.isArray(record.rows)) {
      return [];
    }

    const explicitCellMap = {};
    (explicitEvents || []).forEach(function (event) {
      event.affectedFeederIds.forEach(function (feederId) {
        for (let rowIndex = event.displayStartIndex; rowIndex <= event.displayEndIndex; rowIndex += 1) {
          explicitCellMap[feederId + "|" + rowIndex] = event;
        }
      });
    });

    return getEventEligibleFeeders(record).reduce(function (accumulator, feeder) {
      let lastActualIndex = -1;
      let missingStartIndex = -1;
      let barrierSinceLastActual = false;

      record.rows.forEach(function (row, rowIndex) {
        const reading = getReading(row, feeder.id);
        if (explicitCellMap[feeder.id + "|" + rowIndex]) {
          missingStartIndex = -1;
          barrierSinceLastActual = true;
          return;
        }

        if (isActualKwhReading(reading)) {
          if (missingStartIndex !== -1 && lastActualIndex !== -1 && !barrierSinceLastActual) {
            accumulator.push({
              id: buildManagedFaultKey(record.substationId, record.date, feeder.id, App.getFeederLabel(feeder), "LS", record.rows[lastActualIndex].hour, record.rows[rowIndex - 1].hour, EVENT_FAULT_SOURCES.AUTO_GAP),
              type: "LS",
              source: EVENT_FAULT_SOURCES.AUTO_GAP,
              scopeType: "single_feeder",
              baseFeederId: feeder.id,
              baseFeederName: App.getFeederLabel(feeder),
              affectedFeederIds: [feeder.id],
              fromTime: record.rows[lastActualIndex].hour,
              toTime: record.rows[rowIndex - 1].hour,
              displayStartIndex: missingStartIndex,
              displayEndIndex: rowIndex - 1,
              remark: "Auto-detected"
            });
          }

          lastActualIndex = rowIndex;
          missingStartIndex = -1;
          barrierSinceLastActual = false;
          return;
        }

        if (isEstimatedKwhReading(reading)) {
          missingStartIndex = -1;
          barrierSinceLastActual = true;
          return;
        }

        if (isBlankReadingValue(reading.kwh)) {
          if (lastActualIndex !== -1 && !barrierSinceLastActual && missingStartIndex === -1) {
            missingStartIndex = rowIndex;
          }
          return;
        }

        missingStartIndex = -1;
        if (lastActualIndex !== -1) {
          barrierSinceLastActual = true;
        }
      });

      if (missingStartIndex !== -1 && lastActualIndex !== -1 && !barrierSinceLastActual) {
        accumulator.push({
          id: buildManagedFaultKey(record.substationId, record.date, feeder.id, App.getFeederLabel(feeder), "LS", record.rows[lastActualIndex].hour, record.rows[record.rows.length - 1].hour, EVENT_FAULT_SOURCES.AUTO_GAP),
          type: "LS",
          source: EVENT_FAULT_SOURCES.AUTO_GAP,
          scopeType: "single_feeder",
          baseFeederId: feeder.id,
          baseFeederName: App.getFeederLabel(feeder),
          affectedFeederIds: [feeder.id],
          fromTime: record.rows[lastActualIndex].hour,
          toTime: record.rows[record.rows.length - 1].hour,
          displayStartIndex: missingStartIndex,
          displayEndIndex: record.rows.length - 1,
          remark: "Auto-detected"
        });
      }

      return accumulator;
    }, []);
  }

  function buildRecordEventContext(record) {
    const explicitEvents = buildExplicitEventDescriptors(record);
    const autoGapEvents = buildAutoGapEventDescriptors(record, explicitEvents);
    const cellMap = {};

    explicitEvents.concat(autoGapEvents).forEach(function (event) {
      event.affectedFeederIds.forEach(function (feederId) {
        for (let rowIndex = event.displayStartIndex; rowIndex <= event.displayEndIndex; rowIndex += 1) {
          const key = feederId + "|" + rowIndex;
          if (!cellMap[key] || cellMap[key].source !== EVENT_FAULT_SOURCES.AUTO_GAP) {
            cellMap[key] = event;
          }
        }
      });
    });

    return {
      explicitEvents: explicitEvents,
      autoGapEvents: autoGapEvents,
      cellMap: cellMap
    };
  }

  function getAppliedEventForCell(record, feederId, rowIndex, eventContext) {
    const context = eventContext || buildRecordEventContext(record);
    return context.cellMap[feederId + "|" + rowIndex] || null;
  }

  function hasExplicitEventForCell(record, feederId, rowIndex, eventContext) {
    const context = eventContext || buildRecordEventContext(record);
    const event = context.cellMap[feederId + "|" + rowIndex];
    return Boolean(event && context.explicitEvents.some(function (candidate) {
      return candidate.id === event.id;
    }));
  }

  function buildDerivedFaultFromEvent(record, event, feeder) {
    const startIndex = getHourIndex(event.fromTime);
    const endIndex = getHourIndex(event.toTime);
    const source = getFaultSourceForEvent(event, feeder.id);
    return {
      id: "",
      date: record.date,
      substationId: record.substationId,
      substationName: (record.substationSnapshot && record.substationSnapshot.name) || "",
      feederId: feeder.id,
      feederName: App.getFeederLabel(feeder),
      startTime: event.fromTime,
      endTime: event.toTime,
      durationMinutes: Number.isFinite(startIndex) && Number.isFinite(endIndex) && endIndex >= startIndex ? (endIndex - startIndex) * 60 : 0,
      faultType: event.type,
      source: source,
      autoKey: buildManagedFaultKey(record.substationId, record.date, feeder.id, App.getFeederLabel(feeder), event.type, event.fromTime, event.toTime, source),
      autoRule: "DAILY_EVENT",
      linkedEventId: event.id,
      remark: event.remark || ""
    };
  }

  function buildAutoGapFaultFromEvent(record, event, feeder) {
    const startIndex = getHourIndex(event.fromTime);
    const endIndex = getHourIndex(event.toTime);
    return {
      id: "",
      date: record.date,
      substationId: record.substationId,
      substationName: (record.substationSnapshot && record.substationSnapshot.name) || "",
      feederId: feeder.id,
      feederName: App.getFeederLabel(feeder),
      startTime: event.fromTime,
      endTime: event.toTime,
      durationMinutes: Number.isFinite(startIndex) && Number.isFinite(endIndex) && endIndex >= startIndex ? (endIndex - startIndex) * 60 : 0,
      faultType: "LS",
      source: EVENT_FAULT_SOURCES.AUTO_GAP,
      autoKey: buildManagedFaultKey(record.substationId, record.date, feeder.id, App.getFeederLabel(feeder), "LS", event.fromTime, event.toTime, EVENT_FAULT_SOURCES.AUTO_GAP),
      autoRule: "MISSING_KWH",
      linkedEventId: event.id,
      remark: event.remark || "Auto-detected"
    };
  }

  function getNumericPrecision(textValue) {
    const text = String(textValue || "").trim();
    if (!text || text.indexOf(".") === -1) {
      return 0;
    }

    return Math.min(2, text.split(".")[1].replace(/0+$/, "").length);
  }

  function roundToPrecision(value, precision) {
    const factor = Math.pow(10, precision);
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  function formatReadingValue(value, precision) {
    if (!Number.isFinite(Number(value))) {
      return "";
    }

    if (precision <= 0) {
      return String(Math.round(Number(value)));
    }

    return String(roundToPrecision(Number(value), precision))
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "");
  }

  function getKwhInputModeClass(reading) {
    const entryMode = getKwhMeta(reading).entryMode;

    if (entryMode === "estimated") {
      return "estimated-input";
    }

    if (entryMode === "ls_blocked") {
      return "ls-blocked-input";
    }

    return "";
  }

  function getKwhInputTitle(reading) {
    const meta = getKwhMeta(reading);

    if (meta.entryMode === "estimated") {
      return "Estimated from surrounding actual readings";
    }

    if (meta.entryMode === "ls_blocked") {
      return "Left blank for interruption / LS handling";
    }

    return "";
  }

  function getEventInputClass(column, eventType) {
    return [
      getColumnInputClass(column, true),
      "event-code-input",
      "event-code-" + String(eventType || "").trim().toLowerCase()
    ].join(" ");
  }

  function getEventInputTitle(event) {
    return [
      String(event && event.type || "").trim(),
      event && event.source ? "(" + String(event.source).replace(/_/g, " ") + ")" : "",
      event && event.remark ? "- " + event.remark : ""
    ].filter(Boolean).join(" ");
  }

  function buildEventInputHtml(rowIndex, feeder, column, event) {
    return '<input type="text" readonly class="' + App.escapeHtml(getEventInputClass(column, event.type)) + '" data-display-mode="event" data-row-index="' + rowIndex + '" data-field-type="feeder" data-feeder-id="' + App.escapeHtml(feeder.id) + '" data-field-name="' + App.escapeHtml(column) + '" data-event-type="' + App.escapeHtml(event.type) + '" title="' + App.escapeHtml(getEventInputTitle(event)) + '" value="' + App.escapeHtml(event.type) + '">';
  }

  function updateKwhInputPresentation(input, reading) {
    if (!input) {
      return;
    }

    const meta = getKwhMeta(reading);
    input.classList.toggle("estimated-input", meta.entryMode === "estimated");
    input.classList.toggle("ls-blocked-input", meta.entryMode === "ls_blocked");
    input.dataset.entryMode = meta.entryMode;
    input.title = getKwhInputTitle(reading);
  }

  function getPreviousActualKwhIndex(record, feederId, endRowIndex) {
    for (let index = endRowIndex - 1; index >= 0; index -= 1) {
      if (isActualKwhReading(getReading(record.rows[index], feederId))) {
        return index;
      }
    }

    return -1;
  }

  function getDailyHourRowIndex(hourValue, preferEnd) {
    const exactIndex = App.constants.dailyHours.indexOf(String(hourValue || "").trim());
    if (exactIndex >= 0) {
      return exactIndex;
    }

    const parsedIndex = getHourIndex(hourValue);
    if (!Number.isFinite(parsedIndex) || parsedIndex === Number.MAX_SAFE_INTEGER) {
      return -1;
    }

    const minutes = Number(parsedIndex);
    const rawHour = preferEnd ? Math.ceil(minutes / 60) : Math.floor(minutes / 60);
    return Math.max(0, Math.min(24, rawHour));
  }

  function faultMatchesFeeder(fault, feeder) {
    if (!fault || !feeder) {
      return false;
    }

    if (fault.feederId && feeder.id && fault.feederId === feeder.id) {
      return true;
    }

    return String(fault.feederName || "").trim().toLowerCase() === App.getFeederLabel(feeder).toLowerCase();
  }

  function hasLsOverlapForInterpolation(record, feeder, candidate) {
    if (!record || !feeder || !candidate) {
      return false;
    }

    const gapStartIndex = candidate.startIndex + 1;
    const gapEndIndex = candidate.endIndex - 1;

    if (gapStartIndex > gapEndIndex) {
      return false;
    }

    return App.storage.getCollection("faults").some(function (fault) {
      if (
        fault.substationId !== record.substationId ||
        fault.date !== record.date ||
        String(fault.faultType || "").toUpperCase() !== "LS" ||
        String(fault.source || "MANUAL").toUpperCase() !== "MANUAL"
      ) {
        return false;
      }

      if (!faultMatchesFeeder(fault, feeder)) {
        return false;
      }

      const faultStartIndex = getDailyHourRowIndex(fault.startTime, false);
      const faultEndIndex = getDailyHourRowIndex(fault.endTime, true);
      const effectiveStartIndex = faultStartIndex + 1;

      return effectiveStartIndex <= gapEndIndex && faultEndIndex >= gapStartIndex;
    });
  }

  function getInterpolationCandidate(record, feeder, rowIndex) {
    if (!record || !Array.isArray(record.rows) || !feeder || rowIndex <= 0 || !record.rows[rowIndex]) {
      return null;
    }

    const closingReading = getReading(record.rows[rowIndex], feeder.id);
    if (!isActualKwhReading(closingReading)) {
      return null;
    }

    const previousActualIndex = getPreviousActualKwhIndex(record, feeder.id, rowIndex);
    if (previousActualIndex === -1 || rowIndex - previousActualIndex <= 1) {
      return null;
    }

    const openingReading = getReading(record.rows[previousActualIndex], feeder.id);
    const openingValue = Number(openingReading.kwh);
    const closingValue = Number(closingReading.kwh);
    const eventContext = buildRecordEventContext(record);

    if (!Number.isFinite(openingValue) || !Number.isFinite(closingValue) || closingValue < openingValue) {
      return null;
    }

    for (let index = previousActualIndex + 1; index < rowIndex; index += 1) {
      const reading = getReading(record.rows[index], feeder.id);
      if (hasExplicitEventForCell(record, feeder.id, index, eventContext) || !isBlankReadingValue(reading.kwh) || getKwhMeta(reading).entryMode === "ls_blocked") {
        return null;
      }
    }

    const candidate = {
      startIndex: previousActualIndex,
      endIndex: rowIndex,
      startHour: record.rows[previousActualIndex].hour,
      endHour: record.rows[rowIndex].hour,
      openingReading: openingReading,
      closingReading: closingReading,
      openingValue: openingValue,
      closingValue: closingValue,
      gapHours: rowIndex - previousActualIndex
    };

    if (hasLsOverlapForInterpolation(record, feeder, candidate)) {
      return null;
    }

    return candidate;
  }

  function applyEstimatedInterpolation(record, feeder, candidate) {
    if (!candidate || candidate.gapHours <= 1) {
      return 0;
    }

    const difference = candidate.closingValue - candidate.openingValue;
    const precision = Math.max(
      getNumericPrecision(candidate.openingReading.kwh),
      getNumericPrecision(candidate.closingReading.kwh)
    );
    let estimatedCount = 0;

    for (let index = candidate.startIndex + 1; index < candidate.endIndex; index += 1) {
      const row = record.rows[index];
      const reading = getReading(row, feeder.id);

      if (!isBlankReadingValue(reading.kwh) || getKwhMeta(reading).entryMode === "ls_blocked") {
        continue;
      }

      const offset = index - candidate.startIndex;
      const interpolatedValue = candidate.openingValue + ((difference * offset) / candidate.gapHours);
      reading.kwh = formatReadingValue(interpolatedValue, precision);
      setFieldMeta(reading, "kwh", "estimated", "auto_interpolated");
      estimatedCount += 1;
    }

    return estimatedCount;
  }

  function maybeEstimateIntermediateKwh(container, feeder, rowIndex) {
    const state = getModuleState();
    const candidate = getInterpolationCandidate(state.activeRecord, feeder, rowIndex);

    if (!candidate) {
      return "none";
    }

    const response = String(global.prompt(
      "Missing KWH readings found for " + App.getFeederLabel(feeder) +
      " between " + candidate.startHour + " and " + candidate.endHour +
      ".\n\nType E to estimate the intermediate hourly readings.\nType L to mark this gap as LS.\nLeave blank or press Cancel to keep it for automatic LS handling.",
      "E"
    ) || "").trim().toUpperCase();

    if (response === "L") {
      const event = buildGapManualLsEvent(state.activeRecord, feeder, candidate);
      if (event) {
        App.toast("LS marked for " + App.getFeederLabel(feeder) + " from " + event.fromTime + " to " + event.toTime + ".", "warning");
        return "manual_ls";
      }
      return "none";
    }

    if (response !== "E") {
      App.toast("Gap kept for automatic LS handling.", "warning");
      return "keep_blank";
    }

    const estimatedCount = applyEstimatedInterpolation(state.activeRecord, feeder, candidate);
    if (estimatedCount > 0) {
      updateDerivedValuesInDom(container, state.activeRecord);
      App.toast("Estimated " + estimatedCount + " intermediate KWH reading" + (estimatedCount === 1 ? "" : "s") + " for " + App.getFeederLabel(feeder) + ".", "success");
      return "estimated";
    }

    return "none";
  }

  function renderEventTypeOptions(selectedValue) {
    return EVENT_TYPES.map(function (eventType) {
      return '<option value="' + App.escapeHtml(eventType) + '"' + (eventType === selectedValue ? " selected" : "") + ">" + App.escapeHtml(eventType) + "</option>";
    }).join("");
  }

  function renderEventScopeOptions(selectedValue) {
    return [
      { value: "single_feeder", label: "Selected Feeder" },
      { value: "selected_feeders", label: "Selected Feeders" },
      { value: "all_11kv_only", label: "All 11 KV Feeders" },
      { value: "full_substation", label: "Full Substation" }
    ].map(function (option) {
      return '<option value="' + App.escapeHtml(option.value) + '"' + (option.value === selectedValue ? " selected" : "") + ">" + App.escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function renderEventBaseFeederOptions(record, selectedId) {
    return ['<option value="">Select feeder</option>'].concat(getEventEligibleFeeders(record).map(function (feeder) {
      return '<option value="' + App.escapeHtml(feeder.id) + '"' + (feeder.id === selectedId ? " selected" : "") + ">" + App.escapeHtml(App.getFeederLabel(feeder)) + "</option>";
    })).join("");
  }

  function buildQuickEventButtonsHtml(activeType) {
    return [
      '<div class="button-row dailylog-event-quick-actions">',
      EVENT_TYPES.map(function (eventType) {
        return '<button type="button" class="' + (eventType === activeType ? "primary-button is-active" : "secondary-button") + ' dailylog-event-quick-button" data-event-quick-type="' + App.escapeHtml(eventType) + '">' + App.escapeHtml(eventType) + "</button>";
      }).join(""),
      "</div>"
    ].join("");
  }

  function buildSelectedFeederMap(selectedIds) {
    return asArray(selectedIds).reduce(function (accumulator, feederId) {
      accumulator[feederId] = true;
      return accumulator;
    }, {});
  }

  function buildEventChecklistHtml(record, draft) {
    const feeders = getEventEligibleFeeders(record);
    const selectedMap = buildSelectedFeederMap(asArray(draft.selectedFeederIds).length ? draft.selectedFeederIds : getSuggestedEventFeederIds(record, draft));

    if (draft.scopeType === "single_feeder") {
      return '<p class="field-note">This event will apply only to the selected feeder.</p>';
    }

    return [
      '<div class="dailylog-event-checklist">',
      feeders.map(function (feeder) {
        const checked = Boolean(selectedMap[feeder.id]);
        const isExpress = App.is33KvExpressFeeder(feeder);
        return '<label class="dailylog-event-option' + (isExpress ? " express" : "") + '">' +
          '<input type="checkbox" data-event-feeder-option value="' + App.escapeHtml(feeder.id) + '"' + (checked ? " checked" : "") + '>' +
          '<span>' + App.escapeHtml(App.getFeederLabel(feeder)) + (isExpress ? " (Express)" : "") + "</span>" +
        "</label>";
      }).join(""),
      "</div>"
    ].join("");
  }

  function buildEventListHtml(record, editingEventId) {
    const events = buildExplicitEventDescriptors(record);
    const feederMap = App.getFeederMap(record.feederSnapshot || []);

    if (!events.length) {
      return '<div class="empty-state compact-empty-state">No manual DLR events saved for this date.</div>';
    }

    return [
      '<div class="table-shell dailylog-event-table-shell">',
      '  <table class="compact-table">',
      '    <thead><tr><th>Type</th><th>From</th><th>To</th><th>Scope</th><th>Affected</th><th>Remark</th><th>Actions</th></tr></thead>',
      '    <tbody>',
      events.map(function (event) {
        const affectedLabels = event.affectedFeederIds.map(function (feederId) {
          return feederMap[feederId] ? App.getFeederLabel(feederMap[feederId]) : feederId;
        }).join(", ");
        return '<tr' + (event.id === editingEventId ? ' class="dailylog-event-row-editing"' : "") + ">" +
          "<td>" + App.escapeHtml(event.type) + "</td>" +
          "<td>" + App.escapeHtml(event.fromTime) + "</td>" +
          "<td>" + App.escapeHtml(event.toTime) + "</td>" +
          "<td>" + App.escapeHtml(event.scopeType.replace(/_/g, " ")) + "</td>" +
          "<td>" + App.escapeHtml(affectedLabels || "-") + "</td>" +
          "<td>" + App.escapeHtml(event.remark || "-") + "</td>" +
          '<td><div class="table-actions"><button type="button" class="secondary-button" data-action="edit-dailylog-event" data-id="' + App.escapeHtml(event.id) + '">Edit</button><button type="button" class="danger-button" data-action="delete-dailylog-event" data-id="' + App.escapeHtml(event.id) + '">Delete</button></div></td>' +
        "</tr>";
      }).join(""),
      "    </tbody>",
      "  </table>",
      "</div>"
    ].join("");
  }

  function getRecordEventById(record, eventId) {
    return normalizeRecordEvents(record && record.events).find(function (event) {
      return event.id === eventId;
    }) || null;
  }

  function resetEventDraft(state, overrides) {
    state.eventDraft = createEventDraft(state.activeRecord, overrides);
  }

  function editExistingEvent(state, eventId) {
    const event = getRecordEventById(state.activeRecord, eventId);
    if (!event) {
      return false;
    }

    state.eventDraft = createEventDraft(state.activeRecord, {
      id: event.id,
      type: event.type,
      scopeType: event.scopeType,
      baseFeederId: event.baseFeederId,
      fromTime: event.fromTime,
      toTime: event.toTime,
      remark: event.remark,
      selectedFeederIds: event.affectedFeederIds
    });
    return true;
  }

  function upsertRecordEvent(record, eventInput) {
    const nextEvent = normalizeDailyLogEvent(eventInput);
    const events = normalizeRecordEvents(record && record.events);
    const nextEvents = events.filter(function (event) {
      return event.id !== nextEvent.id;
    });
    nextEvents.push(Object.assign({}, nextEvent, {
      createdAt: nextEvent.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    record.events = nextEvents.sort(function (left, right) {
      return compareDateHourValues(record.date, left.fromTime, record.date, right.fromTime);
    });
  }

  function removeRecordEvent(record, eventId) {
    record.events = normalizeRecordEvents(record && record.events).filter(function (event) {
      return event.id !== eventId;
    });
  }

  function applyManualEventToRecord(record, eventInput) {
    const feedersById = App.getFeederMap(record.feederSnapshot || []);
    const affectedFeederIds = asArray(eventInput.affectedFeederIds).filter(function (feederId) {
      return Boolean(feedersById[feederId]);
    });

    if (!affectedFeederIds.length) {
      return null;
    }

    const nextEvent = {
      id: eventInput.id || "",
      type: String(eventInput.type || "").trim().toUpperCase(),
      source: "MANUAL_EVENT",
      scopeType: String(eventInput.scopeType || "single_feeder").trim(),
      baseFeederId: String(eventInput.baseFeederId || "").trim(),
      baseFeederName: eventInput.baseFeederId && feedersById[eventInput.baseFeederId] ? App.getFeederLabel(feedersById[eventInput.baseFeederId]) : "",
      affectedFeederIds: affectedFeederIds,
      affectedFeederNames: affectedFeederIds.map(function (feederId) {
        return App.getFeederLabel(feedersById[feederId]);
      }),
      fromTime: String(eventInput.fromTime || "").trim(),
      toTime: String(eventInput.toTime || "").trim(),
      remark: String(eventInput.remark || "").trim()
    };

    upsertRecordEvent(record, nextEvent);
    return nextEvent;
  }

  function buildGapManualLsEvent(record, feeder, candidate) {
    const firstMissingRow = record.rows[candidate.startIndex + 1];
    const lastMissingRow = record.rows[candidate.endIndex - 1];

    if (!firstMissingRow || !lastMissingRow) {
      return null;
    }

    return applyManualEventToRecord(record, {
      type: "LS",
      scopeType: "single_feeder",
      baseFeederId: feeder.id,
      affectedFeederIds: [feeder.id],
      fromTime: firstMissingRow.hour,
      toTime: lastMissingRow.hour,
      remark: "Marked from DLR gap"
    });
  }

  function buildAutoGapFaults(record) {
    const feedersById = App.getFeederMap(record && record.feederSnapshot);
    return buildAutoGapEventDescriptors(record, buildExplicitEventDescriptors(record)).map(function (event) {
      const feeder = feedersById[event.baseFeederId];
      return feeder ? buildAutoGapFaultFromEvent(record, event, feeder) : null;
    }).filter(Boolean);
  }

  function buildEventDerivedFaults(record) {
    const feedersById = App.getFeederMap(record && record.feederSnapshot);
    return buildExplicitEventDescriptors(record).reduce(function (accumulator, event) {
      event.affectedFeederIds.forEach(function (feederId) {
        const feeder = feedersById[feederId];
        if (feeder) {
          accumulator.push(buildDerivedFaultFromEvent(record, event, feeder));
        }
      });
      return accumulator;
    }, []);
  }

  function buildConsumptionSummary(record) {
    const workingRecord = withRecordMeterChangeEvents(record);
    const feeders = getDisplayFeeders(workingRecord.feederSnapshot);
    let totalConsumption = 0;
    let meterChangeConsidered = false;

    const rows = feeders.map(function (feeder) {
      const metrics = calculateFeederConsumptionMetrics(workingRecord, feeder);
      const openingClosing = getOpeningClosingKwh(workingRecord, feeder.id);
      const consumption = metrics.consumption;
      if (consumption !== "") {
        totalConsumption += consumption;
      }
      if (metrics.hasMeterChange) {
        meterChangeConsidered = true;
      }

      return {
        feederId: feeder.id,
        feederName: App.getFeederLabel(feeder),
        feederType: feeder.feederType,
        parentFeederId: feeder.parentFeederId || "",
        ctRatio: feeder.ctRatio,
        mf: feeder.mf,
        openingKwh: metrics.opening === "" ? openingClosing.opening : metrics.opening,
        closingKwh: metrics.closing === "" ? openingClosing.closing : metrics.closing,
        difference: metrics.difference,
        consumption: consumption
      };
    });

    return {
      rows: rows,
      totalConsumption: Number(totalConsumption.toFixed(2)),
      meterChangeConsidered: meterChangeConsidered
    };
  }

  function buildTableHtml(record) {
    const totalFeeder = getTotalFeeder(record.feederSnapshot);
    const feeders = getDisplayFeeders(record.feederSnapshot);
    const feederMap = App.getFeederMap(feederSnapshotWithTotal(cloneFeeders(feeders), totalFeeder));
    const childMap = buildChildMap(feeders);
    const eventContext = buildRecordEventContext(record);
    const batteryLabels = getBatteryLabels(record);
    const tapLabels = getTapLabels(record);

    return [
      '<div class="table-shell">',
      '  <table class="daily-log-table compact-table">',
      "    <thead>",
      "      <tr>",
      '        <th rowspan="2" class="hour-column hour-header-cell">Hrs</th>',
      '        <th rowspan="2" class="numeric-cell amp-cell total-column">Total</th>',
      feeders.map(function (feeder) {
        const headerClasses = ["feeder-header-cell"];
        if (feeder.depth > 0) {
          headerClasses.push("child-feeder-header");
        }
        if (App.is33KvFeeder(feeder)) {
          headerClasses.push("thirtythreekv-feeder-header");
        }
        return '<th colspan="' + getFeederSubcolumns(feeder).length + '"><div class="' + headerClasses.join(" ") + '">' + App.escapeHtml(App.getFeederLabel(feeder)) + "</div></th>";
      }).join(""),
      batteryLabels.map(function (label) {
        return '<th rowspan="2" class="numeric-cell kv-cell battery-cell">' + App.escapeHtml(label) + "</th>";
      }).join(""),
      tapLabels.map(function (label) {
        return '<th rowspan="2" class="numeric-cell tap-cell">' + App.escapeHtml(label) + "</th>";
      }).join(""),
      '        <th rowspan="2">Remark</th>',
      "      </tr>",
      "      <tr>",
      feeders.map(function (feeder) {
        return getFeederSubcolumns(feeder).map(function (column) {
          return '<th class="' + getColumnCellClass(column) + '">' + App.escapeHtml(column.toUpperCase()) + "</th>";
        }).join("");
      }).join(""),
      "      </tr>",
      "    </thead>",
      "    <tbody>",
      record.rows.map(function (row, rowIndex) {
        const memo = {};
        const totalAmp = totalFeeder ? getEffectiveAmpState(row, totalFeeder, feederMap, childMap, memo, {}).text : "";
        return [
          '<tr data-hour-row="' + rowIndex + '">',
          '  <th class="hour-column hour-value-cell">' + App.escapeHtml(row.hour) + "</th>",
          '  <td class="numeric-cell amp-cell total-column"><input type="number" inputmode="decimal" step="0.01" value="' + App.escapeHtml(totalAmp) + '" readonly class="' + getColumnInputClass("amp", true) + '" data-total-column-row="' + rowIndex + '"></td>',
          feeders.map(function (feeder) {
            const reading = getReading(row, feeder.id);
            const ampState = getEffectiveAmpState(row, feeder, feederMap, childMap, memo, {});
            const appliedEvent = getAppliedEventForCell(record, feeder.id, rowIndex, eventContext);
            return getFeederSubcolumns(feeder).map(function (column) {
              if (appliedEvent) {
                return '<td class="' + getColumnCellClass(column) + '">' + buildEventInputHtml(rowIndex, feeder, column, appliedEvent) + "</td>";
              }
              if (column === "amp") {
                return '<td class="numeric-cell amp-cell"><input type="number" inputmode="decimal" step="0.01" data-row-index="' + rowIndex + '" data-field-type="feeder" data-feeder-id="' + App.escapeHtml(feeder.id) + '" data-field-name="amp" value="' + App.escapeHtml(isAutoAmpFeeder(feeder, childMap) ? ampState.text : (reading.amp || "")) + '"' + (isAutoAmpFeeder(feeder, childMap) ? ' readonly class="' + getColumnInputClass("amp", true) + '" data-auto-amp="true"' : ' class="' + getColumnInputClass("amp", false) + '"') + "></td>";
              }
              if (column === "kv") {
                return '<td class="numeric-cell kv-cell"><input type="number" inputmode="decimal" step="0.01" class="' + getColumnInputClass("kv", false) + '" data-row-index="' + rowIndex + '" data-field-type="feeder" data-feeder-id="' + App.escapeHtml(feeder.id) + '" data-field-name="kv" value="' + App.escapeHtml(reading.kv || "") + '"></td>';
              }
              return '<td class="numeric-cell kwh-cell"><input type="number" inputmode="numeric" step="0.01" class="' + [getColumnInputClass("kwh", false), getKwhInputModeClass(reading)].filter(Boolean).join(" ") + '" data-entry-mode="' + App.escapeHtml(getKwhMeta(reading).entryMode) + '" title="' + App.escapeHtml(getKwhInputTitle(reading)) + '" data-row-index="' + rowIndex + '" data-field-type="feeder" data-feeder-id="' + App.escapeHtml(feeder.id) + '" data-field-name="kwh" value="' + App.escapeHtml(reading.kwh || "") + '"></td>';
            }).join("");
          }).join(""),
          batteryLabels.map(function (label, batteryIndex) {
            return '<td class="numeric-cell kv-cell battery-cell"><input type="number" inputmode="decimal" step="0.01" class="' + getColumnInputClass("battery", false) + '" data-row-index="' + rowIndex + '" data-field-type="battery" data-battery-index="' + batteryIndex + '" value="' + App.escapeHtml((row.batteryVoltages && row.batteryVoltages[batteryIndex]) || "") + '"></td>';
          }).join(""),
          tapLabels.map(function (label, tapIndex) {
            return '<td class="numeric-cell tap-cell"><input type="number" inputmode="numeric" step="1" min="1" max="18" class="' + getColumnInputClass("tap", false) + '" data-row-index="' + rowIndex + '" data-field-type="tap" data-tap-index="' + tapIndex + '" value="' + App.escapeHtml((row.tapPositions && row.tapPositions[tapIndex]) || "") + '"></td>';
          }).join(""),
          '  <td><textarea data-row-index="' + rowIndex + '" data-field-type="row" data-field-name="remark">' + App.escapeHtml(row.remark || "") + "</textarea></td>",
          "</tr>"
        ].join("");
      }).join(""),
      "    </tbody>",
      "  </table>",
      "</div>"
    ].join("");
  }

  function updateDerivedValuesInDom(container, record) {
    const totalFeeder = getTotalFeeder(record.feederSnapshot);
    const feeders = getDisplayFeeders(record.feederSnapshot);
    const feederMap = App.getFeederMap(feederSnapshotWithTotal(cloneFeeders(feeders), totalFeeder));
    const childMap = buildChildMap(feeders);
    const eventContext = buildRecordEventContext(record);

    record.rows.forEach(function (row, rowIndex) {
      const memo = {};
      if (totalFeeder) {
        const totalInput = container.querySelector('[data-total-column-row="' + rowIndex + '"]');
        const totalState = getEffectiveAmpState(row, totalFeeder, feederMap, childMap, memo, {});
        if (totalInput) {
          totalInput.value = totalState.text;
        }
      }

      feeders.forEach(function (feeder) {
        const reading = getReading(row, feeder.id);
        const appliedEvent = getAppliedEventForCell(record, feeder.id, rowIndex, eventContext);
        const kwhInput = container.querySelector('[data-row-index="' + rowIndex + '"][data-feeder-id="' + feeder.id + '"][data-field-name="kwh"]');
        if (kwhInput) {
          if (appliedEvent) {
            kwhInput.value = appliedEvent.type;
            kwhInput.readOnly = true;
            kwhInput.type = "text";
            kwhInput.className = getEventInputClass("kwh", appliedEvent.type);
            kwhInput.title = getEventInputTitle(appliedEvent);
          } else {
            kwhInput.type = "number";
            kwhInput.readOnly = false;
            kwhInput.className = [getColumnInputClass("kwh", false), getKwhInputModeClass(reading)].filter(Boolean).join(" ");
            kwhInput.value = reading.kwh || "";
            updateKwhInputPresentation(kwhInput, reading);
          }
        }

        const kvInput = container.querySelector('[data-row-index="' + rowIndex + '"][data-feeder-id="' + feeder.id + '"][data-field-name="kv"]');
        if (kvInput) {
          if (appliedEvent) {
            kvInput.value = appliedEvent.type;
            kvInput.readOnly = true;
            kvInput.type = "text";
            kvInput.className = getEventInputClass("kv", appliedEvent.type);
            kvInput.title = getEventInputTitle(appliedEvent);
          } else {
            kvInput.type = "number";
            kvInput.readOnly = false;
            kvInput.className = getColumnInputClass("kv", false);
            kvInput.value = reading.kv || "";
            kvInput.title = "";
          }
        }

        const ampInput = container.querySelector('[data-row-index="' + rowIndex + '"][data-feeder-id="' + feeder.id + '"][data-field-name="amp"]');
        const state = getEffectiveAmpState(row, feeder, feederMap, childMap, memo, {});
        if (ampInput) {
          if (appliedEvent) {
            ampInput.value = appliedEvent.type;
            ampInput.readOnly = true;
            ampInput.type = "text";
            ampInput.className = getEventInputClass("amp", appliedEvent.type);
            ampInput.title = getEventInputTitle(appliedEvent);
          } else if (isAutoAmpFeeder(feeder, childMap)) {
            ampInput.type = "number";
            ampInput.readOnly = true;
            ampInput.className = getColumnInputClass("amp", true);
            ampInput.value = state.text;
            ampInput.title = "";
          } else {
            ampInput.type = "number";
            ampInput.readOnly = false;
            ampInput.className = getColumnInputClass("amp", false);
            ampInput.value = reading.amp || "";
            ampInput.title = "";
          }
        }
      });
    });
  }

  function updateSaveStatus(container, message, type) {
    const target = container.querySelector("#dailylog-save-status");
    if (!target) {
      return;
    }
    target.textContent = message;
    target.className = "status-inline" + (type ? " " + type : "");
  }

  function persistRecord(container, silent) {
    const state = getModuleState();
    if (!state.activeRecord || !state.substationId) {
      return false;
    }

    if (state.saveTimer) {
      global.clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }

    synchronizeCalculatedAmps(state.activeRecord);
    const validation = validateRecordBeforeSave(state.activeRecord);
    if (!validation.valid) {
      const invalidTime = validation.point ? validation.point.hour : "selected time";
      const invalidDate = validation.point ? App.formatDate(validation.point.date) : App.formatDate(state.activeRecord.date);
      updateSaveStatus(container, "KWH validation failed", "error");
      App.toast("KWH reading cannot be less than previous reading unless meter change is marked. Check " + App.getFeederLabel(validation.feeder) + " at " + invalidDate + " " + invalidTime + ".", "error");
      return false;
    }

    const substation = App.findSubstation(state.substationId);
    const meterChangeEvents = asArray(state.activeRecord.meterChangeEvents).map(function (event) {
      return clone(event);
    });
    const dailyEvents = normalizeRecordEvents(state.activeRecord.events).map(function (event) {
      return clone(event);
    });
    state.activeRecord.substationSnapshot = substation ? {
      name: substation.name,
      division: substation.division,
      circle: substation.circle,
      location: substation.location,
      voltageLevel: substation.voltageLevel,
      batterySetCount: getBatterySetCount(substation),
      transformerCount: getTransformerCount(substation)
    } : state.activeRecord.substationSnapshot;
    state.activeRecord.substationId = state.substationId;
    state.activeRecord.date = state.date;
    state.activeRecord.operatorName = String(container.querySelector("#dailylog-operator") ? container.querySelector("#dailylog-operator").value : state.activeRecord.operatorName || "").trim() || App.auth.getSuggestedOperatorName();
    state.activeRecord.events = dailyEvents;
    state.activeRecord = App.storage.upsert("dailyLogs", state.activeRecord, "dailylog");
    state.activeRecord.meterChangeEvents = meterChangeEvents;
    state.activeRecord.events = dailyEvents;
    syncMeterChangeEventsForRecord(state.activeRecord);
    if (App.modules.faults && typeof App.modules.faults.syncGeneratedFaults === "function") {
      App.modules.faults.syncGeneratedFaults();
    }

    updateSaveStatus(container, "Saved locally at " + App.formatDateTime(state.activeRecord.updatedAt), "");
    if (!silent) {
      App.toast("Daily log saved locally.");
    }

    return true;
  }

  function scheduleSave(container) {
    const state = getModuleState();
    if (state.saveTimer) {
      global.clearTimeout(state.saveTimer);
    }

    synchronizeCalculatedAmps(state.activeRecord);
    updateDerivedValuesInDom(container, state.activeRecord);
    updateSaveStatus(container, "Saving locally...", "warning");
    state.saveTimer = global.setTimeout(function () {
      persistRecord(container, true);
    }, 450);
  }

  function buildConsumptionTableHtml(record) {
    const summary = buildConsumptionSummary(record);

    return [
      '<div class="report-section">',
      '  <div class="report-header">',
      "    <div>",
      "      <h3>Feeder-wise Consumption Summary</h3>",
      '      <p class="report-meta">Difference = Closing KWH - Opening KWH in normal cumulative flow. When meter change is confirmed, the calculation continues internally without cluttering the report.</p>',
      (summary.meterChangeConsidered ? '      <p class="report-meta">Meter change considered in calculation for some feeders.</p>' : ""),
      "    </div>",
      '    <div class="tag">Total Consumption: ' + App.escapeHtml(summary.totalConsumption.toFixed(2)) + " units</div>",
      "  </div>",
      summary.rows.length ? (
        '  <div class="table-shell">' +
        '    <table class="compact-table dailylog-summary-table">' +
        "      <thead><tr><th>Feeder Name</th><th class=\"summary-number-cell kwh-display-cell\">Opening</th><th class=\"summary-number-cell kwh-display-cell\">Closing</th><th class=\"summary-number-cell difference-cell\">Difference</th><th class=\"summary-number-cell mf-cell\">MF</th><th class=\"summary-number-cell consumption-cell\">Consumption</th></tr></thead>" +
        "      <tbody>" +
        summary.rows.map(function (row) {
          return "<tr>" +
            "<td>" + App.escapeHtml(row.feederName) + "</td>" +
            '<td class="summary-number-cell kwh-display-cell">' + App.escapeHtml(formatNumericDisplay(row.openingKwh, 2)) + "</td>" +
            '<td class="summary-number-cell kwh-display-cell">' + App.escapeHtml(formatNumericDisplay(row.closingKwh, 2)) + "</td>" +
            '<td class="summary-number-cell difference-cell">' + App.escapeHtml(formatNumericDisplay(row.difference, 2)) + "</td>" +
            '<td class="summary-number-cell mf-cell">' + App.escapeHtml(formatNumericDisplay(row.mf, 2) || "-") + "</td>" +
            '<td class="summary-number-cell consumption-cell">' + App.escapeHtml(formatNumericDisplay(row.consumption, 2)) + "</td>" +
          "</tr>";
        }).join("") +
        "      </tbody>" +
        "    </table>" +
        "  </div>"
      ) : '<div class="empty-state">No feeder KWH readings are available yet for consumption calculation.</div>',
      "</div>"
    ].join("");
  }

  function buildPrintHtml(rawRecord) {
    const substation = App.findSubstation(rawRecord.substationId);
    const record = normalizeRecord(rawRecord, substation, rawRecord.date || App.getTodayValue());
    synchronizeCalculatedAmps(record);
    const snapshot = record.substationSnapshot || {};
    const totalFeeder = getTotalFeeder(record.feederSnapshot);
    const feeders = getDisplayFeeders(record.feederSnapshot);
    const feederMap = App.getFeederMap(feederSnapshotWithTotal(cloneFeeders(feeders), totalFeeder));
    const childMap = buildChildMap(feeders);
    const eventContext = buildRecordEventContext(record);
    const batteryLabels = getBatteryLabels(record);
    const tapLabels = getTapLabels(record);

    return [
      '<section class="module-shell daily-log-print-sheet">',
      '  <div class="report-section">',
      '    <div class="report-header">',
      "      <div>",
      "        <h2>MSEDCL Substation Daily Log Report</h2>",
      "        <p class=\"report-meta\">" + App.escapeHtml(snapshot.name || "Substation") + " | " + App.escapeHtml(snapshot.division || "-") + " | " + App.escapeHtml(snapshot.circle || "-") + " | " + App.escapeHtml(snapshot.voltageLevel || "-") + "</p>",
      "      </div>",
      '      <div class="tag">Date: ' + App.escapeHtml(App.formatDate(record.date)) + "</div>",
      "    </div>",
      '    <div class="table-shell daily-log-print-table-shell">',
      '      <table class="compact-table daily-log-print-table">',
      "        <thead>",
      "          <tr>",
      '            <th rowspan="2">Hrs</th>',
      '            <th rowspan="2">Total</th>',
      feeders.map(function (feeder) {
        return '<th colspan="' + getFeederSubcolumns(feeder).length + '">' + App.escapeHtml(App.getFeederLabel(feeder)) + "</th>";
      }).join(""),
      batteryLabels.map(function (label) {
        return '<th rowspan="2">' + App.escapeHtml(label) + "</th>";
      }).join(""),
      tapLabels.map(function (label) {
        return '<th rowspan="2">' + App.escapeHtml(label) + "</th>";
      }).join(""),
      '            <th rowspan="2">Remark</th>',
      "          </tr>",
      "          <tr>",
      feeders.map(function (feeder) {
        return getFeederSubcolumns(feeder).map(function (column) {
          return "<th>" + App.escapeHtml(column.toUpperCase()) + "</th>";
        }).join("");
      }).join(""),
      "          </tr>",
      "        </thead>",
      "        <tbody>",
      record.rows.map(function (row, rowIndex) {
        const memo = {};
        return "<tr>" +
          "<td>" + App.escapeHtml(row.hour) + "</td>" +
          "<td>" + App.escapeHtml(totalFeeder ? getEffectiveAmpState(row, totalFeeder, feederMap, childMap, memo, {}).text : "") + "</td>" +
          feeders.map(function (feeder) {
            const ampState = getEffectiveAmpState(row, feeder, feederMap, childMap, memo, {});
            const reading = getReading(row, feeder.id);
            const appliedEvent = getAppliedEventForCell(record, feeder.id, rowIndex, eventContext);
            return getFeederSubcolumns(feeder).map(function (column) {
              if (appliedEvent) {
                return "<td>" + App.escapeHtml(appliedEvent.type) + "</td>";
              }
              if (column === "amp") {
                return "<td>" + App.escapeHtml(ampState.text || "") + "</td>";
              }
              if (column === "kv") {
                return "<td>" + App.escapeHtml(reading.kv || "") + "</td>";
              }
              return "<td>" + App.escapeHtml(reading.kwh || "") + "</td>";
            }).join("");
          }).join("") +
          batteryLabels.map(function (label, batteryIndex) {
            return "<td>" + App.escapeHtml((row.batteryVoltages && row.batteryVoltages[batteryIndex]) || "") + "</td>";
          }).join("") +
          tapLabels.map(function (label, tapIndex) {
            return "<td>" + App.escapeHtml((row.tapPositions && row.tapPositions[tapIndex]) || "") + "</td>";
          }).join("") +
          "<td>" + App.escapeHtml(row.remark || "") + "</td>" +
        "</tr>";
      }).join(""),
      "        </tbody>",
      "      </table>",
      "    </div>",
      "  </div>",
      "</section>"
    ].join("");
  }

  function getReportFeeders(record) {
    return getDisplayFeeders(record && record.feederSnapshot);
  }

  function getAppliedEventType(record, feederId, rowIndex) {
    const event = getAppliedEventForCell(record, feederId, rowIndex);
    return event ? event.type : "";
  }

  function getNumericReadingValue(record, feederId, rowIndex, fieldName) {
    if (!record || !Array.isArray(record.rows) || !record.rows[rowIndex]) {
      return null;
    }

    if (getAppliedEventForCell(record, feederId, rowIndex)) {
      return null;
    }

    const reading = getReading(record.rows[rowIndex], feederId);
    const rawValue = reading[fieldName];
    if (rawValue === "" || rawValue === null || rawValue === undefined) {
      return null;
    }

    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  App.registerModule("dailylog", {
    title: "Daily Log / DLR",
    subtitle: "00:00 to 24:00 entry sheet with grouped 11 KV feeders, 33 KV sections, configurable battery/tap columns, and feeder-wise MF consumption.",

    buildPrintHtml: buildPrintHtml,
    buildConsumptionSummary: buildConsumptionSummary,
    buildConsumptionTableHtml: buildConsumptionTableHtml,
    buildAutoGapFaults: buildAutoGapFaults,
    buildEventDerivedFaults: buildEventDerivedFaults,
    getReportFeeders: getReportFeeders,
    getAppliedEventType: getAppliedEventType,
    getNumericReadingValue: getNumericReadingValue,

    render: function () {
      const substations = App.getSubstations();
      const state = ensureStateRecord();

      if (!substations.length) {
        return [
          '<section class="module-shell">',
          '  <div class="card">',
          '    <div class="empty-state">',
          "      Add at least one substation in Substation Management before using the daily log module.",
          "    </div>",
          "  </div>",
          "</section>"
        ].join("");
      }

      synchronizeCalculatedAmps(state.activeRecord);
      const selectedSubstation = App.findSubstation(state.substationId);
      const displayFeeders = getDisplayFeeders(state.activeRecord.feederSnapshot);
      const eventDraft = state.eventDraft;
      const manualEventCount = buildExplicitEventDescriptors(state.activeRecord).length;

      return [
        '<section class="module-shell">',
        '  <div class="card daily-log-wrapper">',
        '    <div class="module-toolbar">',
        "      <div>",
        "        <h3>Daily Log Entry</h3>",
        "        <p class=\"muted-text\">00:00 is the opening carry-forward row and now auto-picks the previous day 24:00 or last closing KWH feeder-wise when the opening cell is still blank. Total AMP stays immediately after Hrs and includes only 11 KV Main INC feeders. 33 KV feeders remain outside Total, while battery and tap columns follow the configured substation counts. When a later actual KWH is entered and the gap hours are blank, the system can estimate those intermediate hours on confirmation.</p>",
        "      </div>",
        '      <div class="button-row">',
        '        <button type="button" class="secondary-button" id="dailylog-save-button">Save Now</button>',
        '        <button type="button" class="primary-button" id="dailylog-print-button">Print Report</button>',
        "      </div>",
        "    </div>",
        '    <div class="daily-log-controls">',
        '      <div class="field-group"><label for="dailylog-substation">Substation</label><select id="dailylog-substation">' + App.buildSubstationOptions(state.substationId, false) + "</select></div>",
        '      <div class="field-group"><label for="dailylog-date">Date</label><input id="dailylog-date" type="date" value="' + App.escapeHtml(state.date) + '"></div>',
        '      <div class="field-group"><label for="dailylog-operator">Operator Name</label><input id="dailylog-operator" type="text" value="' + App.escapeHtml(state.activeRecord.operatorName || App.auth.getSuggestedOperatorName() || "") + '" placeholder="Your name"></div>',
        '      <div class="field-group"><label>Visible Feeders</label><input type="text" disabled value="' + displayFeeders.length + ' configured"></div>',
        '      <div class="field-group"><label>Save Status</label><div class="tag"><span id="dailylog-save-status" class="status-inline">Ready for local entry</span></div></div>',
        "    </div>",
        selectedSubstation ? '<div class="tag">Substation: ' + App.escapeHtml(selectedSubstation.name) + " | Division: " + App.escapeHtml(selectedSubstation.division || "-") + " | Voltage: " + App.escapeHtml(selectedSubstation.voltageLevel || "-") + "</div>" : "",
        '    <div class="section-block dailylog-event-section">',
        '      <div class="section-title-row">',
        "        <div>",
        "          <h4>" + App.escapeHtml(eventDraft.id ? "Edit DLR Event" : "Add DLR Event") + "</h4>",
        '          <p class="small-status">Quick buttons below set the event type. Use the same form to add or update LS, SD, BD, EF, or SF blocks.</p>',
        "        </div>",
        '        <div class="tag">Saved Events: ' + manualEventCount + "</div>",
        "      </div>",
        buildQuickEventButtonsHtml(eventDraft.type),
        '      <form id="dailylog-event-form" class="stack">',
        '        <div class="form-grid">',
        '          <div class="field-group"><label for="dailylog-event-type">Event Type</label><select id="dailylog-event-type" name="type">' + renderEventTypeOptions(eventDraft.type) + "</select></div>",
        '          <div class="field-group"><label for="dailylog-event-scope">Scope</label><select id="dailylog-event-scope" name="scopeType">' + renderEventScopeOptions(eventDraft.scopeType) + "</select></div>",
        '          <div class="field-group"><label for="dailylog-event-feeder">Reference Feeder</label><select id="dailylog-event-feeder" name="baseFeederId">' + renderEventBaseFeederOptions(state.activeRecord, eventDraft.baseFeederId) + '</select><p class="field-note">For single-feeder events choose the affected feeder. For SF/propagation this acts as the reference feeder.</p></div>',
        '          <div class="field-group"><label for="dailylog-event-from">From Time</label><select id="dailylog-event-from" name="fromTime"><option value="">Select time</option>' + App.constants.dailyHours.map(function (hour) { return '<option value="' + App.escapeHtml(hour) + '"' + (hour === eventDraft.fromTime ? " selected" : "") + ">" + App.escapeHtml(hour) + "</option>"; }).join("") + "</select></div>",
        '          <div class="field-group"><label for="dailylog-event-to">To Time</label><select id="dailylog-event-to" name="toTime"><option value="">Select time</option>' + App.constants.dailyHours.map(function (hour) { return '<option value="' + App.escapeHtml(hour) + '"' + (hour === eventDraft.toTime ? " selected" : "") + ">" + App.escapeHtml(hour) + "</option>"; }).join("") + "</select></div>",
        '          <div class="field-group full-width"><label for="dailylog-event-remark">Remark</label><textarea id="dailylog-event-remark" name="remark">' + App.escapeHtml(eventDraft.remark || "") + "</textarea></div>",
        '          <div class="field-group full-width"><label>Affected Feeders</label>' + buildEventChecklistHtml(state.activeRecord, eventDraft) + '<p class="field-note">For SF the checklist excludes express feeders by default, but you can include or exclude feeders before saving.</p></div>',
        "        </div>",
        '        <div class="form-actions"><button type="submit" class="secondary-button">' + App.escapeHtml(eventDraft.id ? "Update Event" : "Apply Event To DLR") + '</button>' + (eventDraft.id ? '<button type="button" class="secondary-button" id="dailylog-event-cancel-button">Cancel Edit</button>' : '<button type="button" class="secondary-button" id="dailylog-event-clear-button">Clear Form</button>') + "</div>",
        "      </form>",
        "    </div>",
        '    <div class="dailylog-active-time-bar"><div id="dailylog-active-hour-indicator" class="dailylog-active-hour-indicator">Entry Time: Select a cell</div></div>',
        buildTableHtml(state.activeRecord),
        '    <div class="section-block dailylog-event-list-section">',
        '      <div class="section-title-row">',
        "        <div>",
        "          <h4>Event Register For Selected Date</h4>",
        '          <p class="small-status">All manual DLR events for this date appear below the chart so operators can review, edit, or delete them without leaving Daily Log Entry.</p>',
        "        </div>",
        '        <div class="tag">Rows: ' + manualEventCount + "</div>",
        "      </div>",
        buildEventListHtml(state.activeRecord, eventDraft.id),
        "    </div>",
        "  </div>",
        "</section>"
      ].join("");
    },

    afterRender: function (container) {
      const state = ensureStateRecord();
      const substationSelect = container.querySelector("#dailylog-substation");
      const dateInput = container.querySelector("#dailylog-date");
      const saveButton = container.querySelector("#dailylog-save-button");
      const printButton = container.querySelector("#dailylog-print-button");
      const eventForm = container.querySelector("#dailylog-event-form");
      const eventTypeSelect = container.querySelector("#dailylog-event-type");
      const eventScopeSelect = container.querySelector("#dailylog-event-scope");
      const eventFeederSelect = container.querySelector("#dailylog-event-feeder");
      const eventFromSelect = container.querySelector("#dailylog-event-from");
      const eventToSelect = container.querySelector("#dailylog-event-to");
      const eventRemarkInput = container.querySelector("#dailylog-event-remark");
      const eventCancelButton = container.querySelector("#dailylog-event-cancel-button");
      const eventClearButton = container.querySelector("#dailylog-event-clear-button");
      const table = container.querySelector(".daily-log-table");
      const activeHourIndicator = container.querySelector("#dailylog-active-hour-indicator");

      if (!substationSelect || !dateInput || !saveButton || !printButton || !table) {
        return;
      }

      App.enableGridNavigation(table, 'tbody input:not([readonly]), tbody textarea');

      function focusGridCell(element) {
        if (!element) {
          return;
        }

        element.focus();
        if (typeof element.select === "function" && !element.matches("textarea")) {
          element.select();
        }
      }

      function setActiveEntryRow(rowIndex) {
        const rows = table.querySelectorAll("tbody tr[data-hour-row]");

        rows.forEach(function (row) {
          row.classList.toggle("active-entry-row", row.getAttribute("data-hour-row") === String(rowIndex));
        });

        state.activeRowIndex = rowIndex;

        if (!activeHourIndicator) {
          return;
        }

        if (rowIndex === null || rowIndex === undefined || Number.isNaN(rowIndex) || !state.activeRecord.rows[rowIndex]) {
          activeHourIndicator.textContent = "Entry Time: Select a cell";
          activeHourIndicator.classList.remove("is-active");
          return;
        }

        activeHourIndicator.textContent = "Entry Time: " + state.activeRecord.rows[rowIndex].hour;
        activeHourIndicator.classList.add("is-active");
      }

      function revertKwhInput(target, fallbackValue, fallbackMode, fallbackSource) {
        const rowIndex = Number(target.getAttribute("data-row-index"));
        const feederId = target.getAttribute("data-feeder-id");
        const row = state.activeRecord.rows[rowIndex];

        if (!row || !feederId) {
          return;
        }

        const reading = getReading(row, feederId);
        reading.kwh = fallbackValue;
        setFieldMeta(reading, "kwh", fallbackMode || (isBlankReadingValue(fallbackValue) ? "missing" : "actual"), fallbackSource || "");
        target.value = fallbackValue;
        target.dataset.previousValue = fallbackValue;
        target.dataset.previousEntryMode = getKwhMeta(reading).entryMode;
        target.dataset.previousSource = getKwhMeta(reading).source;
        updateKwhInputPresentation(target, reading);
        updateDerivedValuesInDom(container, state.activeRecord);
        global.setTimeout(function () {
          focusGridCell(target);
        }, 0);
      }

      function commitKwhValue(target) {
        const rowIndex = Number(target.getAttribute("data-row-index"));
        const feederId = target.getAttribute("data-feeder-id");
        const feeder = state.activeRecord.feederSnapshot.find(function (item) {
          return item.id === feederId;
        });
        const row = state.activeRecord.rows[rowIndex];

        if (Number.isNaN(rowIndex) || !feederId || !feeder || !row) {
          return;
        }

        const reading = getReading(row, feederId);
        const previousValue = target.dataset.previousValue !== undefined ? target.dataset.previousValue : (reading.kwh || "");
        const previousMode = target.dataset.previousEntryMode || getKwhMeta(reading).entryMode;
        const previousSource = target.dataset.previousSource || getKwhMeta(reading).source;
        const nextValue = String(target.value || "").trim();
        const rowHour = row.hour;
        const pointDate = state.activeRecord.date;

        reading.kwh = nextValue;
        setFieldMeta(reading, "kwh", isBlankReadingValue(nextValue) ? "missing" : "actual", isBlankReadingValue(nextValue) ? "" : "manual");

        if (isBlankReadingValue(nextValue)) {
          removeRecordMeterChangeEvent(state.activeRecord, feederId, pointDate, rowHour);
          target.dataset.previousValue = "";
          target.dataset.previousEntryMode = getKwhMeta(reading).entryMode;
          target.dataset.previousSource = getKwhMeta(reading).source;
          updateKwhInputPresentation(target, reading);
          scheduleSave(container);
          return;
        }

        const numericValue = Number(nextValue);
        if (!Number.isFinite(numericValue)) {
          App.toast("Enter a valid numeric KWH reading.", "error");
          revertKwhInput(target, previousValue, previousMode, previousSource);
          return;
        }

        const readingContext = getPreviousReadingContext(state.activeRecord, feeder, rowIndex);
        const existingEvent = findRecordMeterChangeEvent(state.activeRecord, feederId, pointDate, rowHour);

        if (readingContext.previousReading !== null && numericValue < readingContext.previousReading) {
          if (!existingEvent) {
            const confirmed = global.confirm(
              "KWH reading cannot be less than previous reading unless meter change is marked.\n\nPrevious reading: " +
              formatNumericDisplay(readingContext.previousReading, 2) +
              "\nNew reading: " + nextValue +
              "\n\nPress OK to mark meter change for " + App.getFeederLabel(feeder) + " at " + rowHour + "."
            );

            if (!confirmed) {
              App.toast("KWH reading cannot be less than previous reading unless meter change is marked.", "error");
              revertKwhInput(target, previousValue, previousMode, previousSource);
              return;
            }
          }

          upsertRecordMeterChangeEvent(state.activeRecord, {
            substationId: state.activeRecord.substationId,
            feederId: feederId,
            feederName: App.getFeederLabel(feeder),
            effectiveDate: pointDate,
            effectiveTime: rowHour,
            oldMeterLastReading: readingContext.previousReading === null ? "" : String(readingContext.previousReading),
            newMeterStartReading: nextValue,
            remark: ""
          });
          App.toast("Meter change marked for " + App.getFeederLabel(feeder) + " at " + rowHour + ".", "warning");
        } else {
          removeRecordMeterChangeEvent(state.activeRecord, feederId, pointDate, rowHour);
        }

        const chainValidation = validateFeederTimeline(state.activeRecord, feeder);
        if (!chainValidation.valid) {
          App.toast("This KWH value conflicts with chronological readings for " + App.getFeederLabel(feeder) + ". Update the later reading or mark meter change there.", "error");
          removeRecordMeterChangeEvent(state.activeRecord, feederId, pointDate, rowHour);
          reading.kwh = previousValue;
          setFieldMeta(reading, "kwh", previousMode, previousSource);
          if (existingEvent) {
            upsertRecordMeterChangeEvent(state.activeRecord, existingEvent);
          }
          revertKwhInput(target, previousValue, previousMode, previousSource);
          return;
        }

        target.value = nextValue;
        target.dataset.previousValue = nextValue;
        target.dataset.previousEntryMode = getKwhMeta(reading).entryMode;
        target.dataset.previousSource = getKwhMeta(reading).source;
        updateKwhInputPresentation(target, reading);
        let estimationAction = "none";
        if (!findRecordMeterChangeEvent(state.activeRecord, feederId, pointDate, rowHour)) {
          estimationAction = maybeEstimateIntermediateKwh(container, feeder, rowIndex);
        }
        scheduleSave(container);
        if (estimationAction === "manual_ls" || estimationAction === "keep_blank") {
          global.setTimeout(function () {
            App.renderCurrentRoute();
          }, 120);
        }
      }

      function reloadRecord() {
        if (state.saveTimer) {
          global.clearTimeout(state.saveTimer);
          state.saveTimer = null;
        }
        const substation = App.findSubstation(state.substationId);
        const existing = App.storage.getCollection("dailyLogs").find(function (item) {
          return item.substationId === state.substationId && item.date === state.date;
        });
        state.activeRecord = normalizeRecord(existing, substation, state.date);
        synchronizeCalculatedAmps(state.activeRecord);
        resetEventDraft(state);
      }

      function syncDraftFromEventForm(resetSelection) {
        if (!eventForm) {
          return;
        }

        state.eventDraft.type = eventTypeSelect ? eventTypeSelect.value : state.eventDraft.type;
        state.eventDraft.scopeType = eventScopeSelect ? eventScopeSelect.value : state.eventDraft.scopeType;
        state.eventDraft.baseFeederId = eventFeederSelect ? eventFeederSelect.value : state.eventDraft.baseFeederId;
        state.eventDraft.fromTime = eventFromSelect ? eventFromSelect.value : state.eventDraft.fromTime;
        state.eventDraft.toTime = eventToSelect ? eventToSelect.value : state.eventDraft.toTime;
        state.eventDraft.remark = eventRemarkInput ? eventRemarkInput.value : state.eventDraft.remark;

        if (state.eventDraft.type === "SF" && state.eventDraft.scopeType === "single_feeder") {
          state.eventDraft.scopeType = "selected_feeders";
        }

        if (!state.eventDraft.id && !state.eventDraft.scopeType) {
          state.eventDraft.scopeType = getSuggestedScopeForEventType(state.eventDraft.type);
        }

        if (resetSelection) {
          state.eventDraft.selectedFeederIds = [];
        }
      }

      substationSelect.addEventListener("change", function () {
        const previousSubstationId = state.substationId;
        if (!persistRecord(container, true)) {
          substationSelect.value = previousSubstationId;
          return;
        }
        state.substationId = substationSelect.value;
        reloadRecord();
        App.renderCurrentRoute();
      });

      dateInput.addEventListener("change", function () {
        const previousDate = state.date;
        if (!persistRecord(container, true)) {
          dateInput.value = previousDate;
          return;
        }
        state.date = dateInput.value || App.getTodayValue();
        reloadRecord();
        App.renderCurrentRoute();
      });

      if (eventTypeSelect) {
        eventTypeSelect.addEventListener("change", function () {
          syncDraftFromEventForm(true);
          App.renderCurrentRoute();
        });
      }

      if (eventScopeSelect) {
        eventScopeSelect.addEventListener("change", function () {
          syncDraftFromEventForm(true);
          App.renderCurrentRoute();
        });
      }

      if (eventFeederSelect) {
        eventFeederSelect.addEventListener("change", function () {
          syncDraftFromEventForm(true);
          App.renderCurrentRoute();
        });
      }

      container.querySelectorAll("[data-event-quick-type]").forEach(function (button) {
        button.addEventListener("click", function () {
          const quickType = button.getAttribute("data-event-quick-type");
          const activeHour = Number.isInteger(state.activeRowIndex) && state.activeRecord.rows[state.activeRowIndex]
            ? state.activeRecord.rows[state.activeRowIndex].hour
            : "";
          resetEventDraft(state, {
            type: quickType,
            scopeType: getSuggestedScopeForEventType(quickType),
            fromTime: activeHour,
            toTime: activeHour
          });
          App.renderCurrentRoute();
        });
      });

      [eventFromSelect, eventToSelect].forEach(function (element) {
        if (element) {
          element.addEventListener("change", function () {
            syncDraftFromEventForm(false);
          });
        }
      });

      if (eventRemarkInput) {
        eventRemarkInput.addEventListener("input", function () {
          syncDraftFromEventForm(false);
        });
      }

      if (eventForm) {
        eventForm.addEventListener("change", function (event) {
          if (event.target.matches("[data-event-feeder-option]")) {
            state.eventDraft.selectedFeederIds = Array.from(eventForm.querySelectorAll("[data-event-feeder-option]:checked")).map(function (element) {
              return element.value;
            });
          }
        });

        eventForm.addEventListener("submit", function (event) {
          event.preventDefault();
          syncDraftFromEventForm(false);

          const selectedFeederIds = Array.from(eventForm.querySelectorAll("[data-event-feeder-option]:checked")).map(function (element) {
            return element.value;
          });
          const affectedFeederIds = selectedFeederIds.length ? selectedFeederIds : getSuggestedEventFeederIds(state.activeRecord, state.eventDraft);

          if (EVENT_TYPES.indexOf(String(state.eventDraft.type || "").toUpperCase()) === -1) {
            App.toast("Select a valid event type.", "error");
            return;
          }

          if (!state.eventDraft.fromTime || !state.eventDraft.toTime) {
            App.toast("Select From Time and To Time for the event.", "error");
            return;
          }

          if (getHourIndex(state.eventDraft.toTime) < getHourIndex(state.eventDraft.fromTime)) {
            App.toast("To Time cannot be earlier than From Time.", "error");
            return;
          }

          if (!affectedFeederIds.length) {
            App.toast("Select at least one affected feeder.", "error");
            return;
          }

          applyManualEventToRecord(state.activeRecord, {
            id: state.eventDraft.id,
            type: state.eventDraft.type,
            scopeType: state.eventDraft.scopeType,
            baseFeederId: state.eventDraft.baseFeederId,
            affectedFeederIds: affectedFeederIds,
            fromTime: state.eventDraft.fromTime,
            toTime: state.eventDraft.toTime,
            remark: state.eventDraft.remark
          });

          resetEventDraft(state);
          if (persistRecord(container, true)) {
            App.toast("DLR event saved successfully.", "success");
            App.renderCurrentRoute();
          }
        });
      }

      if (eventCancelButton) {
        eventCancelButton.addEventListener("click", function () {
          resetEventDraft(state);
          App.renderCurrentRoute();
        });
      }

      if (eventClearButton) {
        eventClearButton.addEventListener("click", function () {
          resetEventDraft(state);
          App.renderCurrentRoute();
        });
      }

      table.addEventListener("focusin", function (event) {
        const target = event.target.closest("input, textarea");
        if (!target) {
          return;
        }

        if (target.getAttribute("data-field-name") === "kwh" && target.getAttribute("data-field-type") === "feeder") {
          const reading = getReading(state.activeRecord.rows[Number(target.getAttribute("data-row-index"))], target.getAttribute("data-feeder-id"));
          target.dataset.previousValue = target.value;
          target.dataset.previousEntryMode = getKwhMeta(reading).entryMode;
          target.dataset.previousSource = getKwhMeta(reading).source;
          updateKwhInputPresentation(target, reading);
        }

        const rowIndex = Number(target.getAttribute("data-row-index"));
        if (!Number.isNaN(rowIndex)) {
          setActiveEntryRow(rowIndex);
        }
      });

      table.addEventListener("focusout", function () {
        global.setTimeout(function () {
          const activeElement = global.document.activeElement;
          if (!table.contains(activeElement)) {
            setActiveEntryRow(null);
          }
        }, 0);
      });

      table.addEventListener("input", function (event) {
        const target = event.target;
        if (target.hasAttribute("readonly")) {
          return;
        }

        const rowIndex = Number(target.getAttribute("data-row-index"));
        const fieldType = target.getAttribute("data-field-type");
        const fieldName = target.getAttribute("data-field-name");

        if (Number.isNaN(rowIndex) || !fieldName) {
          return;
        }

        const row = state.activeRecord.rows[rowIndex];
        if (!row) {
          return;
        }

        if (fieldType === "feeder") {
          const feederId = target.getAttribute("data-feeder-id");
          getReading(row, feederId)[fieldName] = target.value;
          if (fieldName === "kwh") {
            return;
          }
        } else if (fieldType === "battery") {
          const batteryIndex = App.toNumber(target.getAttribute("data-battery-index"), 0);
          row.batteryVoltages = Array.isArray(row.batteryVoltages) ? row.batteryVoltages : [];
          row.batteryVoltages[batteryIndex] = target.value;
          if (batteryIndex === 0) {
            row.batteryVoltage = target.value;
          }
        } else if (fieldType === "tap") {
          const tapIndex = App.toNumber(target.getAttribute("data-tap-index"), 0);
          row.tapPositions = Array.isArray(row.tapPositions) ? row.tapPositions : [];
          row.tapPositions[tapIndex] = target.value;
          if (tapIndex === 0) {
            row.transformer = target.value;
          }
        } else {
          row[fieldName] = target.value;
        }

        scheduleSave(container);
      });

      table.addEventListener("change", function (event) {
        const target = event.target;
        if (target.hasAttribute("readonly")) {
          return;
        }

        if (target.getAttribute("data-field-type") === "feeder" && target.getAttribute("data-field-name") === "kwh") {
          commitKwhValue(target);
        }
      });

      saveButton.addEventListener("click", function () {
        if (persistRecord(container, false)) {
          App.renderCurrentRoute();
        }
      });

      printButton.addEventListener("click", function () {
        if (persistRecord(container, true)) {
          App.openPrintWindow("Daily Log Report", buildPrintHtml(state.activeRecord), {
            orientation: "landscape",
            pageSize: "A3",
            margin: "8mm",
            bodyClass: "print-dailylog"
          });
        }
      });

      container.addEventListener("click", function (event) {
        const editEventButton = event.target.closest('[data-action="edit-dailylog-event"]');
        if (editEventButton) {
          const eventId = editEventButton.getAttribute("data-id");
          if (eventId && editExistingEvent(state, eventId)) {
            App.renderCurrentRoute();
          }
          return;
        }

        const deleteEventButton = event.target.closest('[data-action="delete-dailylog-event"]');
        if (!deleteEventButton) {
          return;
        }

        const eventId = deleteEventButton.getAttribute("data-id");
        if (!eventId) {
          return;
        }

        if (!global.confirm("Delete this DLR event and refresh the linked faults?")) {
          return;
        }

        if (state.eventDraft && state.eventDraft.id === eventId) {
          resetEventDraft(state);
        }
        removeRecordEvent(state.activeRecord, eventId);
        if (persistRecord(container, true)) {
          App.toast("DLR event deleted.", "warning");
          App.renderCurrentRoute();
        }
      });
    }
  });
})(window);
