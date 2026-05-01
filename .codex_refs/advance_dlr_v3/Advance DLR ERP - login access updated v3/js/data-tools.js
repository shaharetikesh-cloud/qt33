(function (global) {
  const App = global.SubstationRegisterApp;

  const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$|^24:00$/;
  const CT_RATIO_PATTERN = /^\d+\/\d+$/;
  const EVENT_CODES = ["EF", "LS", "BD", "OC", "SD", "SF", "LP"];
  const COLLECTION_OPTIONS = [
    { value: "substations", label: "Substation Master", jsonOnly: true, dateField: "" },
    { value: "dailyLogs", label: "Daily Logs", jsonOnly: true, dateField: "date" },
    { value: "meterChangeEvents", label: "Meter Change Events", jsonOnly: false, dateField: "effectiveDate" },
    { value: "faults", label: "Fault Register", jsonOnly: false, dateField: "date" },
    { value: "maintenanceLogs", label: "Maintenance Log", jsonOnly: false, dateField: "date" },
    { value: "batteryRecords", label: "Battery Maintenance", jsonOnly: true, dateField: "date" },
    { value: "transformerHistory", label: "Transformer History", jsonOnly: false, dateField: "installedDate" },
    { value: "vcbHistory", label: "VCB / Feeder History", jsonOnly: false, dateField: "installedDate" },
    { value: "equipmentChangeHistory", label: "CT / PT / Panel Change", jsonOnly: false, dateField: "date" },
    { value: "modificationHistory", label: "Modification Log", jsonOnly: false, dateField: "date" },
    { value: "chargeHandoverRecords", label: "Charge Handover Register", jsonOnly: false, dateField: "date" },
    { value: "settings", label: "Settings", jsonOnly: true, dateField: "" }
  ];

  function getTodayParts() {
    const today = App.getTodayValue();
    return {
      date: today,
      year: today.slice(0, 4),
      month: today.slice(5, 7)
    };
  }

  function getModuleState() {
    const today = getTodayParts();
    return App.getModuleState("datatools", {
      month: today.month,
      year: today.year,
      substationId: App.getSubstations()[0] ? App.getSubstations()[0].id : "",
      exportCollection: "faults",
      importTarget: "full_backup",
      importStrategy: "replace_all",
      previewResult: null,
      applyStatus: ""
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getMonthValue(state) {
    return String(state.year || "") + "-" + String(state.month || "").padStart(2, "0");
  }

  function safeFilename(value) {
    return String(value || "backup")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .toLowerCase();
  }

  function buildCollectionMap() {
    return COLLECTION_OPTIONS.reduce(function (accumulator, item) {
      accumulator[item.value] = item;
      return accumulator;
    }, {});
  }

  const COLLECTION_MAP = buildCollectionMap();

  function getCollectionConfig(collectionName) {
    return COLLECTION_MAP[String(collectionName || "").trim()] || null;
  }

  function isValidDateString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
  }

  function isValidTimeString(value) {
    return !String(value || "").trim() || TIME_PATTERN.test(String(value || "").trim());
  }

  function normalizeTime(value) {
    const text = String(value || "").trim();
    if (!TIME_PATTERN.test(text)) {
      return text;
    }
    if (text === "24:00") {
      return text;
    }
    const parts = text.split(":");
    return String(Number(parts[0])).padStart(2, "0") + ":" + String(Number(parts[1])).padStart(2, "0");
  }

  function parseTimeToMinutes(value) {
    const text = normalizeTime(value);
    if (!TIME_PATTERN.test(text)) {
      return null;
    }
    if (text === "24:00") {
      return 24 * 60;
    }
    const parts = text.split(":");
    return (Number(parts[0]) * 60) + Number(parts[1]);
  }

  function calculateDurationMinutes(startTime, endTime) {
    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);
    if (start === null || end === null) {
      return 0;
    }
    return end >= start ? (end - start) : ((24 * 60) - start + end);
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value, digits) {
    if (!Number.isFinite(Number(value))) {
      return "";
    }
    return Number(value).toLocaleString("en-IN", {
      useGrouping: false,
      minimumFractionDigits: typeof digits === "number" ? digits : 0,
      maximumFractionDigits: typeof digits === "number" ? digits : 2
    });
  }

  function getRowValue(row, names) {
    return names.reduce(function (found, key) {
      if (found !== "") {
        return found;
      }
      return row && row[key] !== undefined && row[key] !== null ? String(row[key]).trim() : "";
    }, "");
  }

  function flattenValue(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }

  function escapeCsvValue(value) {
    const text = flattenValue(value);
    if (text.indexOf(",") >= 0 || text.indexOf("\"") >= 0 || text.indexOf("\n") >= 0) {
      return "\"" + text.replace(/"/g, "\"\"") + "\"";
    }
    return text;
  }

  function buildCsvFromRecords(records) {
    const rows = asArray(records);
    const headers = rows.reduce(function (accumulator, row) {
      Object.keys(row || {}).forEach(function (key) {
        if (accumulator.indexOf(key) === -1) {
          accumulator.push(key);
        }
      });
      return accumulator;
    }, []);

    if (!headers.length) {
      return "";
    }

    return [headers.join(",")].concat(rows.map(function (row) {
      return headers.map(function (key) {
        return escapeCsvValue(row[key]);
      }).join(",");
    })).join("\n");
  }

  function normalizeHeaderKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function parseCsvText(text) {
    const rows = [];
    let current = "";
    let currentRow = [];
    let inQuotes = false;
    let index;

    for (index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (char === "\"") {
        if (inQuotes && next === "\"") {
          current += "\"";
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        currentRow.push(current);
        current = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") {
          index += 1;
        }
        currentRow.push(current);
        if (currentRow.some(function (item) { return String(item).trim() !== ""; })) {
          rows.push(currentRow);
        }
        currentRow = [];
        current = "";
        continue;
      }

      current += char;
    }

    currentRow.push(current);
    if (currentRow.some(function (item) { return String(item).trim() !== ""; })) {
      rows.push(currentRow);
    }

    if (!rows.length) {
      return [];
    }

    const headers = rows[0].map(normalizeHeaderKey);
    return rows.slice(1).map(function (row) {
      return headers.reduce(function (accumulator, header, headerIndex) {
        accumulator[header] = row[headerIndex] === undefined ? "" : String(row[headerIndex]).trim();
        return accumulator;
      }, {});
    });
  }

  function getChildElementsByLocalName(parent, name) {
    return Array.from(parent.childNodes || []).filter(function (node) {
      return node.nodeType === 1 && String(node.localName || node.nodeName).toLowerCase() === String(name || "").toLowerCase();
    });
  }

  function extractSpreadsheetCellText(cell) {
    const dataNode = getChildElementsByLocalName(cell, "Data")[0];
    return dataNode ? String(dataNode.textContent || "").trim() : "";
  }

  function parseSpreadsheetXmlText(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const parserError = xml.getElementsByTagName("parsererror")[0];
    if (parserError) {
      throw new Error("Unable to parse Spreadsheet XML file.");
    }

    const worksheets = getChildElementsByLocalName(xml.documentElement, "Worksheet");
    if (!worksheets.length) {
      return [];
    }

    const firstSheet = worksheets[0];
    const table = getChildElementsByLocalName(firstSheet, "Table")[0];
    const rows = getChildElementsByLocalName(table, "Row");
    if (!rows.length) {
      return [];
    }

    const headers = getChildElementsByLocalName(rows[0], "Cell").map(function (cell) {
      return normalizeHeaderKey(extractSpreadsheetCellText(cell));
    });

    return rows.slice(1).map(function (row) {
      const cells = getChildElementsByLocalName(row, "Cell");
      return headers.reduce(function (accumulator, header, index) {
        accumulator[header] = cells[index] ? extractSpreadsheetCellText(cells[index]) : "";
        return accumulator;
      }, {});
    }).filter(function (row) {
      return Object.keys(row).some(function (key) {
        return row[key] !== "";
      });
    });
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("Unable to read the selected file."));
      };
      reader.readAsText(file);
    });
  }

  function getFileExtension(filename) {
    const parts = String(filename || "").toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() : "";
  }

  function getExportCollectionRecords(collectionName) {
    if (collectionName === "settings") {
      return [App.storage.getSettings()];
    }
    return App.storage.getCollection(collectionName);
  }

  async function getExportCollectionRecordsAsync(collectionName) {
    if (collectionName === "settings") {
      return [App.storage.getSettings()];
    }
    return App.storage.getCollectionAsync(collectionName);
  }

  function buildCollectionOptions(selectedValue, includeFullBackup) {
    const options = [];
    if (includeFullBackup) {
      options.push('<option value="full_backup"' + (selectedValue === "full_backup" ? " selected" : "") + ">Full System Backup</option>");
    }
    COLLECTION_OPTIONS.forEach(function (option) {
      options.push('<option value="' + App.escapeHtml(option.value) + '"' + (option.value === selectedValue ? " selected" : "") + ">" + App.escapeHtml(option.label) + "</option>");
    });
    return options.join("");
  }

  function buildStrategyOptions(state) {
    const target = String(state.importTarget || "full_backup");
    const config = getCollectionConfig(target);
    const monthValue = getMonthValue(state);
    let options;

    if (target === "full_backup") {
      options = [
        { value: "replace_all", label: "Replace Full System" },
        { value: "merge_existing", label: "Merge with Existing Data" }
      ];
    } else if (config && config.dateField) {
      options = [
        { value: "merge_existing", label: "Merge with Existing Data" },
        { value: "replace_month", label: "Replace Selected Month (" + monthValue + ")" },
        { value: "replace_module", label: "Replace Entire Selected Module" }
      ];
    } else {
      options = [
        { value: "merge_existing", label: "Merge with Existing Data" },
        { value: "replace_module", label: "Replace Entire Selected Module" }
      ];
    }

    return options.map(function (item) {
      return '<option value="' + App.escapeHtml(item.value) + '"' + (item.value === state.importStrategy ? " selected" : "") + ">" + App.escapeHtml(item.label) + "</option>";
    }).join("");
  }

  function getSubstationById(substationId, database) {
    return asArray(database.substations).find(function (item) {
      return item.id === substationId;
    }) || null;
  }

  function findSubstationFromRow(row, database) {
    const substationId = getRowValue(row, ["substation_id", "substationid"]);
    const substationName = getRowValue(row, ["substation_name", "substationname", "substation"]);
    if (substationId) {
      return getSubstationById(substationId, database);
    }
    if (substationName) {
      return asArray(database.substations).find(function (item) {
        return String(item.name || "").trim().toLowerCase() === substationName.toLowerCase();
      }) || null;
    }
    return null;
  }

  // AUDIT-FIX HIGH-07 / 6H: Feeder matching stability during import.
  // We now enforce strict ID matches first, then explicit legacy exact names.
  // We do NOT use fuzzy/lower-case fallbacks if ID is available, preventing
  // cross-mapping when feeders are renamed but keep old IDs.
  function findFeederFromRow(row, substation) {
    const feederId = getRowValue(row, ["feeder_id", "feederid"]);
    const feederName = getRowValue(row, ["feeder_name", "feedername", "feeder", "related_feeder"]);
    const feeders = substation && Array.isArray(substation.feeders) ? substation.feeders : [];

    if (feederId) {
      const exactMatch = feeders.find(function (item) {
        return item.id === feederId;
      });
      if (exactMatch) {
        return exactMatch;
      }
      // If we have an ID but it doesn't match anything, we do NOT fall back to name,
      // because that means either the ID is invalid or the feeder was deleted.
      // Mixing ID and Name match logic silently corrupts data on ID-shifts.
      return null;
    }

    if (feederName) {
      const targetName = String(feederName).trim().toLowerCase();
      return feeders.find(function (item) {
        return String(item.feederName || item.name || "").trim().toLowerCase() === targetName;
      }) || null;
    }

    return null;
  }

  // AUDIT-FIX HIGH-08 / 6H: Duplicate checking must respect stable IDs.
  // Previously some used `feederId || feederName`, causing duplicates if a feeder
  // was renamed (the name segment changed but it was the same logical event).
  // We now strictly use feederId when building the duplication key, falling back
  // to name ONLY if the record truly lacks an ID (legacy sparse imports).
  function getDuplicateKey(collectionName, record) {
    const target = String(collectionName || "");
    if (target === "substations") {
      return String(record.name || "").trim().toLowerCase();
    }
    if (target === "dailyLogs") {
      return [record.substationId, record.date].join("|");
    }
    if (target === "meterChangeEvents") {
      const fKeyMeter = record.feederId ? ("id:" + record.feederId) : ("name:" + String(record.feederName || "").toLowerCase());
      return [record.substationId, fKeyMeter, record.effectiveDate, record.effectiveTime].join("|");
    }
    if (target === "faults") {
      const fKey = record.feederId ? ("id:" + record.feederId) : ("name:" + String(record.feederName || "").toLowerCase());
      return [record.substationId, fKey, record.date, record.faultType, record.startTime, record.endTime].join("|");
    }
    if (target === "maintenanceLogs") {
      return [record.substationId, record.date, record.time, String(record.workDetail || "").toLowerCase()].join("|");
    }
    if (target === "batteryRecords") {
      return [record.substationId, record.date, String(record.batterySetName || "").toLowerCase()].join("|");
    }
    if (target === "transformerHistory") {
      return [record.substationId, String(record.transformerName || "").toLowerCase(), String(record.serialNumber || "").toLowerCase(), record.installedDate].join("|");
    }
    if (target === "vcbHistory") {
      const fKeyVcb = record.feederId ? ("id:" + record.feederId) : ("name:" + String(record.feederName || "").toLowerCase());
      return [record.substationId, fKeyVcb, String(record.vcbName || "").toLowerCase(), String(record.serialNumber || "").toLowerCase(), record.installedDate].join("|");
    }
    if (target === "equipmentChangeHistory") {
      const fKeyEq = record.feederId ? ("id:" + record.feederId) : ("name:" + String(record.feederName || "").toLowerCase());
      return [record.substationId, record.date, String(record.equipmentType || "").toLowerCase(), fKeyEq, String(record.equipmentName || "").toLowerCase()].join("|");
    }
    if (target === "modificationHistory") {
      return [record.substationId, record.date, String(record.category || "").toLowerCase(), String(record.relatedEquipment || "").toLowerCase()].join("|");
    }
    if (target === "chargeHandoverRecords") {
      return [record.substationId, record.date, String(record.chargeGivenBy || "").toLowerCase(), String(record.chargeTakenBy || "").toLowerCase(), record.chargeGivenTime, record.chargeTakenTime].join("|");
    }
    if (target === "settings") {
      return "settings";
    }
    return String(record.id || "");
  }

  function getRecordMonth(collectionName, record) {
    const config = getCollectionConfig(collectionName);
    if (!config || !config.dateField) {
      return "";
    }
    const value = String(record[config.dateField] || "").trim();
    return value.slice(0, 7);
  }

  function createIssue(rowNumber, level, message) {
    return {
      rowNumber: rowNumber,
      level: level,
      message: message
    };
  }

  function validateJsonOnlyImport(collectionName, formatName) {
    const config = getCollectionConfig(collectionName);
    if (config && config.jsonOnly && formatName !== "json") {
      return "This module supports import only through JSON backup files.";
    }
    return "";
  }

  function validateDailyLogJsonRecord(record, database) {
    const issues = [];
    if (!isValidDateString(record.date)) {
      issues.push("Date is missing or invalid.");
    }
    if (!record.substationId || !getSubstationById(record.substationId, database)) {
      issues.push("Substation reference was not found.");
    }
    asArray(record.events).forEach(function (event) {
      if (EVENT_CODES.indexOf(String(event.type || "").toUpperCase()) === -1) {
        issues.push("Unsupported daily log event type: " + String(event.type || ""));
      }
    });
    return issues;
  }

  function validateBatteryJsonRecord(record, database) {
    const issues = [];
    if (!isValidDateString(record.date)) {
      issues.push("Date is missing or invalid.");
    }
    if (!record.substationId || !getSubstationById(record.substationId, database)) {
      issues.push("Substation reference was not found.");
    }
    asArray(record.cellReadings || record.cells).forEach(function (cell, index) {
      const gravity = String((cell && (cell.specificGravity || cell.gravity)) || "").trim();
      const voltage = String((cell && cell.voltage) || "").trim();
      if (gravity && toNumber(gravity) === null) {
        issues.push("Invalid gravity value at cell " + (index + 1) + ".");
      }
      if (voltage && toNumber(voltage) === null) {
        issues.push("Invalid voltage value at cell " + (index + 1) + ".");
      }
    });
    return issues;
  }

  function validateSubstationJsonRecord(record) {
    const issues = [];
    if (!String(record.name || "").trim()) {
      issues.push("Substation name is required.");
    }
    asArray(record.feeders).forEach(function (feeder, index) {
      if (!String(feeder.feederName || feeder.name || "").trim()) {
        issues.push("Feeder name is missing at feeder row " + (index + 1) + ".");
      }
      if (feeder.ctRatio && !CT_RATIO_PATTERN.test(String(feeder.ctRatio).trim())) {
        issues.push("Invalid CT ratio format for feeder row " + (index + 1) + ".");
      }
      if (String(feeder.mf || "").trim() && toNumber(feeder.mf) === null) {
        issues.push("MF must be numeric for feeder row " + (index + 1) + ".");
      }
    });
    return issues;
  }

  function normalizeJsonModuleRecord(collectionName, rawRecord, database) {
    const normalized = App.storage.normalizeRecord(collectionName, rawRecord, database);
    const issues = [];

    if (collectionName === "substations") {
      issues.push.apply(issues, validateSubstationJsonRecord(normalized));
    } else if (collectionName === "dailyLogs") {
      issues.push.apply(issues, validateDailyLogJsonRecord(normalized, database));
    } else if (collectionName === "batteryRecords") {
      issues.push.apply(issues, validateBatteryJsonRecord(normalized, database));
    } else if (collectionName === "settings") {
      if (!String(normalized.appName || "").trim()) {
        issues.push("Settings record is missing application name.");
      }
    } else if (collectionName === "faults") {
      if (!isValidDateString(normalized.date)) {
        issues.push("Date is missing or invalid.");
      }
      if (EVENT_CODES.indexOf(String(normalized.faultType || "").toUpperCase()) === -1) {
        issues.push("Unsupported event code.");
      }
      if (!isValidTimeString(normalized.startTime) || !isValidTimeString(normalized.endTime)) {
        issues.push("Start time or end time is invalid.");
      }
    } else {
      const config = getCollectionConfig(collectionName);
      if (config && config.dateField && normalized[config.dateField] && !isValidDateString(normalized[config.dateField])) {
        issues.push("Date field is invalid.");
      }
    }

    return {
      record: normalized,
      issues: issues
    };
  }

  function validateTableRow(collectionName, row, database) {
    const issues = [];
    let payload = {};
    const target = String(collectionName || "");
    const substation = findSubstationFromRow(row, database);
    const feeder = substation ? findFeederFromRow(row, substation) : null;

    if (target === "faults") {
      const dateValue = getRowValue(row, ["date"]);
      const startTime = normalizeTime(getRowValue(row, ["start_time", "starttime"]));
      const endTime = normalizeTime(getRowValue(row, ["end_time", "endtime"]));
      const faultType = String(getRowValue(row, ["fault_type", "faulttype", "type"])).toUpperCase();
      if (!isValidDateString(dateValue)) {
        issues.push("Date is invalid.");
      }
      if (!substation) {
        issues.push("Substation was not found.");
      }
      if (!feeder) {
        issues.push("Feeder was not found.");
      }
      if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
        issues.push("Start time or end time is invalid.");
      }
      if (EVENT_CODES.indexOf(faultType) === -1) {
        issues.push("Fault type is invalid.");
      }

      payload = {
        id: getRowValue(row, ["id"]),
        date: dateValue,
        substationId: substation ? substation.id : "",
        substationName: substation ? substation.name : "",
        feederId: feeder ? feeder.id : "",
        feederName: feeder ? App.getFeederLabel(feeder) : getRowValue(row, ["feeder_name", "feedername", "feeder"]),
        startTime: startTime,
        endTime: endTime,
        durationMinutes: calculateDurationMinutes(startTime, endTime),
        faultType: faultType,
        source: String(getRowValue(row, ["source"]) || "MANUAL").toUpperCase(),
        remark: getRowValue(row, ["remark"])
      };
    } else if (target === "maintenanceLogs") {
      const dateValue = getRowValue(row, ["date"]);
      const timeValue = normalizeTime(getRowValue(row, ["time"]));
      const workDetail = getRowValue(row, ["work_detail", "workdetail", "work"]);
      if (!isValidDateString(dateValue)) {
        issues.push("Date is invalid.");
      }
      if (!substation) {
        issues.push("Substation was not found.");
      }
      if (timeValue && !isValidTimeString(timeValue)) {
        issues.push("Time is invalid.");
      }
      if (!workDetail) {
        issues.push("Work detail is required.");
      }

      payload = {
        id: getRowValue(row, ["id"]),
        date: dateValue,
        substationId: substation ? substation.id : "",
        substationName: substation ? substation.name : "",
        time: timeValue,
        workDetail: workDetail,
        remark: getRowValue(row, ["remark"])
      };
    } else if (target === "meterChangeEvents") {
      const effectiveDate = getRowValue(row, ["effective_date", "effectivedate", "date"]);
      const effectiveTime = normalizeTime(getRowValue(row, ["effective_time", "effectivetime", "time"]));
      const oldReading = getRowValue(row, ["old_meter_last_reading", "oldmeterlastreading"]);
      const newReading = getRowValue(row, ["new_meter_start_reading", "newmeterstartreading"]);
      if (!isValidDateString(effectiveDate)) {
        issues.push("Effective date is invalid.");
      }
      if (effectiveTime && !isValidTimeString(effectiveTime)) {
        issues.push("Effective time is invalid.");
      }
      if (!substation) {
        issues.push("Substation was not found.");
      }
      if (!feeder) {
        issues.push("Feeder was not found.");
      }
      if (oldReading && toNumber(oldReading) === null) {
        issues.push("Old meter last reading must be numeric.");
      }
      if (newReading && toNumber(newReading) === null) {
        issues.push("New meter start reading must be numeric.");
      }

      payload = {
        id: getRowValue(row, ["id"]),
        substationId: substation ? substation.id : "",
        feederId: feeder ? feeder.id : "",
        feederName: feeder ? App.getFeederLabel(feeder) : getRowValue(row, ["feeder_name", "feedername", "feeder"]),
        effectiveDate: effectiveDate,
        effectiveTime: effectiveTime,
        oldMeterLastReading: oldReading,
        newMeterStartReading: newReading,
        remark: getRowValue(row, ["remark"])
      };
    } else if (target === "chargeHandoverRecords") {
      const dateValue = getRowValue(row, ["date"]);
      const givenTime = normalizeTime(getRowValue(row, ["charge_given_time", "chargegiventime"]));
      const takenTime = normalizeTime(getRowValue(row, ["charge_taken_time", "chargetakentime"]));
      const dutyStartTime = normalizeTime(getRowValue(row, ["duty_start_time", "dutystarttime"]));
      const dutyEndTime = normalizeTime(getRowValue(row, ["duty_end_time", "dutyendtime"]));

      if (!isValidDateString(dateValue)) {
        issues.push("Date is invalid.");
      }
      if (!substation) {
        issues.push("Substation was not found.");
      }
      [givenTime, takenTime, dutyStartTime, dutyEndTime].forEach(function (timeValue) {
        if (timeValue && !isValidTimeString(timeValue)) {
          issues.push("One or more time fields are invalid.");
        }
      });

      payload = {
        id: getRowValue(row, ["id"]),
        date: dateValue,
        substationId: substation ? substation.id : "",
        substationName: substation ? substation.name : "",
        dutyType: getRowValue(row, ["duty_type", "dutytype"]),
        shiftType: getRowValue(row, ["shift_type", "shifttype"]),
        chargeGivenBy: getRowValue(row, ["charge_given_by", "chargegivenby"]),
        chargeTakenBy: getRowValue(row, ["charge_taken_by", "chargetakenby"]),
        chargeGivenTime: givenTime,
        chargeTakenTime: takenTime,
        dutyStartTime: dutyStartTime,
        dutyEndTime: dutyEndTime,
        generalStatus: getRowValue(row, ["general_status", "generalstatus"]),
        pendingWork: getRowValue(row, ["pending_work", "pendingwork"]),
        faultPending: getRowValue(row, ["fault_pending", "faultpending"]),
        shutdownPending: getRowValue(row, ["shutdown_pending", "shutdownpending"]),
        importantInstructions: getRowValue(row, ["important_instructions", "importantinstructions"]),
        logbookUpdated: getRowValue(row, ["logbook_updated", "logbookupdated"]),
        remark: getRowValue(row, ["remark"])
      };
    } else if (target === "transformerHistory" || target === "vcbHistory" || target === "equipmentChangeHistory" || target === "modificationHistory") {
      const dateFields = target === "transformerHistory" || target === "vcbHistory"
        ? ["manufacturing_date", "manufacturingdate", "installed_date", "installeddate"]
        : ["date"];
      dateFields.forEach(function (field) {
        const value = getRowValue(row, [field]);
        if (value && !isValidDateString(value)) {
          issues.push("One or more date fields are invalid.");
        }
      });
      if (getRowValue(row, ["substation_name", "substationname", "substation"]) && !substation) {
        issues.push("Substation was not found.");
      }
      if ((target === "vcbHistory" || target === "equipmentChangeHistory") && getRowValue(row, ["feeder_name", "feedername", "feeder", "related_feeder", "feeder_id", "feederid"]) && !feeder && substation) {
        issues.push("Feeder was not found.");
      }
      if (target === "vcbHistory") {
        const ctRatio = getRowValue(row, ["ct_ratio", "ctratio"]);
        if (ctRatio && !CT_RATIO_PATTERN.test(ctRatio)) {
          issues.push("CT ratio format must be digits/digits.");
        }
      }

      if (target === "transformerHistory") {
        payload = {
          id: getRowValue(row, ["id"]),
          substationId: substation ? substation.id : "",
          substationName: substation ? substation.name : getRowValue(row, ["substation_name", "substationname", "substation"]),
          transformerName: getRowValue(row, ["transformer_name", "transformername", "transformer"]),
          mvaCapacity: getRowValue(row, ["mva_capacity", "mvacapacity"]),
          voltageRatio: getRowValue(row, ["voltage_ratio", "voltageratio"]),
          serialNumber: getRowValue(row, ["serial_number", "serialnumber"]),
          manufacturerCompany: getRowValue(row, ["manufacturer_company", "manufacturercompany"]),
          manufacturingDate: getRowValue(row, ["manufacturing_date", "manufacturingdate"]),
          installedDate: getRowValue(row, ["installed_date", "installeddate", "commissioned_date", "commissioneddate"]),
          installedByAgency: getRowValue(row, ["installed_by_agency", "installedbyagency"]),
          coolingType: getRowValue(row, ["cooling_type", "coolingtype"]),
          oltcType: getRowValue(row, ["oltc_type", "oltctype"]),
          status: getRowValue(row, ["status"]),
          remark: getRowValue(row, ["remark"])
        };
      } else if (target === "vcbHistory") {
        payload = {
          id: getRowValue(row, ["id"]),
          substationId: substation ? substation.id : "",
          substationName: substation ? substation.name : getRowValue(row, ["substation_name", "substationname", "substation"]),
          feederId: feeder ? feeder.id : "",
          feederName: feeder ? App.getFeederLabel(feeder) : getRowValue(row, ["feeder_name", "feedername", "feeder"]),
          vcbName: getRowValue(row, ["vcb_name", "vcbname", "vcb"]),
          vcbType: getRowValue(row, ["vcb_type", "vcbtype"]),
          manufacturerCompany: getRowValue(row, ["manufacturer_company", "manufacturercompany"]),
          serialNumber: getRowValue(row, ["serial_number", "serialnumber"]),
          manufacturingDate: getRowValue(row, ["manufacturing_date", "manufacturingdate"]),
          installedDate: getRowValue(row, ["installed_date", "installeddate"]),
          installedByAgency: getRowValue(row, ["installed_by_agency", "installedbyagency"]),
          panelName: getRowValue(row, ["panel_name", "panelnumber"]),
          ctRatio: getRowValue(row, ["ct_ratio", "ctratio"]),
          ptRatio: getRowValue(row, ["pt_ratio", "ptratio"]),
          status: getRowValue(row, ["status"]),
          remark: getRowValue(row, ["remark"])
        };
      } else if (target === "equipmentChangeHistory") {
        payload = {
          id: getRowValue(row, ["id"]),
          date: getRowValue(row, ["date"]),
          substationId: substation ? substation.id : "",
          substationName: substation ? substation.name : getRowValue(row, ["substation_name", "substationname", "substation"]),
          equipmentType: getRowValue(row, ["equipment_type", "equipmenttype"]),
          feederId: feeder ? feeder.id : "",
          feederName: feeder ? App.getFeederLabel(feeder) : getRowValue(row, ["related_feeder", "feeder_name", "feedername", "feeder"]),
          equipmentName: getRowValue(row, ["equipment_name", "equipmentname"]),
          oldDetails: getRowValue(row, ["old_details", "olddetails"]),
          newDetails: getRowValue(row, ["new_details", "newdetails"]),
          reasonForChange: getRowValue(row, ["reason_for_change", "reasonforchange"]),
          agency: getRowValue(row, ["agency", "contractor"]),
          approvedBy: getRowValue(row, ["approved_by", "approvedby"]),
          remark: getRowValue(row, ["remark"])
        };
      } else {
        payload = {
          id: getRowValue(row, ["id"]),
          date: getRowValue(row, ["date"]),
          substationId: substation ? substation.id : "",
          substationName: substation ? substation.name : getRowValue(row, ["substation_name", "substationname", "substation"]),
          category: getRowValue(row, ["category"]),
          relatedEquipment: getRowValue(row, ["related_equipment", "relatedequipment"]),
          oldDetails: getRowValue(row, ["old_details", "old_value", "olddetails"]),
          newDetails: getRowValue(row, ["new_details", "new_value", "newdetails"]),
          workDoneBy: getRowValue(row, ["work_done_by", "workdoneby"]),
          agency: getRowValue(row, ["agency"]),
          remark: getRowValue(row, ["remark"])
        };
      }
    } else {
      issues.push("The selected module does not support CSV or Excel XML import. Use JSON backup/import instead.");
    }

    return {
      record: issues.length ? null : App.storage.normalizeRecord(collectionName, payload, database),
      issues: issues
    };
  }

  function extractRowsFromJsonPayload(collectionName, parsedPayload) {
    const target = String(collectionName || "");
    if (target === "full_backup") {
      return parsedPayload;
    }
    if (Array.isArray(parsedPayload)) {
      return parsedPayload;
    }
    if (parsedPayload && parsedPayload.collection === target && Array.isArray(parsedPayload.data)) {
      return parsedPayload.data;
    }
    if (parsedPayload && parsedPayload.backupType && parsedPayload.data && Array.isArray(parsedPayload.data[target])) {
      return parsedPayload.data[target];
    }
    if (parsedPayload && Array.isArray(parsedPayload[target])) {
      return parsedPayload[target];
    }
    if (target === "settings" && parsedPayload && parsedPayload.settings) {
      return [parsedPayload.settings];
    }
    if (target === "settings" && parsedPayload && parsedPayload.appName) {
      return [parsedPayload];
    }
    if (parsedPayload && Array.isArray(parsedPayload.data)) {
      return parsedPayload.data;
    }
    throw new Error("Selected JSON file does not contain rows for the chosen module.");
  }

  function validateFullBackupPayload(parsedPayload) {
    const issues = [];
    let unwrapped;

    try {
      unwrapped = App.storage.unwrapBackupPayload(parsedPayload);
    } catch (error) {
      issues.push(createIssue(0, "error", error.message || "Unsupported backup file structure."));
      return {
        kind: "full_backup",
        valid: false,
        issues: issues,
        summaryCards: [
          { label: "Collections Found", value: "0" },
          { label: "Schema Version", value: "-" },
          { label: "Backup Version", value: "-" },
          { label: "Ready to Restore", value: "No" }
        ],
        collectionRows: [],
        payload: null
      };
    }

    const envelope = unwrapped.envelope || {};
    const currentSchema = App.storage.getSchemaVersion();
    if (envelope.schemaVersion && Number(envelope.schemaVersion) > currentSchema) {
      issues.push(createIssue(0, "error", "Backup schema version is newer than the current application schema."));
    }

    const collectionRows = App.storage.getCollectionNames().map(function (collectionName) {
      const value = collectionName === "settings" ? (unwrapped.data.settings ? 1 : 0) : asArray(unwrapped.data[collectionName]).length;
      return {
        collectionName: collectionName,
        recordCount: String(value)
      };
    });

    return {
      kind: "full_backup",
      valid: !issues.length,
      issues: issues,
      summaryCards: [
        { label: "Collections Found", value: String(collectionRows.filter(function (row) { return Number(row.recordCount) > 0; }).length) },
        { label: "Schema Version", value: String(envelope.schemaVersion || "-") },
        { label: "Backup Version", value: String(envelope.backupFormatVersion || "Legacy") },
        { label: "Ready to Restore", value: issues.length ? "No" : "Yes" }
      ],
      collectionRows: collectionRows,
      payload: unwrapped.data,
      envelope: envelope
    };
  }

  function buildExistingKeyMap(collectionName, database) {
    const records = collectionName === "settings" ? [database.settings] : asArray(database[collectionName]);
    return records.reduce(function (accumulator, record) {
      const key = getDuplicateKey(collectionName, record);
      if (key) {
        accumulator[key] = record;
      }
      return accumulator;
    }, {});
  }

  function validateModuleImport(collectionName, formatName, rows, state) {
    const database = App.storage.getDatabase();
    const config = getCollectionConfig(collectionName);
    const importMonth = getMonthValue(state);
    const issues = [];
    const validRecords = [];
    const seenKeys = {};
    const existingKeys = buildExistingKeyMap(collectionName, database);
    let duplicateCount = 0;
    let warningCount = 0;
    const jsonOnlyError = validateJsonOnlyImport(collectionName, formatName);

    if (jsonOnlyError) {
      issues.push(createIssue(0, "error", jsonOnlyError));
      return {
        kind: "module_import",
        collectionName: collectionName,
        collectionLabel: config ? config.label : collectionName,
        formatName: formatName,
        valid: false,
        validRecords: [],
        issues: issues,
        duplicateCount: 0,
        warningCount: 0,
        totalRows: asArray(rows).length
      };
    }

    asArray(rows).forEach(function (row, index) {
      const rowNumber = index + 2;
      const result = formatName === "json" ? normalizeJsonModuleRecord(collectionName, row, database) : validateTableRow(collectionName, row, database);

      if (result.issues.length) {
        result.issues.forEach(function (message) {
          issues.push(createIssue(rowNumber, "error", message));
        });
        return;
      }

      const record = result.record;
      const duplicateKey = getDuplicateKey(collectionName, record);
      if (duplicateKey && seenKeys[duplicateKey]) {
        duplicateCount += 1;
        warningCount += 1;
        issues.push(createIssue(rowNumber, "warning", "Duplicate row inside import file will be skipped."));
        return;
      }

      if (state.importStrategy === "merge_existing" && duplicateKey && existingKeys[duplicateKey]) {
        duplicateCount += 1;
        warningCount += 1;
        issues.push(createIssue(rowNumber, "warning", "Matching record already exists. Merge will update or skip it safely."));
      }

      if (state.importStrategy === "replace_month") {
        if (!config || !config.dateField) {
          issues.push(createIssue(rowNumber, "error", "Selected module does not support month-based replacement."));
          return;
        }
        if (getRecordMonth(collectionName, record) !== importMonth) {
          issues.push(createIssue(rowNumber, "error", "Row is outside the selected replacement month " + importMonth + "."));
          return;
        }
      }

      if (duplicateKey) {
        seenKeys[duplicateKey] = true;
      }
      validRecords.push(record);
    });

    return {
      kind: "module_import",
      collectionName: collectionName,
      collectionLabel: config ? config.label : collectionName,
      formatName: formatName,
      valid: issues.filter(function (item) { return item.level === "error"; }).length === 0,
      validRecords: validRecords,
      issues: issues,
      duplicateCount: duplicateCount,
      warningCount: warningCount,
      totalRows: asArray(rows).length,
      summaryCards: [
        { label: "Rows Read", value: String(asArray(rows).length) },
        { label: "Validated Rows", value: String(validRecords.length) },
        { label: "Duplicate Rows", value: String(duplicateCount) },
        { label: "Errors", value: String(issues.filter(function (item) { return item.level === "error"; }).length) },
        { label: "Warnings", value: String(warningCount) },
        { label: "Target Module", value: config ? config.label : collectionName }
      ]
    };
  }

  function mergeRecordCollections(collectionName, existingRecords, importedRecords) {
    const nextRecords = asArray(existingRecords).slice();
    const existingById = nextRecords.reduce(function (accumulator, record, index) {
      accumulator[record.id] = index;
      return accumulator;
    }, {});
    const keyToIndex = nextRecords.reduce(function (accumulator, record, index) {
      const key = getDuplicateKey(collectionName, record);
      if (key) {
        accumulator[key] = index;
      }
      return accumulator;
    }, {});

    asArray(importedRecords).forEach(function (record) {
      const key = getDuplicateKey(collectionName, record);
      if (record.id && existingById[record.id] !== undefined) {
        nextRecords[existingById[record.id]] = record;
        if (key) {
          keyToIndex[key] = existingById[record.id];
        }
        return;
      }

      if (key && keyToIndex[key] !== undefined) {
        nextRecords[keyToIndex[key]] = Object.assign({}, nextRecords[keyToIndex[key]], record, {
          id: nextRecords[keyToIndex[key]].id
        });
        return;
      }

      nextRecords.push(record);
      if (record.id) {
        existingById[record.id] = nextRecords.length - 1;
      }
      if (key) {
        keyToIndex[key] = nextRecords.length - 1;
      }
    });

    return nextRecords;
  }

  async function applyModuleImport(preview, state) {
    const target = preview.collectionName;

    if (target === "settings") {
      const nextSettings = preview.validRecords[0] || App.storage.getSettings();
      App.storage.updateSettings(state.importStrategy === "replace_module"
        ? nextSettings
        : Object.assign({}, App.storage.getSettings(), nextSettings, {
          futureSync: Object.assign({}, App.storage.getSettings().futureSync, nextSettings.futureSync || {})
        }));
      return preview.validRecords.length;
    }

    const database = await App.storage.getDatabaseAsync();

    if (state.importStrategy === "replace_module") {
      database[target] = preview.validRecords.slice();
    } else if (state.importStrategy === "replace_month") {
      database[target] = asArray(database[target]).filter(function (record) {
        return getRecordMonth(target, record) !== getMonthValue(state);
      }).concat(preview.validRecords);
    } else {
      database[target] = mergeRecordCollections(target, database[target], preview.validRecords);
    }

    await App.storage.setCollectionAsync(target, database[target], {
      onProgress: state.onProgress
    });
    return preview.validRecords.length;
  }

  async function applyFullBackup(preview, state) {
    if (state.importStrategy === "replace_all") {
      await App.storage.importBackupPackageAsync(preview.payload, {
        onProgress: state.onProgress
      });
      return App.storage.getCollectionNames().length;
    }

    const currentDatabase = await App.storage.getDatabaseAsync();
    const importedDatabase = preview.payload;
    const mergedDatabase = clone(currentDatabase);

    App.storage.getCollectionNames().forEach(function (collectionName) {
      if (collectionName === "settings") {
        mergedDatabase.settings = Object.assign({}, mergedDatabase.settings, importedDatabase.settings || {}, {
          futureSync: Object.assign({}, mergedDatabase.settings.futureSync, importedDatabase.settings && importedDatabase.settings.futureSync)
        });
      } else {
        mergedDatabase[collectionName] = mergeRecordCollections(collectionName, mergedDatabase[collectionName], importedDatabase[collectionName]);
      }
    });

    await App.storage.saveDatabaseAsync(mergedDatabase, {
      collection: "all",
      type: "merge-import",
      onProgress: state.onProgress
    });
    return App.storage.getCollectionNames().length;
  }

  async function exportFullSystemBackup() {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const payload = await App.storage.exportBackupPackageAsync({ source: "data-tools" });
    App.downloadTextFile("msedcl-full-system-backup-" + timestamp + ".json", payload, "application/json;charset=utf-8");
    App.toast("Full system backup exported.");
  }

  async function exportSelectedModuleJson(state) {
    const config = getCollectionConfig(state.exportCollection);
    const records = await getExportCollectionRecordsAsync(state.exportCollection);
    const payload = {
      backupType: "module_collection",
      backupFormatVersion: App.storage.getBackupFormatVersion(),
      schemaVersion: App.storage.getSchemaVersion(),
      generatedAt: new Date().toISOString(),
      collection: state.exportCollection,
      metadata: {
        label: config ? config.label : state.exportCollection,
        recordCount: records.length
      },
      data: records
    };
    App.downloadTextFile(safeFilename((config ? config.label : state.exportCollection) + "-module-backup") + ".json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    App.toast("Selected module JSON backup exported.");
  }

  async function exportSelectedModuleCsv(state) {
    const config = getCollectionConfig(state.exportCollection);
    const records = await getExportCollectionRecordsAsync(state.exportCollection);
    App.downloadTextFile(safeFilename((config ? config.label : state.exportCollection) + "-table-export") + ".csv", buildCsvFromRecords(records), "text/csv;charset=utf-8");
    App.toast("Selected module CSV exported.");
  }

  async function exportReportWorkbook(state) {
    if (!App.reportPackTools) {
      App.toast("Month-end report export tools are not available.", "error");
      return;
    }
    await App.storage.ensureCollections(["substations", "dailyLogs", "meterChangeEvents", "faults", "maintenanceLogs", "batteryRecords"]);
    const sheets = App.reportPackTools.buildMonthEndPackWorkbookSheets({
      month: state.month,
      year: state.year,
      substationId: state.substationId
    });
    const xml = App.reportPackTools.buildSpreadsheetXml("month-end-pack", sheets);
    App.downloadTextFile(safeFilename(["month-end-report-pack", state.year, state.month, state.substationId || "all", "excel-xml"].join("-")) + ".xls", xml, "application/vnd.ms-excel");
    App.toast("Month-end Excel XML workbook exported.");
  }

  async function exportReportJsonPack(state) {
    if (!App.reportPackTools) {
      App.toast("Month-end report export tools are not available.", "error");
      return;
    }
    await App.storage.ensureCollections(["substations", "dailyLogs", "meterChangeEvents", "faults", "maintenanceLogs", "batteryRecords"]);
    const payload = App.reportPackTools.buildMonthEndPackPayload({
      month: state.month,
      year: state.year,
      substationId: state.substationId
    });
    App.downloadTextFile(safeFilename(["month-end-report-pack", state.year, state.month, state.substationId || "all"].join("-")) + ".json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    App.toast("Month-end report JSON pack exported.");
  }

  function buildIssuesRows(issues) {
    return asArray(issues).map(function (issue) {
      return {
        rowNumber: issue.rowNumber > 0 ? String(issue.rowNumber) : "-",
        level: issue.level.toUpperCase(),
        message: issue.message,
        _rowClass: issue.level === "error" ? "report-row-error" : "report-row-warning"
      };
    });
  }

  function renderPreviewResult(preview) {
    if (!preview) {
      return '<div class="empty-state">Choose a file and run dry-run validation to preview import safety, duplicates, and errors before applying changes.</div>';
    }

    const summaryCards = preview.summaryCards || [];
    const issueRows = buildIssuesRows(preview.issues);
    return [
      '<div class="stack">',
      summaryCards.length ? ('<div class="stats-grid">' + summaryCards.map(function (card) {
        return '<article class="stat-card"><h3>' + App.escapeHtml(card.label) + '</h3><strong>' + App.escapeHtml(card.value) + "</strong></article>";
      }).join("") + "</div>") : "",
      (preview.kind === "full_backup"
        ? ('<div class="section-block"><div class="section-title-row"><div><h4>Backup Collections</h4></div></div><div class="table-shell"><table class="compact-table"><thead><tr><th>Collection</th><th>Records</th></tr></thead><tbody>' + asArray(preview.collectionRows).map(function (row) {
          return "<tr><td>" + App.escapeHtml(row.collectionName) + "</td><td>" + App.escapeHtml(row.recordCount) + "</td></tr>";
        }).join("") + "</tbody></table></div></div>")
        : ('<p class="small-status">Validated module: ' + App.escapeHtml(preview.collectionLabel || preview.collectionName || "") + '. Valid rows can now be merged or used to replace selected month/module data.</p>')),
      '<div class="section-block"><div class="section-title-row"><div><h4>Validation Results</h4></div></div><div class="table-shell"><table class="compact-table"><thead><tr><th>Row</th><th>Level</th><th>Message</th></tr></thead><tbody>' +
      (issueRows.length ? issueRows.map(function (row) {
        return '<tr class="' + App.escapeHtml(row._rowClass) + '"><td>' + App.escapeHtml(row.rowNumber) + "</td><td>" + App.escapeHtml(row.level) + "</td><td>" + App.escapeHtml(row.message) + "</td></tr>";
      }).join("") : '<tr><td colspan="3" class="muted-text">No validation issues were found in the dry-run preview.</td></tr>') +
      "</tbody></table></div></div>",
      "</div>"
    ].join("");
  }

  function buildTargetFormatNote(state) {
    if (state.importTarget === "full_backup") {
      return "Full system restore accepts JSON backup files created by this application. Use dry-run validation before applying restore.";
    }
    const config = getCollectionConfig(state.importTarget);
    if (!config) {
      return "Select an import target to see format guidance.";
    }
    return config.jsonOnly
      ? (config.label + " supports JSON import only. CSV / Excel XML table import is not safe for this module structure.")
      : (config.label + " supports JSON, CSV, and Spreadsheet XML import (`.xls` / `.xml`) with dry-run validation.");
  }

  async function validateSelectedFile(state, container) {
    const fileInput = container.querySelector("#data-tools-import-file");
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      throw new Error("Choose a file before running dry-run validation.");
    }

    const file = fileInput.files[0];
    const extension = getFileExtension(file.name);
    const text = await readFileAsText(file);
    let preview;

    if (state.importTarget === "full_backup") {
      if (extension !== "json") {
        throw new Error("Full system restore preview requires a JSON backup file.");
      }
      preview = validateFullBackupPayload(JSON.parse(text));
    } else {
      await App.storage.ensureCollection(state.importTarget);
      let rows;
      if (extension === "json") {
        rows = extractRowsFromJsonPayload(state.importTarget, JSON.parse(text));
      } else if (extension === "csv") {
        rows = parseCsvText(text);
      } else if (extension === "xls" || extension === "xml") {
        rows = parseSpreadsheetXmlText(text);
      } else {
        throw new Error("Unsupported file type. Use JSON, CSV, or Spreadsheet XML files (`.xls` / `.xml`).");
      }
      preview = validateModuleImport(state.importTarget, extension === "json" ? "json" : "table", rows, state);
    }

    preview.fileName = file.name;
    preview.generatedAt = new Date().toISOString();
    return preview;
  }

  async function applyPreviewImport(state) {
    const preview = state.previewResult;
    if (!preview) {
      throw new Error("Run dry-run validation before applying import or restore.");
    }

    const hardErrors = asArray(preview.issues).filter(function (item) {
      return item.level === "error";
    });
    if (preview.kind === "full_backup" && hardErrors.length) {
      throw new Error("Full backup restore is blocked because validation found errors.");
    }
    if (preview.kind === "module_import" && !preview.validRecords.length) {
      throw new Error("No valid records are available to import.");
    }

    const safetyBackup = await App.storage.saveSafetyBackupAsync("Before import / restore", {
      fileName: preview.fileName || "",
      target: preview.collectionName || preview.kind,
      strategy: state.importStrategy
    });
    const appliedCount = preview.kind === "full_backup"
      ? await applyFullBackup(preview, state)
      : await applyModuleImport(preview, state);
    state.applyStatus = "Applied successfully. Safety backup created at " + App.formatDateTime(safetyBackup.createdAt) + ". Count: " + appliedCount + ".";
    return appliedCount;
  }

  function buildLatestSafetyBackupHtml() {
    const latest = App.storage.listSafetyBackups()[0];
    if (!latest) {
      return '<p class="small-status">No safety backup has been created yet in this browser.</p>';
    }
    return '<p class="small-status">Latest safety backup: ' + App.escapeHtml(App.formatDateTime(latest.createdAt)) + ' | ' + App.escapeHtml(latest.reason || "Safety backup") + "</p>";
  }

  function createImportState(options) {
    const today = getTodayParts();
    return {
      importStrategy: String(options && options.importStrategy || "merge_existing"),
      month: String(options && options.month || today.month),
      year: String(options && options.year || today.year),
      previewResult: options && options.previewResult ? options.previewResult : null,
      onProgress: options && typeof options.onProgress === "function" ? options.onProgress : null,
      applyStatus: ""
    };
  }

  async function validateImportFile(options) {
    const file = options && options.file;
    if (!file) {
      throw new Error("Choose a file before running validation.");
    }

    const state = createImportState(options);
    state.importTarget = String(options && options.importTarget || "full_backup");
    const extension = getFileExtension(file.name);
    const text = await readFileAsText(file);
    let preview;

    if (state.importTarget === "full_backup") {
      if (extension !== "json") {
        throw new Error("Full system restore preview requires a JSON backup file.");
      }
      preview = validateFullBackupPayload(JSON.parse(text));
    } else {
      await App.storage.ensureCollection(state.importTarget);
      let rows;
      if (extension === "json") {
        rows = extractRowsFromJsonPayload(state.importTarget, JSON.parse(text));
      } else if (extension === "csv") {
        rows = parseCsvText(text);
      } else if (extension === "xls" || extension === "xml") {
        rows = parseSpreadsheetXmlText(text);
      } else {
        throw new Error("Unsupported file type. Use JSON, CSV, or Spreadsheet XML files (`.xls` / `.xml`).");
      }
      preview = validateModuleImport(state.importTarget, extension === "json" ? "json" : "table", rows, state);
    }

    preview.fileName = file.name;
    preview.generatedAt = new Date().toISOString();
    return preview;
  }

  async function applyImportPreview(preview, options) {
    const state = createImportState(Object.assign({}, options || {}, {
      previewResult: preview
    }));
    return applyPreviewImport(state);
  }

  App.dataTools = {
    validateImportFile: validateImportFile,
    applyImportPreview: applyImportPreview,
    buildTargetFormatNote: function (importTarget) {
      return buildTargetFormatNote({ importTarget: importTarget });
    }
  };

  App.registerModule("datatools", {
    title: "Data Tools",
    subtitle: "Advanced backup, restore, dry-run import validation, report Excel XML workbook export, and rollback tools for local offline data.",
    render: function () {
      const state = getModuleState();
      return [
        '<section class="module-shell">',
        '  <div class="module-grid two-col">',
        '    <div class="card"><div class="card-header"><div><h3>Export Tools</h3><p>Create full JSON backups, month-end Excel XML workbooks, selected module backups, and table-wise CSV exports.</p></div></div><div class="stack">',
        '      <div class="filter-row"><div class="field-group"><label for="data-tools-month">Month</label><select id="data-tools-month">' + Array.from({ length: 12 }, function (_, index) {
          const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const value = String(index + 1).padStart(2, "0");
          return '<option value="' + value + '"' + (value === state.month ? " selected" : "") + ">" + labels[index] + "</option>";
        }).join("") + '</select></div><div class="field-group"><label for="data-tools-year">Year</label><input id="data-tools-year" type="number" min="2020" max="2100" value="' + App.escapeHtml(state.year) + '"></div><div class="field-group"><label for="data-tools-substation">Substation</label><select id="data-tools-substation">' + App.buildSubstationOptions(state.substationId, false) + "</select></div></div>",
        '      <div class="record-item"><strong>Full System Backup (JSON)</strong><span class="muted-text">Includes substations, feeder mappings, daily logs, faults, maintenance, events, battery records, settings, and metadata with backup version number.</span></div>',
        '      <div class="button-row"><button type="button" class="primary-button" id="data-tools-export-full-json">Download Full JSON Backup</button></div>',
        '      <div class="record-item"><strong>Full Report Export (Excel XML Workbook)</strong><span class="muted-text">Exports the month-end report pack workbook as Spreadsheet XML (`.xls`) for the selected month, year, and substation.</span></div>',
        '      <div class="button-row"><button type="button" class="secondary-button" id="data-tools-export-report-workbook">Export Month-End Workbook XML (.xls)</button><button type="button" class="secondary-button" id="data-tools-export-report-json">Export Month-End JSON Pack</button></div>',
        '      <div class="record-item"><strong>Selected Module Backup / CSV Export</strong><span class="muted-text">Choose a module collection for JSON backup or CSV table export. Complex modules keep their structure in JSON.</span></div>',
        '      <div class="filter-row"><div class="field-group"><label for="data-tools-export-collection">Selected Module</label><select id="data-tools-export-collection">' + buildCollectionOptions(state.exportCollection, false) + '</select></div><div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="data-tools-export-module-json">Export Module JSON</button></div><div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="data-tools-export-module-csv">Export Table CSV</button></div></div>',
        "    </div></div>",
        '    <div class="card"><div class="card-header"><div><h3>Import / Restore</h3><p>Validate files first, create an automatic safety backup, then merge or replace data safely with rollback support.</p></div></div><div class="stack">',
        '      <div class="filter-row"><div class="field-group"><label for="data-tools-import-target">Import Target</label><select id="data-tools-import-target">' + buildCollectionOptions(state.importTarget, true) + '</select></div><div class="field-group"><label for="data-tools-import-strategy">Apply Mode</label><select id="data-tools-import-strategy">' + buildStrategyOptions(state) + '</select></div><div class="field-group"><label for="data-tools-import-file">Import File (JSON / CSV / Excel XML)</label><input id="data-tools-import-file" type="file" accept=".json,.csv,.xls,.xml"></div></div>',
        '      <p class="small-status">' + App.escapeHtml(buildTargetFormatNote(state)) + '</p>',
        '      <div class="button-row"><button type="button" class="primary-button" id="data-tools-validate-button">Dry Run Validate</button><button type="button" class="secondary-button" id="data-tools-apply-button">Apply Import / Restore</button><button type="button" class="danger-button" id="data-tools-rollback-button">Rollback Latest Restore</button></div>',
        buildLatestSafetyBackupHtml(),
        (state.applyStatus ? ('<p class="small-status" id="data-tools-apply-status">' + App.escapeHtml(state.applyStatus) + '</p>') : '<p class="small-status" id="data-tools-apply-status"></p>'),
        "    </div></div>",
        "  </div>",
        '  <div class="card"><div class="card-header"><div><h3>Validation Result Area</h3><p>Dry-run preview shows duplicates, row-level validation errors, and readiness before any import changes are applied.</p></div></div>' + renderPreviewResult(state.previewResult) + "</div>",
        "</section>"
      ].join("");
    },
    afterRender: function (container) {
      const state = getModuleState();
      function syncState() {
        const monthInput = container.querySelector("#data-tools-month");
        const yearInput = container.querySelector("#data-tools-year");
        const substationInput = container.querySelector("#data-tools-substation");
        const exportCollectionInput = container.querySelector("#data-tools-export-collection");
        const importTargetInput = container.querySelector("#data-tools-import-target");
        const importStrategyInput = container.querySelector("#data-tools-import-strategy");
        state.month = monthInput ? monthInput.value : state.month;
        state.year = yearInput ? String(yearInput.value || state.year) : state.year;
        state.substationId = substationInput ? substationInput.value : state.substationId;
        state.exportCollection = exportCollectionInput ? exportCollectionInput.value : state.exportCollection;
        state.importTarget = importTargetInput ? importTargetInput.value : state.importTarget;
        state.importStrategy = importStrategyInput ? importStrategyInput.value : state.importStrategy;
      }

      ["#data-tools-month", "#data-tools-year", "#data-tools-substation", "#data-tools-export-collection", "#data-tools-import-target", "#data-tools-import-strategy"].forEach(function (selector) {
        const input = container.querySelector(selector);
        if (input) {
          input.addEventListener("change", function () {
            syncState();
            state.previewResult = null;
            state.applyStatus = "";
            App.renderCurrentRoute();
          });
        }
      });

      [["#data-tools-export-full-json", exportFullSystemBackup], ["#data-tools-export-report-workbook", function () { exportReportWorkbook(state); }], ["#data-tools-export-report-json", function () { exportReportJsonPack(state); }], ["#data-tools-export-module-json", function () { exportSelectedModuleJson(state); }], ["#data-tools-export-module-csv", function () { exportSelectedModuleCsv(state); }]].forEach(function (binding) {
        const button = container.querySelector(binding[0]);
        if (button) {
          button.addEventListener("click", function () {
            syncState();
            Promise.resolve(binding[1]()).catch(function (error) {
              state.applyStatus = error && error.message ? error.message : "Export failed.";
              App.toast(state.applyStatus, "error");
              App.renderCurrentRoute();
            });
          });
        }
      });

      const validateButton = container.querySelector("#data-tools-validate-button");
      if (validateButton) {
        validateButton.addEventListener("click", function () {
          syncState();
          validateSelectedFile(state, container).then(function (preview) {
            state.previewResult = preview;
            state.applyStatus = "Dry-run validation completed for " + (preview.fileName || "selected file") + ".";
            App.toast("Dry-run validation completed.", preview.valid ? "success" : "warning");
            App.renderCurrentRoute();
          }).catch(function (error) {
            state.previewResult = null;
            state.applyStatus = error && error.message ? error.message : "Validation failed.";
            App.toast(state.applyStatus, "error");
            App.renderCurrentRoute();
          });
        });
      }

      const applyButton = container.querySelector("#data-tools-apply-button");
      if (applyButton) {
        applyButton.addEventListener("click", function () {
          syncState();
          const statusTarget = container.querySelector("#data-tools-apply-status");
          state.applyStatus = "Applying import / restore...";
          if (statusTarget) {
            statusTarget.textContent = state.applyStatus;
          }
          applyPreviewImport(Object.assign({}, state, {
            onProgress: function (progress) {
              const processed = Number(progress && progress.processed || 0);
              const total = Number(progress && progress.total || 0);
              const collectionIndex = Number(progress && progress.collectionIndex || 0);
              const totalCollections = Number(progress && progress.totalCollections || 0);
              state.applyStatus = "Applying " + (progress && progress.collectionName ? progress.collectionName : "data") +
                " (" + processed + "/" + total + ")" +
                (totalCollections ? (" | Collection " + collectionIndex + "/" + totalCollections) : "");
              if (statusTarget) {
                statusTarget.textContent = state.applyStatus;
              }
            }
          })).then(function (count) {
            App.toast("Import / restore applied successfully. Count: " + count + ".", "success");
            state.previewResult = null;
            App.renderCurrentRoute();
          }).catch(function (error) {
            state.applyStatus = error && error.message ? error.message : "Import / restore failed.";
            App.toast(state.applyStatus, "error");
            App.renderCurrentRoute();
          });
        });
      }

      const rollbackButton = container.querySelector("#data-tools-rollback-button");
      if (rollbackButton) {
        rollbackButton.addEventListener("click", function () {
          const latest = App.storage.listSafetyBackups()[0];
          if (!latest) {
            App.toast("No safety backup is available for rollback.", "warning");
            return;
          }
          if (!global.confirm("Rollback using the latest safety backup from " + App.formatDateTime(latest.createdAt) + "?")) {
            return;
          }
          App.storage.rollbackSafetyBackupAsync(latest.id).then(function () {
            state.previewResult = null;
            state.applyStatus = "Rolled back using safety backup created at " + App.formatDateTime(latest.createdAt) + ".";
            App.toast("Rollback completed.", "warning");
            App.renderCurrentRoute();
          }).catch(function (error) {
            state.applyStatus = error && error.message ? error.message : "Rollback failed.";
            App.toast(state.applyStatus, "error");
            App.renderCurrentRoute();
          });
        });
      }
    }
  });
})(window);
