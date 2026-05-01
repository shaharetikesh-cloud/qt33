(function (global) {
  const App = global.SubstationRegisterApp;

  const BATTERY_CELL_COUNT = 15;
  const CHECKLIST_OPTIONS = [
    { key: "terminal_cleaned", label: "Battery terminal cleaned" },
    { key: "contact_tightened", label: "Battery save contact tightened" },
    { key: "gravity_checked", label: "Battery cell gravity checked" },
    { key: "voltage_checked", label: "Battery cell per cell voltage checked" },
    { key: "charger_cleaned", label: "Charger cleaned" },
    { key: "wiring_inspected", label: "Wiring inspected" }
  ];
  const CONDITION_THRESHOLDS = {
    gravity: {
      goodMin: 1.22,
      averageMin: 1.18
    },
    voltage: {
      goodMin: 2.10,
      averageMin: 2.00
    }
  };

  function getModuleState() {
    return App.getModuleState("battery", {
      substationId: "",
      date: App.getTodayValue(),
      batterySetName: "Battery 1",
      activeRecord: null,
      saveTimer: null
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

  function isBlankValue(value) {
    return value === "" || value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  }

  function parseLocalDate(dateValue) {
    const parts = String(dateValue || "").split("-");
    if (parts.length !== 3) {
      return null;
    }

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }

    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatShortDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short"
    }).format(date);
  }

  function getWeekDetails(dateValue) {
    const date = parseLocalDate(dateValue);
    if (!date) {
      return {
        weekKey: "",
        weekLabel: ""
      };
    }

    const monday = new Date(date);
    const dayIndex = (date.getDay() + 6) % 7;
    monday.setDate(date.getDate() - dayIndex);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const thursday = new Date(monday);
    thursday.setDate(monday.getDate() + 3);

    const firstThursday = new Date(thursday.getFullYear(), 0, 4);
    const firstDayIndex = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstDayIndex + 3);

    const weekNumber = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
    return {
      weekKey: String(thursday.getFullYear()) + "-W" + String(weekNumber).padStart(2, "0"),
      weekLabel: "Week " + weekNumber + " (" + formatShortDate(monday) + " - " + formatShortDate(sunday) + ")"
    };
  }

  function getBatterySetCount(substation) {
    const count = Number(substation && substation.batterySetCount);
    if (!Number.isFinite(count) || count < 1) {
      return 1;
    }
    return Math.max(1, Math.min(3, Math.round(count)));
  }

  function getBatterySetOptions(substation) {
    return Array.from({ length: getBatterySetCount(substation) }, function (_, index) {
      return "Battery " + (index + 1);
    });
  }

  function normalizeBatterySetName(substation, value) {
    const options = getBatterySetOptions(substation);
    const nextValue = String(value || "").trim();
    if (options.indexOf(nextValue) >= 0) {
      return nextValue;
    }
    return options[0] || "Battery 1";
  }

  function buildSubstationSnapshot(substation) {
    if (!substation) {
      return null;
    }

    return {
      name: substation.name,
      division: substation.division,
      circle: substation.circle,
      location: substation.location,
      voltageLevel: substation.voltageLevel
    };
  }

  function buildBlankCellReadings() {
    return Array.from({ length: BATTERY_CELL_COUNT }, function (_, index) {
      return {
        srNo: index + 1,
        serialNo: index + 1,
        specificGravity: "",
        voltage: "",
        remark: ""
      };
    });
  }

  function parseDecimal(value, maxFractionDigits) {
    const text = stringValue(value).trim();
    if (!text) {
      return null;
    }

    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return typeof maxFractionDigits === "number" ? Number(parsed.toFixed(maxFractionDigits)) : parsed;
  }

  function formatMetric(value, digits) {
    return value === "" || value === null || value === undefined ? "" : Number(value).toFixed(digits);
  }

  function getConditionLevel(ruleName, value) {
    if (!Number.isFinite(value)) {
      return "";
    }

    const rule = CONDITION_THRESHOLDS[ruleName];
    if (!rule) {
      return "";
    }

    if (value >= rule.goodMin) {
      return "Good";
    }
    if (value >= rule.averageMin) {
      return "Average";
    }
    return "Low";
  }

  function getOverallCondition(gravityCondition, voltageCondition) {
    if (!gravityCondition && !voltageCondition) {
      return "";
    }
    if (gravityCondition === "Low" || voltageCondition === "Low") {
      return "Low / Needs Attention";
    }
    if (gravityCondition === "Good" && voltageCondition === "Good") {
      return "Good";
    }
    return "Average";
  }

  function getConditionClass(condition) {
    const normalized = String(condition || "").toLowerCase();
    if (normalized.indexOf("low") >= 0) {
      return "is-low";
    }
    if (normalized.indexOf("average") >= 0) {
      return "is-average";
    }
    if (normalized.indexOf("good") >= 0) {
      return "is-good";
    }
    return "";
  }

  function getChecklistLabels(checkKeys) {
    const selectedMap = asArray(checkKeys).reduce(function (accumulator, key) {
      accumulator[key] = true;
      return accumulator;
    }, {});

    return CHECKLIST_OPTIONS.filter(function (option) {
      return Boolean(selectedMap[option.key]);
    }).map(function (option) {
      return option.label;
    });
  }

  function buildGeneratedRemarkText(remarkChecks, legacyRemarkText) {
    const labels = getChecklistLabels(remarkChecks);
    const parts = [];

    if (labels.length) {
      parts.push(labels.join("; "));
    }
    if (String(legacyRemarkText || "").trim()) {
      parts.push(String(legacyRemarkText).trim());
    }

    return parts.join(". ").trim();
  }

  function getLegacyRemarkText(record, cellReadings) {
    const directRemark = String(record && (record.legacyRemarkText || record.generatedRemarkText || record.remarkText || record.remark) || "").trim();
    const rowRemarkText = asArray(cellReadings).map(function (cell) {
      return String(cell && cell.remark || "").trim();
    }).filter(Boolean).join("; ");

    if (directRemark && rowRemarkText && rowRemarkText !== directRemark) {
      return directRemark + "; " + rowRemarkText;
    }
    return directRemark || rowRemarkText;
  }

  function buildCellCondition(cell) {
    const gravityCondition = getConditionLevel("gravity", parseDecimal(cell && cell.specificGravity, 3));
    const voltageCondition = getConditionLevel("voltage", parseDecimal(cell && cell.voltage, 2));
    return getOverallCondition(gravityCondition, voltageCondition);
  }

  function calculateMetrics(record) {
    const gravityValues = [];
    const voltageValues = [];

    asArray(record && record.cellReadings).forEach(function (cell) {
      const gravity = parseDecimal(cell.specificGravity, 3);
      const voltage = parseDecimal(cell.voltage, 2);
      if (gravity !== null) {
        gravityValues.push(gravity);
      }
      if (voltage !== null) {
        voltageValues.push(voltage);
      }
    });

    const gravityMin = gravityValues.length ? Number(Math.min.apply(null, gravityValues).toFixed(3)) : "";
    const gravityMax = gravityValues.length ? Number(Math.max.apply(null, gravityValues).toFixed(3)) : "";
    const voltageMin = voltageValues.length ? Number(Math.min.apply(null, voltageValues).toFixed(2)) : "";
    const voltageMax = voltageValues.length ? Number(Math.max.apply(null, voltageValues).toFixed(2)) : "";
    const totalVoltage = voltageValues.length ? Number(voltageValues.reduce(function (sum, value) {
      return sum + value;
    }, 0).toFixed(2)) : "";
    const gravityCondition = gravityValues.length ? getConditionLevel("gravity", gravityMin) : "";
    const voltageCondition = voltageValues.length ? getConditionLevel("voltage", voltageMin) : "";
    const overallBatteryCondition = getOverallCondition(gravityCondition, voltageCondition);

    return {
      gravityMin: gravityMin,
      gravityMax: gravityMax,
      voltageMin: voltageMin,
      voltageMax: voltageMax,
      totalVoltage: totalVoltage,
      gravityCondition: gravityCondition,
      voltageCondition: voltageCondition,
      overallBatteryCondition: overallBatteryCondition,
      condition: overallBatteryCondition
    };
  }

  function createBlankRecord(substation, date, batterySetName) {
    const weekDetails = getWeekDetails(date);
    const baseRecord = {
      id: "",
      substationId: substation ? substation.id : "",
      substationName: substation ? substation.name : "",
      date: date,
      day: App.getDayName(date),
      weekKey: weekDetails.weekKey,
      weekLabel: weekDetails.weekLabel,
      batterySetName: normalizeBatterySetName(substation, batterySetName),
      cellReadings: buildBlankCellReadings(),
      remarkChecks: [],
      generatedRemarkText: "",
      legacyRemarkText: "",
      gravityMax: "",
      gravityMin: "",
      voltageMax: "",
      voltageMin: "",
      totalVoltage: "",
      gravityCondition: "",
      voltageCondition: "",
      overallBatteryCondition: "",
      condition: "",
      operatorName: "",
      inchargeName: "",
      substationSnapshot: buildSubstationSnapshot(substation)
    };

    return Object.assign(baseRecord, calculateMetrics(baseRecord));
  }

  function normalizeRecord(record, substation, date, batterySetName) {
    if (!record) {
      return createBlankRecord(substation, date, batterySetName);
    }

    const sourceCells = asArray(record.cellReadings).length ? record.cellReadings : record.cells;
    const cellReadings = Array.from({ length: BATTERY_CELL_COUNT }, function (_, index) {
      const existing = Array.isArray(sourceCells) ? sourceCells[index] : null;
      return {
        srNo: index + 1,
        serialNo: index + 1,
        specificGravity: existing ? stringValue(existing.specificGravity !== undefined ? existing.specificGravity : existing.gravity).trim() : "",
        voltage: existing ? stringValue(existing.voltage).trim() : "",
        remark: existing ? stringValue(existing.remark).trim() : ""
      };
    });
    const weekDetails = getWeekDetails(record.date || date);
    const legacyRemarkText = getLegacyRemarkText(record, cellReadings);
    const remarkChecks = asArray(record.remarkChecks).map(function (item) {
      return String(item || "").trim();
    }).filter(function (item, index, rows) {
      return item && rows.indexOf(item) === index;
    });
    const normalized = {
      id: record.id || "",
      substationId: record.substationId || (substation ? substation.id : ""),
      substationName: record.substationName || (substation ? substation.name : ""),
      date: record.date || date,
      day: record.day || App.getDayName(record.date || date),
      weekKey: record.weekKey || weekDetails.weekKey,
      weekLabel: record.weekLabel || weekDetails.weekLabel,
      batterySetName: normalizeBatterySetName(substation, record.batterySetName || batterySetName),
      cellReadings: cellReadings,
      cells: cellReadings.map(function (cell) {
        return clone(cell);
      }),
      remarkChecks: remarkChecks,
      generatedRemarkText: stringValue(record.generatedRemarkText).trim(),
      legacyRemarkText: legacyRemarkText,
      gravityMax: record.gravityMax === undefined ? "" : record.gravityMax,
      gravityMin: record.gravityMin === undefined ? "" : record.gravityMin,
      voltageMax: record.voltageMax === undefined ? "" : record.voltageMax,
      voltageMin: record.voltageMin === undefined ? "" : record.voltageMin,
      totalVoltage: record.totalVoltage === undefined ? "" : record.totalVoltage,
      gravityCondition: stringValue(record.gravityCondition).trim(),
      voltageCondition: stringValue(record.voltageCondition).trim(),
      overallBatteryCondition: stringValue(record.overallBatteryCondition || record.condition).trim(),
      condition: stringValue(record.condition || record.overallBatteryCondition).trim(),
      operatorName: stringValue(record.operatorName).trim(),
      inchargeName: stringValue(record.inchargeName).trim(),
      substationSnapshot: record.substationSnapshot || buildSubstationSnapshot(substation)
    };

    return Object.assign(normalized, calculateMetrics(normalized), {
      generatedRemarkText: buildGeneratedRemarkText(remarkChecks, legacyRemarkText)
    });
  }

  function getMatchingRecord(substationId, date, batterySetName) {
    return App.storage.getCollection("batteryRecords").find(function (item) {
      return item.substationId === substationId &&
        item.date === date &&
        String(item.batterySetName || "Battery 1") === String(batterySetName || "Battery 1");
    }) || null;
  }

  function sortRecords(records) {
    return asArray(records).slice().sort(function (left, right) {
      const dateDiff = new Date(right.date || "").getTime() - new Date(left.date || "").getTime();
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return String(left.batterySetName || "").localeCompare(String(right.batterySetName || ""));
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
    state.batterySetName = normalizeBatterySetName(substation, state.batterySetName);
    state.activeRecord = normalizeRecord(getMatchingRecord(state.substationId, state.date, state.batterySetName), substation, state.date, state.batterySetName);
    return state;
  }

  function refreshCalculatedFields(record, substation) {
    const weekDetails = getWeekDetails(record.date);
    const metrics = calculateMetrics(record);
    record.substationId = record.substationId || (substation ? substation.id : "");
    record.substationName = record.substationName || (substation ? substation.name : "");
    record.day = App.getDayName(record.date);
    record.weekKey = weekDetails.weekKey;
    record.weekLabel = weekDetails.weekLabel;
    record.substationSnapshot = record.substationSnapshot || buildSubstationSnapshot(substation);
    record.generatedRemarkText = buildGeneratedRemarkText(record.remarkChecks, record.legacyRemarkText);
    record.cells = asArray(record.cellReadings).map(function (cell) {
      return clone(cell);
    });
    Object.assign(record, metrics);
  }

  function updateConditionElement(element, condition) {
    if (!element) {
      return;
    }

    element.textContent = condition || "";
    element.classList.remove("is-good", "is-average", "is-low");
    const nextClass = getConditionClass(condition);
    if (nextClass) {
      element.classList.add(nextClass);
    }
  }

  function updateStatsInDom(container, record) {
    [
      { selector: "#battery-gravity-max", value: formatMetric(record.gravityMax, 3) },
      { selector: "#battery-gravity-min", value: formatMetric(record.gravityMin, 3) },
      { selector: "#battery-voltage-max", value: formatMetric(record.voltageMax, 2) },
      { selector: "#battery-voltage-min", value: formatMetric(record.voltageMin, 2) },
      { selector: "#battery-total-voltage", value: formatMetric(record.totalVoltage, 2) },
      { selector: "#battery-generated-remark", value: record.generatedRemarkText || "-" },
      { selector: "#battery-day-display", value: record.day || "" },
      { selector: "#battery-week-label-display", value: record.weekLabel || "" }
    ].forEach(function (item) {
      const target = container.querySelector(item.selector);
      if (target) {
        target.textContent = item.value;
      }
    });

    updateConditionElement(container.querySelector("#battery-gravity-condition"), record.gravityCondition);
    updateConditionElement(container.querySelector("#battery-voltage-condition"), record.voltageCondition);
    updateConditionElement(container.querySelector("#battery-overall-condition"), record.overallBatteryCondition);

    asArray(record.cellReadings).forEach(function (cell, index) {
      updateConditionElement(container.querySelector('[data-cell-condition-index="' + index + '"]'), buildCellCondition(cell));
    });
  }

  function updateSaveStatus(container, message, type) {
    const target = container.querySelector("#battery-save-status");
    if (!target) {
      return;
    }

    target.textContent = message;
    target.className = "status-inline" + (type ? " " + type : "");
  }

  function persistRecord(container, silent) {
    const state = getModuleState();
    if (!state.activeRecord || !state.substationId || !state.date) {
      return false;
    }

    if (state.saveTimer) {
      global.clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }

    const substation = App.findSubstation(state.substationId);
    refreshCalculatedFields(state.activeRecord, substation);
    state.activeRecord.substationId = state.substationId;
    state.activeRecord.substationName = substation ? substation.name : state.activeRecord.substationName;
    state.activeRecord.date = state.date;
    state.activeRecord.day = App.getDayName(state.date);
    state.activeRecord.batterySetName = normalizeBatterySetName(substation, state.batterySetName);
    state.activeRecord.substationSnapshot = buildSubstationSnapshot(substation);

    const existing = getMatchingRecord(state.substationId, state.date, state.activeRecord.batterySetName);
    if (existing && existing.id && existing.id !== state.activeRecord.id) {
      state.activeRecord.id = existing.id;
      state.activeRecord.createdAt = existing.createdAt || state.activeRecord.createdAt;
    }

    state.activeRecord = App.storage.upsert("batteryRecords", state.activeRecord, "battery");
    state.batterySetName = state.activeRecord.batterySetName;
    updateSaveStatus(container, "Saved locally at " + App.formatDateTime(state.activeRecord.updatedAt), "");
    if (!silent) {
      App.toast("Weekly battery maintenance record saved locally.");
    }
    return true;
  }

  function scheduleSave(container) {
    const state = getModuleState();
    if (state.saveTimer) {
      global.clearTimeout(state.saveTimer);
    }

    updateSaveStatus(container, "Saving locally...", "warning");
    state.saveTimer = global.setTimeout(function () {
      persistRecord(container, true);
    }, 450);
  }

  function buildSetOptionsHtml(substation, selectedValue) {
    return getBatterySetOptions(substation).map(function (option) {
      return '<option value="' + App.escapeHtml(option) + '"' + (option === selectedValue ? " selected" : "") + ">" + App.escapeHtml(option) + "</option>";
    }).join("");
  }

  function buildChecklistHtml(record, readOnly) {
    const selectedMap = asArray(record.remarkChecks).reduce(function (accumulator, key) {
      accumulator[key] = true;
      return accumulator;
    }, {});

    return [
      '<div class="battery-checklist' + (readOnly ? " readonly" : "") + '">',
      CHECKLIST_OPTIONS.map(function (option) {
        const checked = Boolean(selectedMap[option.key]);

        if (readOnly) {
          return '<div class="battery-check-item' + (checked ? " checked" : "") + '">' +
            '<span class="battery-check-mark">' + (checked ? "Yes" : "") + "</span>" +
            '<span>' + App.escapeHtml(option.label) + "</span>" +
          "</div>";
        }

        return '<label class="battery-check-item' + (checked ? " checked" : "") + '">' +
          '<input type="checkbox" data-remark-check="' + App.escapeHtml(option.key) + '"' + (checked ? " checked" : "") + ">" +
          '<span>' + App.escapeHtml(option.label) + "</span>" +
        "</label>";
      }).join(""),
      "</div>"
    ].join("");
  }

  function buildConditionBadge(condition, extraClass, elementId) {
    return '<span' + (elementId ? ' id="' + App.escapeHtml(elementId) + '"' : "") + ' class="battery-condition-pill ' + App.escapeHtml([extraClass || "", getConditionClass(condition)].filter(Boolean).join(" ")) + '">' + App.escapeHtml(condition || "-") + "</span>";
  }

  function buildActionPanelHtml(record) {
    return [
      '<div class="battery-action-panel no-print">',
      '  <button type="button" class="primary-button" id="battery-primary-save-button">' + App.escapeHtml(record.id ? "Update" : "Save") + "</button>",
      '  <button type="button" class="secondary-button" id="battery-update-button">Update</button>',
      '  <button type="button" class="secondary-button" id="battery-clear-button">Clear</button>',
      '  <button type="button" class="secondary-button" id="battery-print-button">Print This Report</button>',
      '  <button type="button" class="secondary-button" id="battery-print-two-button">Print 2 Reports Per Page</button>',
      "</div>"
    ].join("");
  }

  function buildSheetHtml(record, substation, readOnly, options) {
    const config = options || {};
    const settings = App.storage.getSettings();
    const snapshot = record.substationSnapshot || buildSubstationSnapshot(substation) || {};

    function textValue(value) {
      return App.escapeHtml(value || "");
    }

    function cellInput(index, fieldName, value, step) {
      if (readOnly) {
        return textValue(value);
      }

      return '<input type="number" inputmode="decimal" step="' + App.escapeHtml(step || "0.01") + '" value="' + textValue(value) + '" data-cell-index="' + index + '" data-field-name="' + App.escapeHtml(fieldName) + '">';
    }

    return [
      '<div class="battery-sheet' + (config.compact ? " compact-print" : "") + '">',
      '  <div class="battery-sheet-header">',
      "    <h2>" + textValue(settings.companyName) + "</h2>",
      "    <h3>Weekly Battery Maintenance Record</h3>",
      "  </div>",
      '  <div class="battery-meta-grid">',
      '    <div class="field-inline"><label>Division</label><strong>' + textValue(snapshot.division || "-") + "</strong></div>",
      '    <div class="field-inline"><label>Substation</label><strong>' + textValue(snapshot.name || "-") + "</strong></div>",
      '    <div class="field-inline"><label>Battery Set</label><strong>' + textValue(record.batterySetName || "Battery 1") + "</strong></div>",
      '    <div class="field-inline"><label>Date</label><strong>' + textValue(App.formatDate(record.date)) + "</strong></div>",
      '    <div class="field-inline"><label>Day</label><strong id="battery-day-display">' + textValue(record.day) + "</strong></div>",
      '    <div class="field-inline"><label>Week Label</label><strong id="battery-week-label-display">' + textValue(record.weekLabel) + "</strong></div>",
      "  </div>",
      '  <div class="battery-register-grid">',
      '    <div class="battery-table-shell">',
      '      <table class="battery-register-table">',
      "        <thead><tr><th>Sr No</th><th>Per Cell S.P. Gravity</th><th>Per Cell Voltage</th><th>Cell Condition</th></tr></thead>",
      "        <tbody>",
      asArray(record.cellReadings).map(function (cell, index) {
        return "<tr>" +
          "<td>" + cell.srNo + "</td>" +
          "<td>" + cellInput(index, "specificGravity", cell.specificGravity, "0.001") + "</td>" +
          "<td>" + cellInput(index, "voltage", cell.voltage, "0.01") + "</td>" +
          '<td><span class="battery-cell-condition ' + App.escapeHtml(getConditionClass(buildCellCondition(cell))) + '" data-cell-condition-index="' + index + '">' + App.escapeHtml(buildCellCondition(cell) || "-") + "</span></td>" +
        "</tr>";
      }).join(""),
      '          <tr class="battery-total-row"><th colspan="3">Total Voltage</th><td id="battery-total-voltage">' + textValue(formatMetric(record.totalVoltage, 2)) + "</td></tr>",
      "        </tbody>",
      "      </table>",
      "    </div>",
      '    <div class="battery-right-panel">',
      '      <div class="battery-side-card">',
      "        <h4>Weekly Maintenance Checklist</h4>",
      buildChecklistHtml(record, readOnly),
      "      </div>",
      '      <div class="battery-side-card">',
      "        <h4>Generated Remark</h4>",
      '        <div id="battery-generated-remark" class="battery-generated-remark">' + textValue(record.generatedRemarkText || "-") + "</div>",
      "      </div>",
      '      <div class="battery-side-card">',
      "        <h4>Battery Summary</h4>",
      '        <table class="battery-summary-table">',
      "          <thead><tr><th>Battery Parameter</th><th>Maximum</th><th>Minimum</th><th>Condition</th></tr></thead>",
      "          <tbody>",
      "            <tr>",
      "              <th>S.P. Gravity</th>",
      '              <td id="battery-gravity-max">' + textValue(formatMetric(record.gravityMax, 3)) + "</td>",
      '              <td id="battery-gravity-min">' + textValue(formatMetric(record.gravityMin, 3)) + "</td>",
      '              <td>' + buildConditionBadge(record.gravityCondition, "battery-parameter-condition", "battery-gravity-condition") + "</td>",
      "            </tr>",
      "            <tr>",
      "              <th>Voltage</th>",
      '              <td id="battery-voltage-max">' + textValue(formatMetric(record.voltageMax, 2)) + "</td>",
      '              <td id="battery-voltage-min">' + textValue(formatMetric(record.voltageMin, 2)) + "</td>",
      '              <td>' + buildConditionBadge(record.voltageCondition, "battery-parameter-condition", "battery-voltage-condition") + "</td>",
      "            </tr>",
      "          </tbody>",
      "        </table>",
      '        <div class="battery-summary-metrics">',
      '          <div class="field-inline"><label>Total Voltage</label><strong>' + textValue(formatMetric(record.totalVoltage, 2)) + "</strong></div>",
      '          <div class="field-inline"><label>Overall Battery Condition</label><div>' + buildConditionBadge(record.overallBatteryCondition, "battery-overall-condition", "battery-overall-condition") + "</div></div>",
      "        </div>",
      "      </div>",
      readOnly ? "" : buildActionPanelHtml(record),
      "    </div>",
      "  </div>",
      '  <div class="battery-signatures">',
      '    <div class="signature-block"><strong>Operator</strong>' + (readOnly ? '<div class="signature-line">' + textValue(record.operatorName) + "</div>" : '<div class="signature-line"><input id="battery-operator" type="text" value="' + textValue(record.operatorName) + '"></div>') + "</div>",
      '    <div class="signature-block"><strong>In Charge</strong>' + (readOnly ? '<div class="signature-line">' + textValue(record.inchargeName) + "</div>" : '<div class="signature-line"><input id="battery-incharge" type="text" value="' + textValue(record.inchargeName) + '"></div>') + "</div>",
      "  </div>",
      "</div>"
    ].join("");
  }

  function buildHistoryTableHtml(records, activeRecordId) {
    if (!records.length) {
      return '<div class="empty-state">No weekly battery maintenance records saved for the selected substation yet.</div>';
    }

    return [
      '<div class="table-shell">',
      '  <table class="compact-table battery-history-table">',
      "    <thead><tr><th>Date</th><th>Week Label</th><th>Battery Set</th><th>Total Voltage</th><th>Condition</th><th>Updated</th><th>Actions</th></tr></thead>",
      "    <tbody>",
      records.map(function (record) {
        return '<tr' + (record.id === activeRecordId ? ' class="battery-history-active-row"' : "") + ">" +
          "<td>" + App.escapeHtml(App.formatDate(record.date)) + "</td>" +
          "<td>" + App.escapeHtml(record.weekLabel || "-") + "</td>" +
          "<td>" + App.escapeHtml(record.batterySetName || "Battery 1") + "</td>" +
          "<td>" + App.escapeHtml(formatMetric(record.totalVoltage, 2) || "-") + "</td>" +
          "<td>" + App.escapeHtml(record.overallBatteryCondition || record.condition || "-") + "</td>" +
          "<td>" + App.escapeHtml(App.formatDateTime(record.updatedAt || record.createdAt)) + "</td>" +
          '<td><div class="table-actions"><button type="button" class="secondary-button" data-action="edit-battery-record" data-id="' + App.escapeHtml(record.id) + '">Edit</button><button type="button" class="secondary-button" data-action="print-battery-record" data-id="' + App.escapeHtml(record.id) + '">Print</button><button type="button" class="danger-button" data-action="delete-battery-record" data-id="' + App.escapeHtml(record.id) + '">Delete</button></div></td>' +
        "</tr>";
      }).join(""),
      "    </tbody>",
      "  </table>",
      "</div>"
    ].join("");
  }

  function getHistoryRecords(state) {
    return sortRecords(App.storage.getCollection("batteryRecords").filter(function (record) {
      return !state.substationId || record.substationId === state.substationId;
    }));
  }

  function normalizeForPrint(record) {
    const substation = App.findSubstation(record.substationId);
    return normalizeRecord(record, substation, record.date || App.getTodayValue(), record.batterySetName || "Battery 1");
  }

  function buildPrintHtml(record) {
    return [
      '<section class="module-shell battery-print-wrapper">',
      buildSheetHtml(normalizeForPrint(record), App.findSubstation(record.substationId), true),
      "</section>"
    ].join("");
  }

  function buildTwoPerPagePrintHtml(records) {
    const printableRecords = sortRecords(records).map(normalizeForPrint);
    const pages = [];
    let index;

    for (index = 0; index < printableRecords.length; index += 2) {
      pages.push(printableRecords.slice(index, index + 2));
    }

    return [
      '<section class="module-shell battery-batch-print-wrapper">',
      pages.map(function (pageRecords) {
        return '  <div class="battery-print-page">' +
          pageRecords.map(function (record) {
            return '<div class="battery-print-block">' + buildSheetHtml(record, App.findSubstation(record.substationId), true, { compact: true }) + "</div>";
          }).join("") +
        "  </div>";
      }).join(""),
      "</section>"
    ].join("");
  }

  function getTwoPerPageRecords(currentRecord) {
    const baseRecord = normalizeForPrint(currentRecord);
    const extras = sortRecords(App.storage.getCollection("batteryRecords").filter(function (record) {
      return record.substationId === baseRecord.substationId &&
        String(record.batterySetName || "Battery 1") === String(baseRecord.batterySetName || "Battery 1") &&
        record.id !== baseRecord.id;
    }));

    return [baseRecord].concat(extras.slice(0, 1));
  }

  App.registerModule("battery", {
    title: "Weekly Battery Maintenance Record",
    subtitle: "Weekly battery register with checklist-based remarks, auto condition summary, and compact print-ready pages.",

    buildPrintHtml: buildPrintHtml,
    buildTwoPerPagePrintHtml: buildTwoPerPagePrintHtml,

    render: function () {
      const substations = App.getSubstations();
      const state = ensureStateRecord();

      if (!substations.length) {
        return [
          '<section class="module-shell">',
          '  <div class="card">',
          '    <div class="empty-state">',
          "      Add at least one substation in Substation Management before using the weekly battery maintenance register.",
          "    </div>",
          "  </div>",
          "</section>"
        ].join("");
      }

      const substation = App.findSubstation(state.substationId);
      const historyRecords = getHistoryRecords(state);

      return [
        '<section class="module-shell battery-page">',
        '  <div class="card">',
        '    <div class="module-toolbar no-print">',
        "      <div>",
        "        <h3>Weekly Battery Register Entry</h3>",
        "        <p class=\"muted-text\">Select substation, date, and battery set. The record loads by substation + date + battery set, and the summary updates live as values change.</p>",
        "      </div>",
        "    </div>",
        '    <div class="daily-log-controls no-print">',
        '      <div class="field-group"><label for="battery-substation-select">Substation</label><select id="battery-substation-select">' + App.buildSubstationOptions(state.substationId, false) + "</select></div>",
        '      <div class="field-group"><label for="battery-date-select">Date</label><input id="battery-date-select" type="date" value="' + App.escapeHtml(state.date) + '" required></div>',
        '      <div class="field-group"><label for="battery-set-select">Battery Set</label><select id="battery-set-select">' + buildSetOptionsHtml(substation, state.batterySetName) + "</select></div>",
        '      <div class="field-group"><label>Week Label</label><input id="battery-week-label-readonly" type="text" disabled value="' + App.escapeHtml(state.activeRecord.weekLabel || "") + '"></div>',
        '      <div class="field-group"><label>Save Status</label><div class="tag"><span id="battery-save-status" class="status-inline">Ready for local entry</span></div></div>',
        "    </div>",
        buildSheetHtml(state.activeRecord, substation, false),
        '    <div class="section-block battery-history-section no-print">',
        '      <div class="section-title-row">',
        "        <div>",
        "          <h4>Saved Weekly Records</h4>",
        '          <p class="small-status">Use Edit to load a saved weekly record. Print opens a single register page for the selected row.</p>',
        "        </div>",
        '        <div class="tag">Rows: ' + historyRecords.length + "</div>",
        "      </div>",
        buildHistoryTableHtml(historyRecords, state.activeRecord.id),
        "    </div>",
        "  </div>",
        "</section>"
      ].join("");
    },

    afterRender: function (container) {
      const state = ensureStateRecord();
      const substationSelect = container.querySelector("#battery-substation-select");
      const dateSelect = container.querySelector("#battery-date-select");
      const batterySetSelect = container.querySelector("#battery-set-select");
      const primarySaveButton = container.querySelector("#battery-primary-save-button");
      const updateButton = container.querySelector("#battery-update-button");
      const clearButton = container.querySelector("#battery-clear-button");
      const printButton = container.querySelector("#battery-print-button");
      const printTwoButton = container.querySelector("#battery-print-two-button");
      const sheet = container.querySelector(".battery-sheet");
      const registerTable = container.querySelector(".battery-register-table");

      if (!substationSelect || !dateSelect || !batterySetSelect || !sheet) {
        return;
      }

      if (registerTable) {
        App.enableGridNavigation(registerTable, "tbody input[data-cell-index]");
      }
      App.enableEnterAsTab(container, "#battery-operator, #battery-incharge");

      function reloadRecord() {
        if (state.saveTimer) {
          global.clearTimeout(state.saveTimer);
          state.saveTimer = null;
        }

        const substation = App.findSubstation(state.substationId);
        state.batterySetName = normalizeBatterySetName(substation, state.batterySetName);
        state.activeRecord = normalizeRecord(getMatchingRecord(state.substationId, state.date, state.batterySetName), substation, state.date, state.batterySetName);
      }

      function updateMetaFields() {
        const weekField = container.querySelector("#battery-week-label-readonly");
        if (weekField) {
          weekField.value = state.activeRecord.weekLabel || "";
        }
      }

      substationSelect.addEventListener("change", function () {
        persistRecord(container, true);
        state.substationId = substationSelect.value;
        state.batterySetName = "Battery 1";
        reloadRecord();
        App.renderCurrentRoute();
      });

      dateSelect.addEventListener("change", function () {
        persistRecord(container, true);
        state.date = dateSelect.value || App.getTodayValue();
        reloadRecord();
        App.renderCurrentRoute();
      });

      batterySetSelect.addEventListener("change", function () {
        persistRecord(container, true);
        state.batterySetName = batterySetSelect.value;
        reloadRecord();
        App.renderCurrentRoute();
      });

      sheet.addEventListener("input", function (event) {
        const target = event.target;
        const cellIndex = target.getAttribute("data-cell-index");
        const fieldName = target.getAttribute("data-field-name");

        if (cellIndex !== null && fieldName) {
          const cell = state.activeRecord.cellReadings[Number(cellIndex)];
          if (cell) {
            cell[fieldName] = target.value;
          }
        }

        if (target.id === "battery-operator") {
          state.activeRecord.operatorName = target.value;
        }

        if (target.id === "battery-incharge") {
          state.activeRecord.inchargeName = target.value;
        }

        refreshCalculatedFields(state.activeRecord, App.findSubstation(state.substationId));
        updateStatsInDom(container, state.activeRecord);
        updateMetaFields();
        scheduleSave(container);
      });

      sheet.addEventListener("change", function (event) {
        const target = event.target;
        if (!target.matches("[data-remark-check]")) {
          return;
        }

        state.activeRecord.remarkChecks = Array.from(sheet.querySelectorAll("[data-remark-check]:checked")).map(function (checkbox) {
          return checkbox.getAttribute("data-remark-check");
        });
        refreshCalculatedFields(state.activeRecord, App.findSubstation(state.substationId));
        updateStatsInDom(container, state.activeRecord);
        scheduleSave(container);
      });

      function saveRecord(showToast) {
        persistRecord(container, !showToast);
        if (showToast) {
          App.renderCurrentRoute();
        }
      }

      if (primarySaveButton) {
        primarySaveButton.addEventListener("click", function () {
          saveRecord(true);
        });
      }

      if (updateButton) {
        updateButton.addEventListener("click", function () {
          saveRecord(true);
        });
      }

      if (clearButton) {
        clearButton.addEventListener("click", function () {
          if (!global.confirm("Clear the current weekly battery entry form? Unsaved values will be removed from the screen.")) {
            return;
          }
          state.activeRecord = createBlankRecord(App.findSubstation(state.substationId), state.date, state.batterySetName);
          App.renderCurrentRoute();
        });
      }

      if (printButton) {
        printButton.addEventListener("click", function () {
          if (!persistRecord(container, true)) {
            return;
          }
          App.openPrintWindow("Weekly Battery Maintenance Record", buildPrintHtml(state.activeRecord), {
            orientation: "portrait",
            pageSize: "A4",
            margin: "8mm",
            bodyClass: "print-battery-single"
          });
        });
      }

      if (printTwoButton) {
        printTwoButton.addEventListener("click", function () {
          if (!persistRecord(container, true)) {
            return;
          }
          App.openPrintWindow("Weekly Battery Maintenance Record", buildTwoPerPagePrintHtml(getTwoPerPageRecords(state.activeRecord)), {
            orientation: "portrait",
            pageSize: "A4",
            margin: "8mm",
            bodyClass: "print-battery-batch"
          });
        });
      }

      container.addEventListener("click", function (event) {
        const editButton = event.target.closest('[data-action="edit-battery-record"]');
        if (editButton) {
          const record = App.storage.findById("batteryRecords", editButton.getAttribute("data-id"));
          if (record) {
            state.substationId = record.substationId;
            state.date = record.date;
            state.batterySetName = record.batterySetName || "Battery 1";
            App.renderCurrentRoute();
          }
          return;
        }

        const printRowButton = event.target.closest('[data-action="print-battery-record"]');
        if (printRowButton) {
          const record = App.storage.findById("batteryRecords", printRowButton.getAttribute("data-id"));
          if (record) {
            App.openPrintWindow("Weekly Battery Maintenance Record", buildPrintHtml(record), {
              orientation: "portrait",
              pageSize: "A4",
              margin: "8mm",
              bodyClass: "print-battery-single"
            });
          }
          return;
        }

        const deleteButton = event.target.closest('[data-action="delete-battery-record"]');
        if (!deleteButton) {
          return;
        }

        const recordId = deleteButton.getAttribute("data-id");
        if (!recordId || !global.confirm("Delete this weekly battery maintenance record from local storage?")) {
          return;
        }

        App.storage.remove("batteryRecords", recordId);
        if (state.activeRecord && state.activeRecord.id === recordId) {
          state.activeRecord = createBlankRecord(App.findSubstation(state.substationId), state.date, state.batterySetName);
        }
        App.toast("Battery maintenance record deleted.", "warning");
        App.renderCurrentRoute();
      });
    }
  });
})(window);
