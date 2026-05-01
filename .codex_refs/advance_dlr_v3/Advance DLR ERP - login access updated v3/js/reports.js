(function (global) {
  const App = global.SubstationRegisterApp;

  const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const INTERRUPTION_TYPES = ["EF", "LS", "BD", "OC", "SD", "LP", "SF"];
  const EVENT_IMPACT_TYPES = INTERRUPTION_TYPES.slice();
  const FAULT_TYPES = ["EF", "SD", "LP", "BD", "OC", "LS", "SF"];
  const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$|^24:00$/;
  const ENERGY_BALANCE_ALERT_PERCENT = 10;
  const ABNORMAL_LOW_PERCENT_OF_AVERAGE = 50;
  const ABNORMAL_HIGH_PERCENT_OF_AVERAGE = 150;
  const CURRENT_REPORT_MODES = [
    { value: "daily_report", label: "Daily Report" },
    { value: "weekly_report", label: "Weekly Report" },
    { value: "monthly_report", label: "Monthly Report" }
  ];
  const DAILY_REPORT_OPTIONS = [
    { value: "daily_log", label: "Daily Log Report" },
    { value: "fault_report", label: "Daily Fault Report" },
    { value: "maintenance_report", label: "Maintenance Report" },
    { value: "daily_minmax", label: "Daily Min/Max Feeder Report" }
  ];
  const MONTHLY_PREVIEW_TABS = [
    { value: "consumption", label: "Consumption" },
    { value: "minmax", label: "Min / Max" },
    { value: "interruption", label: "Interruption" },
    { value: "energy_balance", label: "Energy Balance" },
    { value: "main_inc_reconciliation", label: "INC Reconciliation" },
    { value: "load_trend", label: "Load Trend" },
    { value: "abnormal_consumption", label: "Abnormal Consumption" },
    { value: "event_impact", label: "Event Impact" },
    { value: "data_completeness", label: "Data Completeness" },
    { value: "month_end_pack", label: "Month-End Pack" }
  ];
  const IMPORT_COLLECTIONS = [
    { value: "faults", label: "Fault Register" },
    { value: "maintenanceLogs", label: "Maintenance Log" },
    { value: "batteryRecords", label: "Battery Records" },
    { value: "chargeHandoverRecords", label: "Charge Handover Register" },
    { value: "full_backup", label: "Restore Full Backup" }
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
    return App.getModuleState("reports", {
      reportMode: "daily_report",
      previewTab: "consumption",
      legacyReportType: "daily_log",
      substationId: "",
      feederGroup: "all",
      feederId: "",
      mainIncomerId: "",
      thresholdMode: "recent_average",
      eventType: "all",
      date: today.date,
      month: today.month,
      year: today.year,
      startDate: today.date,
      endDate: today.date,
      importCollection: "faults",
      importStatus: ""
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const reportBundleCache = App.reportBundleCache = App.reportBundleCache || {
    stamp: "",
    entries: {}
  };

  // AUDIT-FIX MED-10: Invalidate bundle cache on structural data-changed events.
  // Covers: import, rollback, restore, clear, replace, full backup load.
  // Simple upsert/delete also clears the stamp so the next access rebuilds naturally.
  (function () {
    var STRUCTURAL_TYPES = ["import", "rollback", "clear", "replace"];
    global.addEventListener("substation-register:data-changed", function (event) {
      var detail = event && event.detail;
      var changeType = detail && detail.type ? String(detail.type).toLowerCase() : "";
      if (STRUCTURAL_TYPES.indexOf(changeType) !== -1) {
        reportBundleCache.stamp = "";
        reportBundleCache.entries = {};
      } else {
        // For per-record saves, clear the stamp so the cache is rebuilt on next read.
        reportBundleCache.stamp = "";
      }
    });
  }());

  function buildBundleCacheKey(state) {
    return [
      state.year,
      state.month,
      state.substationId,
      state.feederGroup,
      state.feederId,
      state.mainIncomerId,
      state.thresholdMode,
      state.eventType,
      state.startDate,
      state.endDate,
      state.date
    ].join("|");
  }

  function getCachedMonthlyBundle(state, builder) {
    const currentStamp = String(App.storage.getLastUpdated() || "");

    if (reportBundleCache.stamp !== currentStamp) {
      reportBundleCache.stamp = currentStamp;
      reportBundleCache.entries = {};
    }

    const cacheKey = buildBundleCacheKey(state);
    if (!reportBundleCache.entries[cacheKey]) {
      reportBundleCache.entries[cacheKey] = clone(builder());
    }

    return clone(reportBundleCache.entries[cacheKey]);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value, digits) {
    if (value === "" || value === null || value === undefined || !Number.isFinite(Number(value))) {
      return "";
    }

    return Number(value).toLocaleString("en-IN", {
      useGrouping: false,
      minimumFractionDigits: typeof digits === "number" ? digits : 0,
      maximumFractionDigits: typeof digits === "number" ? digits : 2
    });
  }

  function formatPercent(value) {
    if (!Number.isFinite(Number(value))) {
      return "";
    }
    return Number(value).toFixed(2) + "%";
  }

  function formatDurationText(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 0) {
      return "0h 00m";
    }

    const hours = Math.floor(value / 60);
    const remainingMinutes = value % 60;
    return String(hours) + "h " + String(remainingMinutes).padStart(2, "0") + "m";
  }

  function parseTimeToMinutes(value) {
    const text = String(value || "").trim();
    if (!TIME_PATTERN.test(text)) {
      return -1;
    }
    if (text === "24:00") {
      return 24 * 60;
    }

    const parts = text.split(":");
    return (Number(parts[0]) * 60) + Number(parts[1]);
  }

  function isValidDateString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
  }

  function average(values) {
    const numeric = asArray(values).filter(function (item) {
      return Number.isFinite(Number(item));
    }).map(Number);
    if (!numeric.length) {
      return null;
    }
    return numeric.reduce(function (sum, item) {
      return sum + item;
    }, 0) / numeric.length;
  }

  function safeFilename(value) {
    return String(value || "report")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .toLowerCase();
  }

  function getMonthValue(state) {
    return String(state.year || "") + "-" + String(state.month || "").padStart(2, "0");
  }

  function getMonthRange(state) {
    const year = Number(state.year);
    const month = Number(state.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return { start: "", end: "", daysInMonth: 0 };
    }

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return {
      start: String(start.getFullYear()) + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-" + String(start.getDate()).padStart(2, "0"),
      end: String(end.getFullYear()) + "-" + String(end.getMonth() + 1).padStart(2, "0") + "-" + String(end.getDate()).padStart(2, "0"),
      daysInMonth: end.getDate()
    };
  }

  function getMonthLabel(state) {
    const monthIndex = Number(state.month) - 1;
    if (monthIndex < 0 || monthIndex > 11) {
      return "";
    }
    return MONTH_LABELS[monthIndex] + " " + state.year;
  }

  function getSubstationLabel(substationId) {
    const substation = App.findSubstation(substationId);
    return substation ? substation.name : "Unknown Substation";
  }

  function ensureStateSelections() {
    const state = getModuleState();
    const today = getTodayParts();
    const substations = App.getSubstations();

    if (substations.length && (!state.substationId || !App.findSubstation(state.substationId))) {
      state.substationId = substations[0].id;
    }

    if (!state.month) {
      state.month = today.month;
    }
    if (!state.year) {
      state.year = today.year;
    }

    const monthRange = getMonthRange(state);
    if (!state.date || String(state.date).slice(0, 7) !== getMonthValue(state)) {
      state.date = monthRange.start || today.date;
    }

    if (!state.startDate) {
      state.startDate = state.date;
    }
    if (!state.endDate) {
      state.endDate = state.date;
    }

    if (MONTHLY_PREVIEW_TABS.every(function (tab) { return tab.value !== state.previewTab; })) {
      state.previewTab = "consumption";
    }

    if (DAILY_REPORT_OPTIONS.every(function (option) { return option.value !== state.legacyReportType; })) {
      state.legacyReportType = "daily_log";
    }

    if (IMPORT_COLLECTIONS.every(function (option) { return option.value !== state.importCollection; })) {
      state.importCollection = "faults";
    }

    if (["recent_average", "basic_only"].indexOf(state.thresholdMode) === -1) {
      state.thresholdMode = "recent_average";
    }

    if (["all"].concat(EVENT_IMPACT_TYPES).indexOf(state.eventType) === -1) {
      state.eventType = "all";
    }

    if (state.reportMode === "monthly_report" && state.previewTab === "event_impact") {
      const monthRange = getMonthRange(state);
      if (!state.startDate || !state.endDate || (state.startDate === state.date && state.endDate === state.date)) {
        state.startDate = monthRange.start;
        state.endDate = monthRange.end;
      }
    }

    // AUDIT-FIX HIGH-01: Cache getMonthDailyLogs once to avoid double scan per render cycle.
    if (state.substationId) {
      const cachedMonthLogs = getMonthDailyLogs(state);
      const visibleFeeders = getVisibleFeedersForSubstation(state, cachedMonthLogs);

      const feederExists = visibleFeeders.some(function (feeder) {
        return feeder.id === state.feederId;
      });
      if (!feederExists) {
        state.feederId = "";
      }

      const mainIncomerExists = visibleFeeders.some(function (feeder) {
        return App.isMainIncFeeder(feeder) && feeder.id === state.mainIncomerId;
      });
      if (!mainIncomerExists) {
        state.mainIncomerId = "";
      }
    } else {
      state.feederId = "";
      state.mainIncomerId = "";
    }

    return state;
  }

  function getMonthDailyLogs(state) {
    const range = getMonthRange(state);
    return App.storage.getCollection("dailyLogs").filter(function (record) {
      return record.substationId === state.substationId &&
        record.date >= range.start &&
        record.date <= range.end;
    }).sort(function (left, right) {
      return String(left.date).localeCompare(String(right.date));
    });
  }

  function getMonthFaults(state) {
    const range = getMonthRange(state);
    return App.storage.getCollection("faults").filter(function (fault) {
      return fault.substationId === state.substationId &&
        fault.date >= range.start &&
        fault.date <= range.end;
    });
  }

  function getDailyLogForDate(state) {
    return App.storage.getCollection("dailyLogs").find(function (record) {
      return record.substationId === state.substationId && record.date === state.date;
    }) || null;
  }

  function isBlankMetadataValue(value) {
    return value === null || value === undefined || String(value).trim() === "";
  }

  function mergePreferredFeederProfile(preferred, fallback) {
    const preferredSource = preferred || {};
    const fallbackSource = fallback || {};
    const keys = Object.keys(Object.assign({}, fallbackSource, preferredSource));
    const next = {};

    keys.forEach(function (key) {
      next[key] = !isBlankMetadataValue(preferredSource[key]) ? preferredSource[key] : fallbackSource[key];
    });

    return next;
  }

  function getVisibleFeedersForSubstation(state, monthRecords) {
    const substation = App.findSubstation(state.substationId);
    const sourceFeeders = substation ? substation.feeders : [];
    const feederMap = {};

    asArray(monthRecords).forEach(function (record) {
      App.sortFeeders(record && record.feederSnapshot).forEach(function (feeder) {
        if (!App.isTotalFeeder(feeder) && feeder.isVisible !== false) {
          feederMap[feeder.id] = feederMap[feeder.id]
            ? mergePreferredFeederProfile(feederMap[feeder.id], Object.assign({}, feeder))
            : Object.assign({}, feeder);
        }
      });
    });

    App.sortFeeders(sourceFeeders).forEach(function (feeder) {
      if (!App.isTotalFeeder(feeder) && feeder.isVisible !== false) {
        feederMap[feeder.id] = feederMap[feeder.id]
          ? mergePreferredFeederProfile(feederMap[feeder.id], Object.assign({}, feeder))
          : Object.assign({}, feeder);
      }
    });

    return App.sortFeeders(Object.keys(feederMap).map(function (key) {
      return feederMap[key];
    }));
  }

  function buildFeederGroupOptions(state) {
    const feeders = state.reportMode === "monthly_report"
      ? getVisibleFeedersForSubstation(state, getMonthDailyLogs(state))
      : (App.findSubstation(state.substationId) ? App.findSubstation(state.substationId).feeders : []);
    const options = [
      { value: "all", label: "All Feeders" },
      { value: "11kv-outgoing", label: "11 KV Outgoing" },
      { value: "33kv", label: "33 KV Feeders" }
    ];

    App.sortFeeders(feeders || []).filter(App.isMainIncFeeder).forEach(function (feeder) {
      options.push({
        value: "parent:" + feeder.id,
        label: "Group - " + App.getFeederLabel(feeder)
      });
    });

    return options.map(function (option) {
      return '<option value="' + App.escapeHtml(option.value) + '"' + (option.value === state.feederGroup ? " selected" : "") + ">" + App.escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function buildFeederOptions(state) {
    const feeders = getVisibleFeedersForSubstation(state, getMonthDailyLogs(state)).filter(function (feeder) {
      return matchesFeederGroup(feeder, state.feederGroup);
    });

    const options = ['<option value="">All Feeders</option>'].concat(feeders.map(function (feeder) {
      return '<option value="' + App.escapeHtml(feeder.id) + '"' + (feeder.id === state.feederId ? " selected" : "") + ">" + App.escapeHtml(App.getFeederLabel(feeder)) + "</option>";
    }));

    return options.join("");
  }

  function buildMainIncomerOptions(state) {
    function matchesReconciliationGroup(mainIncomer, groupValue) {
      const group = String(groupValue || "all");
      if (group.indexOf("parent:") === 0) {
        return group.split(":")[1] === mainIncomer.id;
      }
      return true;
    }

    const feeders = getVisibleFeedersForSubstation(state, getMonthDailyLogs(state)).filter(function (feeder) {
      return App.isMainIncFeeder(feeder) && matchesReconciliationGroup(feeder, state.feederGroup);
    });

    const options = ['<option value="">All Main Incomers</option>'].concat(feeders.map(function (feeder) {
      return '<option value="' + App.escapeHtml(feeder.id) + '"' + (feeder.id === state.mainIncomerId ? " selected" : "") + ">" + App.escapeHtml(App.getFeederLabel(feeder)) + "</option>";
    }));

    return options.join("");
  }

  function matchesFeederGroup(feeder, groupValue) {
    const group = String(groupValue || "all");
    if (!feeder || group === "all") {
      return true;
    }
    if (group === "11kv-outgoing") {
      return App.is11KvOutgoingFeeder(feeder);
    }
    if (group === "33kv") {
      return App.is33KvFeeder(feeder);
    }
    if (group.indexOf("parent:") === 0) {
      const parentId = group.split(":")[1];
      return feeder.id === parentId || feeder.parentFeederId === parentId;
    }
    return true;
  }

  function matchesFeederSelection(feeder, selectedFeederId) {
    const feederId = String(selectedFeederId || "").trim();
    if (!feederId) {
      return true;
    }
    return Boolean(feeder && feeder.id === feederId);
  }

  function matchesEventTypeSelection(eventType, selectedEventType) {
    const filterValue = String(selectedEventType || "all").trim().toUpperCase();
    if (!filterValue || filterValue === "ALL") {
      return true;
    }
    return String(eventType || "").trim().toUpperCase() === filterValue;
  }

  function buildModeOptions(selectedValue) {
    return CURRENT_REPORT_MODES.map(function (option) {
      return '<option value="' + App.escapeHtml(option.value) + '"' + (option.value === selectedValue ? " selected" : "") + ">" + App.escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function buildDailyReportOptions(selectedValue) {
    return DAILY_REPORT_OPTIONS.map(function (option) {
      return '<option value="' + App.escapeHtml(option.value) + '"' + (option.value === selectedValue ? " selected" : "") + ">" + App.escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function buildMonthOptions(selectedValue) {
    return MONTH_LABELS.map(function (label, index) {
      const value = String(index + 1).padStart(2, "0");
      return '<option value="' + value + '"' + (value === selectedValue ? " selected" : "") + ">" + App.escapeHtml(label) + "</option>";
    }).join("");
  }

  function buildImportCollectionOptions(selectedValue) {
    return IMPORT_COLLECTIONS.map(function (option) {
      return '<option value="' + App.escapeHtml(option.value) + '"' + (option.value === selectedValue ? " selected" : "") + ">" + App.escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function buildThresholdModeOptions(selectedValue) {
    return [
      { value: "recent_average", label: "Recent 3-Month Average" },
      { value: "basic_only", label: "Zero / Negative / Missing Only" }
    ].map(function (option) {
      return '<option value="' + App.escapeHtml(option.value) + '"' + (option.value === selectedValue ? " selected" : "") + ">" + App.escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function buildEventTypeOptions(selectedValue) {
    return [{ value: "all", label: "All Event Types" }].concat(EVENT_IMPACT_TYPES.map(function (type) {
      return { value: type, label: type };
    })).map(function (option) {
      return '<option value="' + App.escapeHtml(option.value) + '"' + (option.value === selectedValue ? " selected" : "") + ">" + App.escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function buildMonthlyPreviewTabs(activeTab) {
    return MONTHLY_PREVIEW_TABS.map(function (tab) {
      return '<button type="button" class="history-tab-button' + (tab.value === activeTab ? " active" : "") + '" data-report-tab="' + App.escapeHtml(tab.value) + '">' + App.escapeHtml(tab.label) + "</button>";
    }).join("");
  }

  function buildTagsHtml(tags) {
    return asArray(tags).filter(Boolean).map(function (tag) {
      return '<div class="tag">' + App.escapeHtml(tag) + "</div>";
    }).join("");
  }

  function buildNormalTableHtml(table) {
    const rows = asArray(table.rows);
    return [
      '<div class="table-shell">',
      '  <table class="compact-table ' + App.escapeHtml(table.className || "") + '">',
      "    <thead><tr>",
      asArray(table.columns).map(function (column) {
        return "<th>" + App.escapeHtml(column.label) + "</th>";
      }).join(""),
      "    </tr></thead>",
      "    <tbody>",
      rows.length ? rows.map(function (row) {
        return '<tr class="' + App.escapeHtml(row._rowClass || "") + '">' + asArray(table.columns).map(function (column) {
          return "<td>" + App.escapeHtml(row[column.key]) + "</td>";
        }).join("") + "</tr>";
      }).join("") : '<tr><td colspan="' + table.columns.length + '" class="muted-text">' + App.escapeHtml(table.emptyMessage || "No records available.") + "</td></tr>",
      "    </tbody>",
      "  </table>",
      "</div>"
    ].join("");
  }

  function buildInterruptionMatrixHtml(table) {
    const rows = asArray(table.rows);
    return [
      '<div class="table-shell">',
      '  <table class="compact-table fault-matrix-table">',
      "    <thead>",
      "      <tr>",
      '        <th rowspan="2">Feeder</th>',
      INTERRUPTION_TYPES.map(function (type) {
        return '<th colspan="2">' + App.escapeHtml(type) + "</th>";
      }).join(""),
      '        <th colspan="2">Total</th>',
      "      </tr>",
      "      <tr>",
      INTERRUPTION_TYPES.map(function () {
        return "<th>Qty</th><th>Time</th>";
      }).join(""),
      "        <th>Qty</th><th>Time</th>",
      "      </tr>",
      "    </thead>",
      "    <tbody>",
      rows.length ? rows.map(function (row) {
        return "<tr>" +
          "<td>" + App.escapeHtml(row.feederName) + "</td>" +
          INTERRUPTION_TYPES.map(function (type) {
            return "<td>" + App.escapeHtml(row[type + "Qty"]) + "</td><td>" + App.escapeHtml(row[type + "Time"]) + "</td>";
          }).join("") +
          "<td>" + App.escapeHtml(row.totalQty) + "</td><td>" + App.escapeHtml(row.totalTime) + "</td>" +
        "</tr>";
      }).join("") : '<tr><td colspan="' + ((INTERRUPTION_TYPES.length * 2) + 3) + '" class="muted-text">' + App.escapeHtml(table.emptyMessage || "No interruption data available.") + "</td></tr>",
      table.totalRow ? (
        '<tr class="fault-grand-total-row"><th>Grand Total</th>' +
        INTERRUPTION_TYPES.map(function (type) {
          return "<th>" + App.escapeHtml(table.totalRow[type + "Qty"]) + "</th><th>" + App.escapeHtml(table.totalRow[type + "Time"]) + "</th>";
        }).join("") +
        "<th>" + App.escapeHtml(table.totalRow.totalQty) + "</th><th>" + App.escapeHtml(table.totalRow.totalTime) + "</th></tr>"
      ) : "",
      "    </tbody>",
      "  </table>",
      "</div>"
    ].join("");
  }

  function buildTableHtml(table) {
    return table.kind === "interruption-matrix" ? buildInterruptionMatrixHtml(table) : buildNormalTableHtml(table);
  }

  function buildDatasetCardsHtml(summaryCards) {
    return asArray(summaryCards).length ? (
      '    <div class="stats-grid">' +
      asArray(summaryCards).map(function (card) {
        return '<article class="stat-card"><h3>' + App.escapeHtml(card.label) + '</h3><strong>' + App.escapeHtml(card.value) + "</strong></article>";
      }).join("") +
      "    </div>"
    ) : "";
  }

  function buildDatasetTablesHtml(tables) {
    return asArray(tables).map(function (table) {
      return [
        '<div class="section-block">',
        table.title ? ('  <div class="section-title-row"><div><h4>' + App.escapeHtml(table.title) + '</h4></div></div>') : "",
        buildTableHtml(table),
        "</div>"
      ].join("");
    }).join("");
  }

  function buildSingleDatasetPreviewHtml(dataset, titleTag) {
    const headingTag = titleTag || "h3";
    return [
      '  <div class="report-section">',
      '    <div class="report-header">',
      "      <div>",
      "        <" + headingTag + ">" + App.escapeHtml(dataset.title || "Report Preview") + "</" + headingTag + ">",
      '        <p class="report-meta">' + App.escapeHtml(dataset.subtitle || "") + "</p>",
      "      </div>",
      '      <div class="history-tab-row history-filter-tags">' + buildTagsHtml(dataset.tags) + "</div>",
      "    </div>",
      buildDatasetCardsHtml(dataset.summaryCards),
      (dataset.note ? '<p class="small-status">' + App.escapeHtml(dataset.note) + "</p>" : ""),
      buildDatasetTablesHtml(dataset.tables),
      "  </div>"
    ].join("");
  }

  function buildDatasetHtml(dataset) {
    if (asArray(dataset.sections).length) {
      return [
        '<section class="report-preview report-pack-preview">',
        buildSingleDatasetPreviewHtml({
          title: dataset.title || "Report Pack Preview",
          subtitle: dataset.subtitle || "",
          tags: dataset.tags || [],
          summaryCards: dataset.summaryCards || [],
          note: dataset.note || "",
          tables: []
        }, "h3"),
        asArray(dataset.sections).map(function (section, index) {
          return '<section class="month-end-pack-section' + (index === 0 ? "" : " pack-section-spaced") + '">' +
            buildSingleDatasetPreviewHtml(section, "h4") +
          "</section>";
        }).join(""),
        "</section>"
      ].join("");
    }

    return [
      '<section class="report-preview">',
      buildSingleDatasetPreviewHtml(dataset, "h3"),
      "</section>"
    ].join("");
  }

  function buildDatasetPrintHtml(dataset) {
    if (asArray(dataset.sections).length) {
      return [
        '<section class="module-shell month-end-pack-print">',
        buildSingleDatasetPreviewHtml({
          title: dataset.title || "Report Pack",
          subtitle: dataset.subtitle || "",
          tags: dataset.tags || [],
          summaryCards: dataset.summaryCards || [],
          note: dataset.note || "",
          tables: []
        }, "h2"),
        asArray(dataset.sections).map(function (section) {
          return '<section class="month-end-pack-section">' +
            buildSingleDatasetPreviewHtml(section, "h2") +
          "</section>";
        }).join(""),
        "</section>"
      ].join("");
    }

    return [
      '<section class="module-shell">',
      buildSingleDatasetPreviewHtml(dataset, "h2"),
      "</section>"
    ].join("");
  }

  function buildEmptyView(title, subtitle, tags, emptyMessage) {
    return {
      dataset: {
        title: title,
        subtitle: subtitle,
        tags: tags,
        tables: [{
          title: "Preview",
          columns: [{ key: "message", label: "Status" }],
          rows: [{ message: emptyMessage }],
          emptyMessage: emptyMessage
        }]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function buildFeederLabelMap(feeders) {
    return asArray(feeders).reduce(function (accumulator, feeder) {
      accumulator[App.getFeederLabel(feeder)] = feeder;
      return accumulator;
    }, {});
  }

  function getConsumptionSummaryMap(record) {
    const mapById = {};
    const mapByName = {};
    const summary = App.modules.dailylog.buildConsumptionSummary(record);
    asArray(summary.rows).forEach(function (row) {
      if (row.feederId) {
        mapById[row.feederId] = row;
      }
      mapByName[row.feederName] = row;
    });
    return {
      summary: summary,
      rowMap: mapById,
      rowMapByName: mapByName
    };
  }

  function escapeCsvValue(value) {
    const text = value === null || value === undefined ? "" : String(value);
    if (text.indexOf(",") >= 0 || text.indexOf("\"") >= 0 || text.indexOf("\n") >= 0) {
      return "\"" + text.replace(/"/g, "\"\"") + "\"";
    }
    return text;
  }

  function xmlEscape(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function sanitizeSheetName(name) {
    return String(name || "Sheet")
      .replace(/[\\/?*\[\]:]+/g, " ")
      .slice(0, 31) || "Sheet";
  }

  function buildDailyLogView(state) {
    const record = getDailyLogForDate(state);
    const tags = [
      "Substation: " + getSubstationLabel(state.substationId),
      "Date: " + App.formatDate(state.date)
    ];

    if (!record) {
      return buildEmptyView("Daily Report - Summary Preview", "Daily Log summary preview", tags, "No Daily Log record is saved for the selected substation and date.");
    }

    const summary = App.modules.dailylog.buildConsumptionSummary(record);
    const rows = asArray(summary.rows).map(function (row) {
      return {
        feederName: row.feederName,
        opening: formatNumber(row.openingKwh, 0),
        closing: formatNumber(row.closingKwh, 0),
        difference: formatNumber(row.difference, 0),
        mf: formatNumber(row.mf, 2),
        consumption: formatNumber(row.consumption, 2)
      };
    });

    return {
      dataset: {
        title: "Daily Report - Summary Preview",
        subtitle: "Preview shows feeder-wise consumption summary. Use Print for the full DLR sheet layout.",
        tags: tags.concat(["Total Consumption: " + formatNumber(summary.totalConsumption, 2)]),
        note: summary.meterChangeConsidered
          ? "Meter change is considered in one or more feeder calculations for this day. Print opens the full DLR sheet."
          : "Print opens the full DLR sheet.",
        tables: [{
          title: "Feeder-wise Consumption Summary",
          columns: [
            { key: "feederName", label: "Feeder Name" },
            { key: "opening", label: "Opening" },
            { key: "closing", label: "Closing" },
            { key: "difference", label: "Difference" },
            { key: "mf", label: "MF" },
            { key: "consumption", label: "Consumption" }
          ],
          rows: rows,
          emptyMessage: "No feeder readings are available for the selected record."
        }]
      },
      printHtml: App.modules.dailylog.buildPrintHtml(record),
      printOptions: {
        orientation: "landscape",
        pageSize: "A3",
        margin: "8mm",
        bodyClass: "print-dailylog"
      }
    };
  }

  function buildDailyFaultView(state) {
    const records = App.storage.getCollection("faults").filter(function (fault) {
      return fault.substationId === state.substationId && fault.date === state.date;
    }).sort(function (left, right) {
      const timeDelta = parseTimeToMinutes(left.startTime) - parseTimeToMinutes(right.startTime);
      return timeDelta !== 0 ? timeDelta : String(left.feederName || "").localeCompare(String(right.feederName || ""));
    });

    return {
      dataset: {
        title: "Daily Fault Report",
        subtitle: "Manual and automatic fault entries for the selected day",
        tags: [
          "Substation: " + getSubstationLabel(state.substationId),
          "Date: " + App.formatDate(state.date),
          "Records: " + records.length
        ],
        tables: [{
          title: "Fault Register",
          columns: [
            { key: "feederName", label: "Feeder" },
            { key: "fromTime", label: "From" },
            { key: "toTime", label: "To" },
            { key: "duration", label: "Duration" },
            { key: "faultType", label: "Type" },
            { key: "source", label: "Source" },
            { key: "remark", label: "Remark" }
          ],
          rows: records.map(function (item) {
            return {
              feederName: item.feederName || "-",
              fromTime: item.startTime || "-",
              toTime: item.endTime || "-",
              duration: formatDurationText(item.durationMinutes || 0),
              faultType: item.faultType || "-",
              source: item.source || "MANUAL",
              remark: item.remark || "-"
            };
          }),
          emptyMessage: "No fault entries match the selected substation and date."
        }]
      },
      printHtml: App.modules.faults.buildPrintHtml(records, {
        substationId: state.substationId,
        startDate: state.date,
        endDate: state.date
      }),
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function getMaintenanceDateRange(state) {
    const startDate = state.startDate || state.date;
    const endDate = state.endDate || startDate;
    return startDate <= endDate ? { startDate: startDate, endDate: endDate } : { startDate: endDate, endDate: startDate };
  }

  function buildMaintenanceView(state) {
    const range = getMaintenanceDateRange(state);
    const records = App.storage.getCollection("maintenanceLogs").filter(function (item) {
      return item.substationId === state.substationId &&
        item.date >= range.startDate &&
        item.date <= range.endDate;
    }).sort(function (left, right) {
      const leftStamp = String(left.date || "") + "T" + String(left.time || "00:00");
      const rightStamp = String(right.date || "") + "T" + String(right.time || "00:00");
      return leftStamp.localeCompare(rightStamp);
    });

    return {
      dataset: {
        title: "Maintenance Report",
        subtitle: "Date-range maintenance register for the selected substation",
        tags: [
          "Substation: " + getSubstationLabel(state.substationId),
          "From: " + App.formatDate(range.startDate),
          "To: " + App.formatDate(range.endDate),
          "Records: " + records.length
        ],
        tables: [{
          title: "Maintenance Log",
          columns: [
            { key: "date", label: "Date" },
            { key: "time", label: "Time" },
            { key: "workDetail", label: "Work Detail" },
            { key: "remark", label: "Remark" }
          ],
          rows: records.map(function (item) {
            return {
              date: App.formatDate(item.date),
              time: item.time || "-",
              workDetail: item.workDetail || "-",
              remark: item.remark || "-"
            };
          }),
          emptyMessage: "No maintenance records match the selected range."
        }]
      },
      printHtml: App.modules.maintenance.buildPrintHtml(records),
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function buildDailyMinMaxAnalysis(state) {
    const record = getDailyLogForDate(state);
    if (!record) {
      return {
        rows: [],
        tags: [
          "Substation: " + getSubstationLabel(state.substationId),
          "Date: " + App.formatDate(state.date)
        ],
        note: "No Daily Log record is available for the selected day."
      };
    }

    const feeders = App.modules.dailylog.getReportFeeders(record).filter(function (feeder) {
      return matchesFeederGroup(feeder, state.feederGroup);
    });

    const rows = feeders.map(function (feeder) {
      let maxAmp = null;
      let maxTime = "";
      let minAmp = null;
      let minTime = "";
      let ampValues = [];
      let maxKv = null;
      let minKv = null;

      record.rows.forEach(function (row, rowIndex) {
        const ampValue = App.modules.dailylog.getNumericReadingValue(record, feeder.id, rowIndex, "amp");
        const kvValue = App.modules.dailylog.getNumericReadingValue(record, feeder.id, rowIndex, "kv");

        if (Number.isFinite(ampValue)) {
          ampValues.push(ampValue);
          if (maxAmp === null || ampValue > maxAmp) {
            maxAmp = ampValue;
            maxTime = row.hour;
          }
          if (minAmp === null || ampValue < minAmp) {
            minAmp = ampValue;
            minTime = row.hour;
          }
        }

        if (Number.isFinite(kvValue)) {
          if (maxKv === null || kvValue > maxKv) {
            maxKv = kvValue;
          }
          if (minKv === null || kvValue < minKv) {
            minKv = kvValue;
          }
        }
      });

      return {
        feederId: feeder.id,
        feederName: App.getFeederLabel(feeder),
        maxAmp: maxAmp,
        maxTime: maxTime,
        minAmp: minAmp,
        minTime: minTime,
        avgAmp: average(ampValues),
        maxKv: maxKv,
        minKv: minKv
      };
    });

    return {
      rows: rows,
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "Date: " + App.formatDate(state.date),
        "Feeder Group: " + String(state.feederGroup || "all")
      ],
      note: "Event-coded cells and blanks are ignored. Estimated numeric readings are included if they are saved as numeric values."
    };
  }

  function buildDailyMinMaxView(state) {
    const analysis = buildDailyMinMaxAnalysis(state);
    return {
      dataset: {
        title: "Daily Min/Max Feeder Report",
        subtitle: "Hourly numeric feeder scan for the selected day. Event-coded cells and blanks are ignored.",
        tags: analysis.tags,
        note: analysis.note,
        tables: [{
          title: "Daily Min/Max",
          columns: [
            { key: "feederName", label: "Feeder" },
            { key: "maxAmp", label: "Max Amp" },
            { key: "maxTime", label: "Max Time" },
            { key: "minAmp", label: "Min Amp" },
            { key: "minTime", label: "Min Time" },
            { key: "avgAmp", label: "Avg Amp" },
            { key: "maxKv", label: "Max KV" },
            { key: "minKv", label: "Min KV" }
          ],
          rows: analysis.rows.map(function (row) {
            return {
              feederName: row.feederName,
              maxAmp: formatNumber(row.maxAmp, 2),
              maxTime: row.maxTime || "",
              minAmp: formatNumber(row.minAmp, 2),
              minTime: row.minTime || "",
              avgAmp: formatNumber(row.avgAmp, 2),
              maxKv: formatNumber(row.maxKv, 2),
              minKv: formatNumber(row.minKv, 2)
            };
          }),
          emptyMessage: "No numeric feeder data is available for the selected day."
        }]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function getMeterChangeMap(state) {
    const range = getMonthRange(state);
    return App.storage.getCollection("meterChangeEvents").reduce(function (accumulator, event) {
      const feederId = String(event.feederId || "").trim();
      if (event.substationId === state.substationId && feederId && event.effectiveDate >= range.start && event.effectiveDate <= range.end) {
        accumulator[feederId] = true;
      }
      return accumulator;
    }, {});
  }

  // AUDIT-FIX CRIT-03: Monthly Consumption status — extended to include Missing Opening.
  // Rule: prev MUST come from Day-1 of the month. If Day-1 has no opening for this feeder,
  // prev is null and status = "Missing Opening". We do NOT fall back to a later day.
  function getMonthlyConsumptionStatus(rowState) {
    const units = Number(rowState.units);
    const hasUnits = Boolean(rowState.hasUnits);
    const meterChangeFlag = Boolean(rowState.meterChangeFlag);
    const missingOpening = Boolean(rowState.missingOpening);
    const prev = rowState.prev;
    const curr = rowState.curr;
    const epsilon = 0.000001;

    // Missing opening is the highest-priority flag after negative.
    if (missingOpening && !meterChangeFlag) {
      return "Missing Opening";
    }
    if (missingOpening && meterChangeFlag) {
      return "Missing Opening + Meter Change";
    }

    if ((hasUnits && units < 0) || (!hasUnits && prev !== null && curr !== null && curr < prev)) {
      return meterChangeFlag ? "Negative Difference Error + Meter Change" : "Negative Difference Error";
    }

    if ((hasUnits && Math.abs(units) < epsilon) || (!hasUnits && prev !== null && curr !== null && Math.abs(curr - prev) < epsilon)) {
      return meterChangeFlag ? "Meter Change + Zero Consumption" : "Zero Consumption";
    }

    if (meterChangeFlag) {
      return "Meter Change Flag";
    }

    return "Normal";
  }

  function buildMonthlyConsumptionAnalysis(state) {
    const monthRecords = getMonthDailyLogs(state);
    const feeders = getVisibleFeedersForSubstation(state, monthRecords).filter(function (feeder) {
      return matchesFeederGroup(feeder, state.feederGroup);
    });
    const meterChangeMap = getMeterChangeMap(state);

    // AUDIT-FIX CRIT-03: Build a dedicated map for Day-1 records only.
    // prev MUST come from the opening reading of the first day of the month for each feeder.
    // "First day of month" = month range start date, NOT the first date with any data.
    const monthRange = getMonthRange(state);
    const day1Record = monthRecords.find(function (record) {
      return record.date === monthRange.start;
    }) || null;
    const day1SummaryMap = day1Record ? getConsumptionSummaryMap(day1Record) : { rowMap: {}, rowMapByName: {} };

    const recordSummaries = monthRecords.map(function (record) {
      const summaryMap = getConsumptionSummaryMap(record);
      return {
        record: record,
        rowMap: summaryMap.rowMap,
        rowMapByName: summaryMap.rowMapByName
      };
    });
    let totalOutgoingSentOut = 0;

    const rows = feeders.map(function (feeder) {
      const feederLabel = App.getFeederLabel(feeder);

      // AUDIT-FIX CRIT-03: prev comes strictly from Day-1 opening.
      // If Day-1 has no record or no opening for this feeder, prev is null (missing).
      var day1Row = day1SummaryMap.rowMap[feeder.id] || day1SummaryMap.rowMapByName[feederLabel];
      var prevFromDay1 = day1Row ? toNumber(day1Row.openingKwh) : null;
      var missingOpening = (prevFromDay1 === null);

      var curr = null;
      var totalUnits = 0;
      var hasUnits = false;

      recordSummaries.forEach(function (item) {
        const row = item.rowMap[feeder.id] || item.rowMapByName[feederLabel];
        if (!row) {
          return;
        }

        const closing = toNumber(row.closingKwh);
        const difference = toNumber(row.difference);

        // curr = last available closing reading (month-end reading)
        if (closing !== null) {
          curr = closing;
        }
        if (difference !== null) {
          totalUnits += difference;
          hasUnits = true;
        }
      });

      const mf = toNumber(feeder.mf);
      const units = hasUnits ? Number(totalUnits.toFixed(2)) : null;
      const sentOut = hasUnits && mf !== null ? Number((units * mf).toFixed(2)) : null;
      if (App.is11KvOutgoingFeeder(feeder) && sentOut !== null) {
        totalOutgoingSentOut += sentOut;
      }

      const meterChangeFlag = Boolean(meterChangeMap[feeder.id]);

      return {
        feederId: feeder.id,
        feederName: feederLabel,
        ctRatio: feeder.ctRatio || "",
        prev: prevFromDay1,
        curr: curr,
        units: units,
        mf: mf,
        sentOut: sentOut,
        sharePercent: null,
        missingOpening: missingOpening,
        status: getMonthlyConsumptionStatus({
          units: units,
          hasUnits: hasUnits,
          meterChangeFlag: meterChangeFlag,
          missingOpening: missingOpening,
          prev: prevFromDay1,
          curr: curr
        }),
        hasUnits: hasUnits,
        meterChangeFlag: meterChangeFlag,
        feeder: feeder
      };
    });

    rows.forEach(function (row) {
      if (App.is11KvOutgoingFeeder(row.feeder) && row.sentOut !== null && totalOutgoingSentOut > 0) {
        row.sharePercent = Number(((row.sentOut / totalOutgoingSentOut) * 100).toFixed(2));
      }
    });

    return {
      rows: rows,
      totalOutgoingSentOut: Number(totalOutgoingSentOut.toFixed(2)),
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "Month: " + getMonthLabel(state),
        "Feeder Group: " + String(state.feederGroup || "all")
      ],
      note: "Prev = opening reading from Day 1 of the month for each feeder. If Day 1 log is missing, Prev is blank and status shows Missing Opening. Monthly Units are summed from daily validated segments."
    };
  }

  function buildMonthlyConsumptionView(state) {
    const analysis = buildMonthlyConsumptionAnalysis(state);
    return {
      dataset: {
        title: "Monthly Consumption Report",
        subtitle: "Month opening, closing, units, sent out, share, and meter status summary",
        tags: analysis.tags.concat(["Total Outgoing Sent Out: " + formatNumber(analysis.totalOutgoingSentOut, 2)]),
        note: analysis.note,
        tables: [{
          title: "Monthly Consumption",
          columns: [
            { key: "feederName", label: "Feeder" },
            { key: "ctRatio", label: "CT Ratio" },
            { key: "prev", label: "Prev" },
            { key: "curr", label: "Curr" },
            { key: "units", label: "Units" },
            { key: "mf", label: "MF" },
            { key: "sentOut", label: "Sent Out" },
            { key: "sharePercent", label: "Share %" },
            { key: "status", label: "Status" }
          ],
          rows: analysis.rows.map(function (row) {
            return {
              feederName: row.feederName,
              ctRatio: row.ctRatio,
              prev: formatNumber(row.prev, 0),
              curr: formatNumber(row.curr, 0),
              units: formatNumber(row.units, 2),
              mf: formatNumber(row.mf, 2),
              sentOut: formatNumber(row.sentOut, 2),
              sharePercent: formatPercent(row.sharePercent),
              status: row.status
            };
          }),
          emptyMessage: "No monthly consumption data is available for the selected filters."
        }]
      },
      analysis: analysis,
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function getShiftedMonthYear(year, month, monthOffset) {
    const baseDate = new Date(Number(year), Number(month) - 1 + monthOffset, 1);
    return {
      year: String(baseDate.getFullYear()),
      month: String(baseDate.getMonth() + 1).padStart(2, "0")
    };
  }

  function buildHistoricalMonthlyValueMap(state, monthCount) {
    const cache = {};
    let offset;

    for (offset = 1; offset <= monthCount; offset += 1) {
      const shifted = getShiftedMonthYear(state.year, state.month, -offset);
      const historyState = clone(state);
      historyState.year = shifted.year;
      historyState.month = shifted.month;
      historyState.feederGroup = "all";
      historyState.feederId = "";
      const analysis = buildMonthlyConsumptionAnalysis(historyState);
      cache[shifted.year + "-" + shifted.month] = analysis.rows.reduce(function (accumulator, row) {
        const baseValue = row.sentOut !== null ? row.sentOut : row.units;
        if (baseValue !== null) {
          accumulator[row.feederId] = Number(baseValue);
        }
        return accumulator;
      }, {});
    }

    return cache;
  }

  function getHistoricalAverageForFeeder(historyMap, feederId, limit) {
    const values = [];
    Object.keys(historyMap).sort().reverse().forEach(function (monthKey) {
      const monthValue = historyMap[monthKey][feederId];
      if (values.length < limit && Number.isFinite(Number(monthValue))) {
        values.push(Number(monthValue));
      }
    });
    return values.length ? average(values) : null;
  }

  function getAbnormalStatusDetails(row, recentAverage, thresholdMode) {
    const prevMissing = row.prev === null;
    const currMissing = row.curr === null;
    const units = row.units;
    const sentOut = row.sentOut;
    const baseValue = sentOut !== null ? sentOut : units;
    const sourceStatus = String(row.status || "");

    if (prevMissing || currMissing) {
      return {
        status: "Missing Reading",
        remark: "Opening or closing reading is missing for the selected month.",
        rowClass: "report-row-warning"
      };
    }

    if (sourceStatus.indexOf("Negative Difference Error") >= 0 || (units !== null && units < 0)) {
      return {
        status: "Negative Difference",
        remark: "Current reading is less than previous reading. Check meter or data entry.",
        rowClass: "report-row-error"
      };
    }

    if (sourceStatus.indexOf("Zero Consumption") >= 0 ||
      (units !== null && Math.abs(units) < 0.000001) ||
      (sentOut !== null && Math.abs(sentOut) < 0.000001)) {
      return {
        status: "Zero Consumption",
        remark: "No net monthly consumption was recorded for this feeder.",
        rowClass: "report-row-warning"
      };
    }

    if (baseValue === null) {
      return {
        status: "Missing Reading",
        remark: "Validated monthly units could not be derived from daily segments for this feeder.",
        rowClass: "report-row-warning"
      };
    }

    if (thresholdMode === "recent_average" && recentAverage !== null && baseValue !== null) {
      const lowLimit = recentAverage * (ABNORMAL_LOW_PERCENT_OF_AVERAGE / 100);
      const highLimit = recentAverage * (ABNORMAL_HIGH_PERCENT_OF_AVERAGE / 100);
      if (baseValue < lowLimit) {
        return {
          status: "Very Low Consumption",
          remark: "Current month is " + formatPercent((baseValue / recentAverage) * 100) + " of recent average " + formatNumber(recentAverage, 2) + ".",
          rowClass: "report-row-warning"
        };
      }
      if (baseValue > highLimit) {
        return {
          status: "Very High Consumption",
          remark: "Current month is " + formatPercent((baseValue / recentAverage) * 100) + " of recent average " + formatNumber(recentAverage, 2) + ".",
          rowClass: "report-row-error"
        };
      }
    }

    return {
      status: "Normal",
      remark: sourceStatus.indexOf("Meter Change") >= 0 ? "Meter change exists in this month. Review manually if needed." : "No abnormality detected from current rules.",
      rowClass: ""
    };
  }

  function buildAbnormalConsumptionAnalysis(state) {
    const consumptionAnalysis = buildMonthlyConsumptionAnalysis(state);
    const historyMap = state.thresholdMode === "recent_average" ? buildHistoricalMonthlyValueMap(state, 6) : {};
    const filteredRows = consumptionAnalysis.rows.filter(function (row) {
      return matchesFeederSelection(row.feeder, state.feederId);
    });

    const summaryCounts = {
      total: filteredRows.length,
      zero: 0,
      negative: 0,
      low: 0,
      high: 0,
      missing: 0
    };

    const rows = filteredRows.map(function (row) {
      const recentAverage = state.thresholdMode === "recent_average" ? getHistoricalAverageForFeeder(historyMap, row.feederId, 3) : null;
      const abnormal = getAbnormalStatusDetails(row, recentAverage, state.thresholdMode);

      if (abnormal.status === "Zero Consumption") {
        summaryCounts.zero += 1;
      } else if (abnormal.status === "Negative Difference") {
        summaryCounts.negative += 1;
      } else if (abnormal.status === "Very Low Consumption") {
        summaryCounts.low += 1;
      } else if (abnormal.status === "Very High Consumption") {
        summaryCounts.high += 1;
      } else if (abnormal.status === "Missing Reading") {
        summaryCounts.missing += 1;
      }

      return {
        feederName: row.feederName,
        prev: row.prev,
        curr: row.curr,
        units: row.units,
        mf: row.mf,
        sentOut: row.sentOut,
        status: abnormal.status,
        warningRemark: abnormal.remark,
        recentAverage: recentAverage,
        _rowClass: abnormal.rowClass
      };
    });

    return {
      rows: rows,
      summaryCounts: summaryCounts,
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "Month: " + getMonthLabel(state),
        "Feeder Group: " + String(state.feederGroup || "all"),
        state.feederId ? ("Feeder Filter: " + (rows[0] ? rows[0].feederName : "Selected")) : "Feeder Filter: All",
        "Threshold Mode: " + (state.thresholdMode === "recent_average" ? "Recent 3-Month Average" : "Basic Checks Only")
      ],
      note: state.thresholdMode === "recent_average"
        ? ("Very Low is below " + ABNORMAL_LOW_PERCENT_OF_AVERAGE + "% and Very High is above " + ABNORMAL_HIGH_PERCENT_OF_AVERAGE + "% of recent 3 available month average.")
        : "Only zero, negative, and missing-reading checks are applied in the current threshold mode."
    };
  }

  function buildAbnormalConsumptionView(state) {
    const analysis = buildAbnormalConsumptionAnalysis(state);
    return {
      dataset: {
        title: "Zero / Abnormal Consumption Report",
        subtitle: "Feeder-wise monthly abnormality detection for zero, negative, low, high, and missing consumption cases",
        tags: analysis.tags,
        summaryCards: [
          { label: "Total Feeders Checked", value: String(analysis.summaryCounts.total) },
          { label: "Zero Consumption", value: String(analysis.summaryCounts.zero) },
          { label: "Negative Difference", value: String(analysis.summaryCounts.negative) },
          { label: "Very Low Feeders", value: String(analysis.summaryCounts.low) },
          { label: "Very High Feeders", value: String(analysis.summaryCounts.high) },
          { label: "Missing Reading", value: String(analysis.summaryCounts.missing) }
        ],
        note: analysis.note,
        tables: [{
          title: "Abnormal Consumption Register",
          columns: [
            { key: "feederName", label: "Feeder" },
            { key: "prev", label: "Prev" },
            { key: "curr", label: "Curr" },
            { key: "units", label: "Units" },
            { key: "mf", label: "MF" },
            { key: "sentOut", label: "Sent Out" },
            { key: "status", label: "Status" },
            { key: "warningRemark", label: "Warning Remark" }
          ],
          rows: analysis.rows.map(function (row) {
            return {
              feederName: row.feederName,
              prev: formatNumber(row.prev, 0),
              curr: formatNumber(row.curr, 0),
              units: formatNumber(row.units, 2),
              mf: formatNumber(row.mf, 2),
              sentOut: formatNumber(row.sentOut, 2),
              status: row.status,
              warningRemark: row.warningRemark,
              _rowClass: row._rowClass
            };
          }),
          emptyMessage: "No feeder consumption abnormality rows are available for the selected month."
        }]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function buildMonthlyMinMaxAnalysis(state) {
    const range = getMonthRange(state);
    const monthRecords = getMonthDailyLogs(state);
    const feeders = getVisibleFeedersForSubstation(state, monthRecords).filter(function (feeder) {
      return matchesFeederGroup(feeder, state.feederGroup);
    });
    const expectedHours = (App.constants && App.constants.dailyHours ? App.constants.dailyHours.length : 25) * range.daysInMonth;

    const rows = feeders.map(function (feeder) {
      let maxEntry = null;
      let minEntry = null;
      let numericCount = 0;
      const dailyPeaks = [];
      const dailyMins = [];

      monthRecords.forEach(function (record) {
        const dailyValues = [];
        record.rows.forEach(function (row, rowIndex) {
          const ampValue = App.modules.dailylog.getNumericReadingValue(record, feeder.id, rowIndex, "amp");
          if (!Number.isFinite(ampValue)) {
            return;
          }

          numericCount += 1;
          dailyValues.push(ampValue);

          const entry = {
            value: ampValue,
            date: record.date,
            time: row.hour
          };

          if (!maxEntry || entry.value > maxEntry.value) {
            maxEntry = entry;
          }
          if (!minEntry || entry.value < minEntry.value) {
            minEntry = entry;
          }
        });

        if (dailyValues.length) {
          dailyPeaks.push(Math.max.apply(Math, dailyValues));
          dailyMins.push(Math.min.apply(Math, dailyValues));
        }
      });

      return {
        feederName: App.getFeederLabel(feeder),
        maxAmp: maxEntry ? maxEntry.value : null,
        maxDate: maxEntry ? maxEntry.date : "",
        maxTime: maxEntry ? maxEntry.time : "",
        minAmp: minEntry ? minEntry.value : null,
        minDate: minEntry ? minEntry.date : "",
        minTime: minEntry ? minEntry.time : "",
        avgDailyPeak: average(dailyPeaks),
        avgDailyMinimum: average(dailyMins),
        dataAvailability: expectedHours ? (numericCount / expectedHours) * 100 : null
      };
    });

    return {
      rows: rows,
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "Month: " + getMonthLabel(state),
        "Feeder Group: " + String(state.feederGroup || "all")
      ]
    };
  }

  function buildMonthlyMinMaxView(state) {
    const dailyAnalysis = buildDailyMinMaxAnalysis(state);
    const monthlyAnalysis = buildMonthlyMinMaxAnalysis(state);

    return {
      dataset: {
        title: "Min / Max Reports",
        subtitle: "Daily selected-date scan plus monthly feeder min/max aggregation",
        tags: [
          "Substation: " + getSubstationLabel(state.substationId),
          "Month: " + getMonthLabel(state),
          "Daily Reference: " + App.formatDate(state.date),
          "Feeder Group: " + String(state.feederGroup || "all")
        ],
        note: "Event-coded cells and blanks are ignored. Estimated numeric readings are included when present as numeric values.",
        tables: [
          {
            title: "Daily Min/Max Summary",
            columns: [
              { key: "feederName", label: "Feeder" },
              { key: "maxAmp", label: "Max Amp" },
              { key: "maxTime", label: "Max Time" },
              { key: "minAmp", label: "Min Amp" },
              { key: "minTime", label: "Min Time" },
              { key: "avgAmp", label: "Avg Amp" },
              { key: "maxKv", label: "Max KV" },
              { key: "minKv", label: "Min KV" }
            ],
            rows: dailyAnalysis.rows.map(function (row) {
              return {
                feederName: row.feederName,
                maxAmp: formatNumber(row.maxAmp, 2),
                maxTime: row.maxTime || "",
                minAmp: formatNumber(row.minAmp, 2),
                minTime: row.minTime || "",
                avgAmp: formatNumber(row.avgAmp, 2),
                maxKv: formatNumber(row.maxKv, 2),
                minKv: formatNumber(row.minKv, 2)
              };
            }),
            emptyMessage: "No daily min/max data is available for the selected date."
          },
          {
            title: "Monthly Min/Max",
            columns: [
              { key: "feederName", label: "Feeder" },
              { key: "maxAmp", label: "MAX Amp" },
              { key: "maxDate", label: "Date" },
              { key: "maxTime", label: "Time" },
              { key: "minAmp", label: "MIN Amp" },
              { key: "minDate", label: "Date" },
              { key: "minTime", label: "Time" },
              { key: "avgDailyPeak", label: "Avg Daily Peak" },
              { key: "avgDailyMinimum", label: "Avg Daily Minimum" },
              { key: "dataAvailability", label: "Data Availability %" }
            ],
            rows: monthlyAnalysis.rows.map(function (row) {
              return {
                feederName: row.feederName,
                maxAmp: formatNumber(row.maxAmp, 2),
                maxDate: row.maxDate ? App.formatDate(row.maxDate) : "",
                maxTime: row.maxTime || "",
                minAmp: formatNumber(row.minAmp, 2),
                minDate: row.minDate ? App.formatDate(row.minDate) : "",
                minTime: row.minTime || "",
                avgDailyPeak: formatNumber(row.avgDailyPeak, 2),
                avgDailyMinimum: formatNumber(row.avgDailyMinimum, 2),
                dataAvailability: formatPercent(row.dataAvailability)
              };
            }),
            emptyMessage: "No monthly feeder data is available for the selected month."
          }
        ]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function buildMonthlyInterruptionAnalysis(state) {
    const monthFaults = getMonthFaults(state);
    const feeders = getVisibleFeedersForSubstation(state, getMonthDailyLogs(state));
    const feederLabelMap = buildFeederLabelMap(feeders);
    const rowsByFeeder = {};
    const totals = {};

    INTERRUPTION_TYPES.forEach(function (type) {
      totals[type + "Qty"] = 0;
      totals[type + "Time"] = 0;
    });
    totals.totalQty = 0;
    totals.totalMinutes = 0;

    monthFaults.forEach(function (fault) {
      const type = String(fault.faultType || "").toUpperCase();
      if (INTERRUPTION_TYPES.indexOf(type) === -1) {
        return;
      }

      const feeder = fault.feederId ? feeders.find(function (item) {
        return item.id === fault.feederId;
      }) : feederLabelMap[fault.feederName];

      if (state.feederGroup !== "all" && (!feeder || !matchesFeederGroup(feeder, state.feederGroup))) {
        return;
      }

      const feederName = feeder ? App.getFeederLabel(feeder) : (fault.feederName || "Unknown Feeder");
      if (!rowsByFeeder[feederName]) {
        rowsByFeeder[feederName] = { feederName: feederName };
        INTERRUPTION_TYPES.forEach(function (faultType) {
          rowsByFeeder[feederName][faultType + "Qty"] = 0;
          rowsByFeeder[feederName][faultType + "Minutes"] = 0;
        });
        rowsByFeeder[feederName].totalQty = 0;
        rowsByFeeder[feederName].totalMinutes = 0;
      }

      rowsByFeeder[feederName][type + "Qty"] += 1;
      rowsByFeeder[feederName][type + "Minutes"] += Number(fault.durationMinutes || 0);
      rowsByFeeder[feederName].totalQty += 1;
      rowsByFeeder[feederName].totalMinutes += Number(fault.durationMinutes || 0);
      totals[type + "Qty"] += 1;
      totals[type + "Time"] += Number(fault.durationMinutes || 0);
      totals.totalQty += 1;
      totals.totalMinutes += Number(fault.durationMinutes || 0);
    });

    const rows = Object.keys(rowsByFeeder).sort().map(function (key) {
      const row = rowsByFeeder[key];
      const formatted = { feederName: row.feederName };
      INTERRUPTION_TYPES.forEach(function (type) {
        formatted[type + "Qty"] = String(row[type + "Qty"]);
        formatted[type + "Time"] = formatDurationText(row[type + "Minutes"]);
      });
      formatted.totalQty = String(row.totalQty);
      formatted.totalTime = formatDurationText(row.totalMinutes);
      return formatted;
    });

    const totalRow = {};
    INTERRUPTION_TYPES.forEach(function (type) {
      totalRow[type + "Qty"] = String(totals[type + "Qty"]);
      totalRow[type + "Time"] = formatDurationText(totals[type + "Time"]);
    });
    totalRow.totalQty = String(totals.totalQty);
    totalRow.totalTime = formatDurationText(totals.totalMinutes);

    return {
      rows: rows,
      totalRow: totalRow,
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "Month: " + getMonthLabel(state),
        "Feeder Group: " + String(state.feederGroup || "all"),
        "Total Fault Count: " + totals.totalQty,
        "Total Fault Duration: " + formatDurationText(totals.totalMinutes)
      ]
    };
  }

  function buildMonthlyInterruptionView(state) {
    const analysis = buildMonthlyInterruptionAnalysis(state);
    return {
      dataset: {
        title: "Monthly Interruption Report",
        subtitle: "Feeder-wise interruption matrix for manual and automatic fault records",
        tags: analysis.tags,
        tables: [{
          title: "Monthly Interruption Matrix",
          kind: "interruption-matrix",
          rows: analysis.rows,
          totalRow: analysis.totalRow,
          emptyMessage: "No interruption records are available for the selected month."
        }]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function getEventImpactRange(state) {
    const monthRange = getMonthRange(state);
    let fromDate = String(state.startDate || "").trim();
    let toDate = String(state.endDate || "").trim();

    if (!isValidDateString(fromDate)) {
      fromDate = monthRange.start;
    }
    if (!isValidDateString(toDate)) {
      toDate = monthRange.end;
    }

    if (fromDate > toDate) {
      return {
        fromDate: toDate,
        toDate: fromDate
      };
    }

    return {
      fromDate: fromDate,
      toDate: toDate
    };
  }

  function getFaultsForRange(filterOptions) {
    const options = filterOptions || {};
    return App.storage.getCollection("faults").filter(function (fault) {
      if (options.substationId && fault.substationId !== options.substationId) {
        return false;
      }
      if (options.fromDate && fault.date < options.fromDate) {
        return false;
      }
      if (options.toDate && fault.date > options.toDate) {
        return false;
      }
      if (!matchesEventTypeSelection(fault.faultType, options.eventType)) {
        return false;
      }
      return true;
    });
  }

  function buildEventImpactAnalysis(state) {
    const range = getEventImpactRange(state);
    const feeders = getVisibleFeedersForSubstation(state, getMonthDailyLogs(state));
    const feederLabelMap = buildFeederLabelMap(feeders);
    const selectedFeeder = feeders.find(function (item) {
      return item.id === state.feederId;
    }) || null;
    const filteredFaults = getFaultsForRange({
      substationId: state.substationId,
      fromDate: range.fromDate,
      toDate: range.toDate,
      eventType: state.eventType
    }).filter(function (fault) {
      const feeder = fault.feederId ? feeders.find(function (item) {
        return item.id === fault.feederId;
      }) : feederLabelMap[fault.feederName];

      if (!matchesFeederSelection(feeder || { id: "" }, state.feederId)) {
        return false;
      }
      if (state.feederGroup !== "all" && (!feeder || !matchesFeederGroup(feeder, state.feederGroup))) {
        return false;
      }
      return true;
    });

    const rowsByKey = {};
    const feederTotals = {};
    const eventTypeTotals = {};
    let totalDuration = 0;
    let longestEvent = null;

    filteredFaults.forEach(function (fault) {
      const faultType = String(fault.faultType || "").trim().toUpperCase();
      if (EVENT_IMPACT_TYPES.indexOf(faultType) === -1) {
        return;
      }

      const feeder = fault.feederId ? feeders.find(function (item) {
        return item.id === fault.feederId;
      }) : feederLabelMap[fault.feederName];
      const feederName = feeder ? App.getFeederLabel(feeder) : (fault.feederName || "Unknown Feeder");
      const key = feederName + "||" + faultType;

      if (!rowsByKey[key]) {
        rowsByKey[key] = {
          feederName: feederName,
          eventType: faultType,
          eventCount: 0,
          totalMinutes: 0,
          longestMinutes: null,
          longestDate: "",
          shortestMinutes: null,
          affectedDays: {}
        };
      }

      const minutes = Number(fault.durationMinutes || 0);
      const row = rowsByKey[key];
      row.eventCount += 1;
      row.totalMinutes += minutes;
      row.affectedDays[fault.date] = true;

      if (row.longestMinutes === null || minutes > row.longestMinutes) {
        row.longestMinutes = minutes;
        row.longestDate = fault.date;
      }
      if (row.shortestMinutes === null || minutes < row.shortestMinutes) {
        row.shortestMinutes = minutes;
      }

      if (!feederTotals[feederName]) {
        feederTotals[feederName] = { count: 0, minutes: 0 };
      }
      feederTotals[feederName].count += 1;
      feederTotals[feederName].minutes += minutes;

      eventTypeTotals[faultType] = (eventTypeTotals[faultType] || 0) + 1;
      totalDuration += minutes;

      if (!longestEvent || minutes > longestEvent.minutes) {
        longestEvent = {
          minutes: minutes,
          feederName: feederName,
          faultType: faultType,
          date: fault.date
        };
      }
    });

    const rows = Object.keys(rowsByKey).sort().map(function (key) {
      const row = rowsByKey[key];
      return {
        feederName: row.feederName,
        eventType: row.eventType,
        eventCount: row.eventCount,
        totalDuration: formatDurationText(row.totalMinutes),
        averageDuration: formatDurationText(row.eventCount ? Math.round(row.totalMinutes / row.eventCount) : 0),
        longestEventDuration: formatDurationText(row.longestMinutes || 0),
        longestEventDate: row.longestDate ? App.formatDate(row.longestDate) : "",
        shortestEventDuration: formatDurationText(row.shortestMinutes || 0),
        affectedDaysCount: String(Object.keys(row.affectedDays).length)
      };
    });

    const rankedFeeders = Object.keys(feederTotals).map(function (feederName) {
      return {
        feederName: feederName,
        eventCount: feederTotals[feederName].count,
        totalDuration: feederTotals[feederName].minutes
      };
    }).sort(function (left, right) {
      if (right.totalDuration !== left.totalDuration) {
        return right.totalDuration - left.totalDuration;
      }
      return right.eventCount - left.eventCount;
    });

    const leastAffected = rankedFeeders.slice().sort(function (left, right) {
      if (left.totalDuration !== right.totalDuration) {
        return left.totalDuration - right.totalDuration;
      }
      return left.eventCount - right.eventCount;
    });

    const mostFrequentEventType = Object.keys(eventTypeTotals).sort(function (left, right) {
      return eventTypeTotals[right] - eventTypeTotals[left];
    })[0] || "";

    return {
      rows: rows,
      mostInterrupted: rankedFeeders.slice(0, 5),
      leastInterrupted: leastAffected.slice(0, 5),
      summaryCards: [
        { label: "Total Events", value: String(filteredFaults.length) },
        { label: "Total Duration", value: formatDurationText(totalDuration) },
        { label: "Most Affected Feeder", value: rankedFeeders[0] ? rankedFeeders[0].feederName : "-" },
        { label: "Most Frequent Type", value: mostFrequentEventType || "-" },
        { label: "Longest Interruption", value: longestEvent ? (formatDurationText(longestEvent.minutes) + " | " + longestEvent.feederName + " | " + longestEvent.faultType + " | " + App.formatDate(longestEvent.date)) : "-" },
        { label: "Least Affected Feeder", value: leastAffected[0] ? leastAffected[0].feederName : "-" }
      ],
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "From: " + App.formatDate(range.fromDate),
        "To: " + App.formatDate(range.toDate),
        "Feeder Group: " + String(state.feederGroup || "all"),
        state.feederId ? ("Feeder Filter: " + (selectedFeeder ? App.getFeederLabel(selectedFeeder) : "Selected")) : "Feeder Filter: All",
        "Event Type: " + (state.eventType === "all" ? "All" : state.eventType)
      ],
      note: "Grouped by feeder and event type using saved interruption records. Average duration is calculated from total duration divided by event count."
    };
  }

  function buildEventImpactView(state) {
    const analysis = buildEventImpactAnalysis(state);
    return {
      dataset: {
        title: "Event Impact Report",
        subtitle: "Feeder-wise event impact summary for the selected date range",
        tags: analysis.tags,
        summaryCards: analysis.summaryCards,
        note: analysis.note,
        tables: [
          {
            title: "Event Impact Summary",
            columns: [
              { key: "feederName", label: "Feeder" },
              { key: "eventType", label: "Event Type" },
              { key: "eventCount", label: "Event Count" },
              { key: "totalDuration", label: "Total Duration" },
              { key: "averageDuration", label: "Average Duration" },
              { key: "longestEventDuration", label: "Longest Event Duration" },
              { key: "longestEventDate", label: "Longest Event Date" },
              { key: "shortestEventDuration", label: "Shortest Event Duration" },
              { key: "affectedDaysCount", label: "Affected Days Count" }
            ],
            rows: analysis.rows,
            emptyMessage: "No event impact rows are available for the selected filters."
          },
          {
            title: "Top 5 Most Interrupted Feeders",
            columns: [
              { key: "feederName", label: "Feeder" },
              { key: "eventCount", label: "Event Count" },
              { key: "totalDuration", label: "Total Duration" }
            ],
            rows: analysis.mostInterrupted.map(function (row) {
              return {
                feederName: row.feederName,
                eventCount: String(row.eventCount),
                totalDuration: formatDurationText(row.totalDuration)
              };
            }),
            emptyMessage: "No feeder ranking data is available."
          },
          {
            title: "Top 5 Least Interrupted Feeders",
            columns: [
              { key: "feederName", label: "Feeder" },
              { key: "eventCount", label: "Event Count" },
              { key: "totalDuration", label: "Total Duration" }
            ],
            rows: analysis.leastInterrupted.map(function (row) {
              return {
                feederName: row.feederName,
                eventCount: String(row.eventCount),
                totalDuration: formatDurationText(row.totalDuration)
              };
            }),
            emptyMessage: "No feeder ranking data is available."
          }
        ]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function getCompletenessStatus(completenessPercent) {
    const value = Number(completenessPercent);
    if (!Number.isFinite(value)) {
      return "Poor Data";
    }
    if (value >= 98) {
      return "Complete";
    }
    if (value >= 90) {
      return "Mostly Complete";
    }
    if (value >= 70) {
      return "Partial Data";
    }
    return "Poor Data";
  }

  function calculateFeederCompletenessStats(record, feederId) {
    let numericCount = 0;
    let eventCount = 0;

    asArray(record && record.rows).forEach(function (row, rowIndex) {
      const eventType = App.modules.dailylog.getAppliedEventType(record, feederId, rowIndex);
      if (eventType) {
        eventCount += 1;
        return;
      }

      const ampValue = App.modules.dailylog.getNumericReadingValue(record, feederId, rowIndex, "amp");
      const kvValue = App.modules.dailylog.getNumericReadingValue(record, feederId, rowIndex, "kv");
      const kwhValue = App.modules.dailylog.getNumericReadingValue(record, feederId, rowIndex, "kwh");
      if (Number.isFinite(ampValue) || Number.isFinite(kvValue) || Number.isFinite(kwhValue)) {
        numericCount += 1;
      }
    });

    return {
      numericCount: numericCount,
      eventCount: eventCount
    };
  }

  function buildDataCompletenessAnalysis(state) {
    const range = getMonthRange(state);
    const monthRecords = getMonthDailyLogs(state);
    const recordMap = monthRecords.reduce(function (accumulator, record) {
      accumulator[record.date] = record;
      return accumulator;
    }, {});
    const feeders = getVisibleFeedersForSubstation(state, monthRecords).filter(function (feeder) {
      return matchesFeederGroup(feeder, state.feederGroup) && matchesFeederSelection(feeder, state.feederId);
    });
    const expectedSlotsPerDay = App.constants && App.constants.dailyHours ? App.constants.dailyHours.length : 25;
    const expectedRecords = range.daysInMonth * expectedSlotsPerDay;
    const selectedFeeder = feeders.find(function (feeder) {
      return feeder.id === state.feederId;
    });
    const rows = [];
    let totalMissing = 0;
    let totalEvent = 0;
    let completenessTotal = 0;

    feeders.forEach(function (feeder) {
      let numericCount = 0;
      let eventCount = 0;
      let dayIndex;

      for (dayIndex = 1; dayIndex <= range.daysInMonth; dayIndex += 1) {
        const dateValue = String(state.year) + "-" + String(state.month).padStart(2, "0") + "-" + String(dayIndex).padStart(2, "0");
        const record = recordMap[dateValue];
        if (!record) {
          continue;
        }

        const dailyStats = calculateFeederCompletenessStats(record, feeder.id);
        numericCount += dailyStats.numericCount;
        eventCount += dailyStats.eventCount;
      }

      const missingCount = Math.max(0, expectedRecords - numericCount - eventCount);
      const completenessPercent = expectedRecords ? (((numericCount + eventCount) / expectedRecords) * 100) : 0;
      const numericPercent = expectedRecords ? ((numericCount / expectedRecords) * 100) : 0;
      const eventPercent = expectedRecords ? ((eventCount / expectedRecords) * 100) : 0;
      const missingPercent = expectedRecords ? ((missingCount / expectedRecords) * 100) : 0;
      const status = getCompletenessStatus(completenessPercent);

      rows.push({
        feederName: App.getFeederLabel(feeder),
        expectedRecords: expectedRecords,
        numericRecords: numericCount,
        eventRecords: eventCount,
        missingRecords: missingCount,
        completenessPercent: completenessPercent,
        numericPercent: numericPercent,
        eventPercent: eventPercent,
        missingPercent: missingPercent,
        status: status,
        rowClass: completenessPercent < 70 ? "report-row-error" : (completenessPercent < 90 ? "report-row-warning" : "")
      });

      totalMissing += missingCount;
      totalEvent += eventCount;
      completenessTotal += completenessPercent;
    });

    const sortedByCompleteness = rows.slice().sort(function (left, right) {
      return right.completenessPercent - left.completenessPercent;
    });

    return {
      rows: rows,
      summaryCards: [
        { label: "Total Feeders Checked", value: String(rows.length) },
        { label: "Best Feeder Completeness", value: sortedByCompleteness[0] ? (sortedByCompleteness[0].feederName + " | " + formatPercent(sortedByCompleteness[0].completenessPercent)) : "-" },
        { label: "Worst Feeder Completeness", value: sortedByCompleteness.length ? (sortedByCompleteness[sortedByCompleteness.length - 1].feederName + " | " + formatPercent(sortedByCompleteness[sortedByCompleteness.length - 1].completenessPercent)) : "-" },
        { label: "Average Completeness", value: rows.length ? formatPercent(completenessTotal / rows.length) : "0.00%" },
        { label: "Total Missing Records", value: String(totalMissing) },
        { label: "Total Event-coded Records", value: String(totalEvent) }
      ],
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "Month: " + getMonthLabel(state),
        "Feeder Group: " + String(state.feederGroup || "all"),
        state.feederId ? ("Feeder Filter: " + (selectedFeeder ? App.getFeederLabel(selectedFeeder) : "Selected")) : "Feeder Filter: All"
      ],
      note: "Expected records are days in selected month multiplied by expected hourly slots. Completeness includes numeric and event-coded entries. Estimated numeric readings count as numeric records.",
      totalMissing: totalMissing,
      totalEvent: totalEvent
    };
  }

  function buildDataCompletenessView(state) {
    const analysis = buildDataCompletenessAnalysis(state);
    return {
      dataset: {
        title: "Data Completeness Report",
        subtitle: "Monthly feeder-wise audit of numeric, event-coded, and missing operational data",
        tags: analysis.tags,
        summaryCards: analysis.summaryCards,
        note: analysis.note,
        tables: [{
          title: "Monthly Data Completeness",
          columns: [
            { key: "feederName", label: "Feeder" },
            { key: "expectedRecords", label: "Expected Records" },
            { key: "numericRecords", label: "Available Numeric Records" },
            { key: "eventRecords", label: "Event-coded Records" },
            { key: "missingRecords", label: "Blank / Missing Records" },
            { key: "completenessPercent", label: "Completeness %" },
            { key: "numericPercent", label: "Numeric %" },
            { key: "eventPercent", label: "Event %" },
            { key: "missingPercent", label: "Missing %" },
            { key: "status", label: "Status" }
          ],
          rows: analysis.rows.map(function (row) {
            return {
              feederName: row.feederName,
              expectedRecords: String(row.expectedRecords),
              numericRecords: String(row.numericRecords),
              eventRecords: String(row.eventRecords),
              missingRecords: String(row.missingRecords),
              completenessPercent: formatPercent(row.completenessPercent),
              numericPercent: formatPercent(row.numericPercent),
              eventPercent: formatPercent(row.eventPercent),
              missingPercent: formatPercent(row.missingPercent),
              status: row.status,
              _rowClass: row.rowClass
            };
          }),
          emptyMessage: "No feeder completeness data is available for the selected month."
        }]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function buildMonthlyEnergyBalanceAnalysis(state, consumptionAnalysis) {
    const analysis = consumptionAnalysis || buildMonthlyConsumptionAnalysis(state);
    const rowMap = analysis.rows.reduce(function (accumulator, row) {
      accumulator[row.feederId] = row;
      return accumulator;
    }, {});
    const feeders = analysis.rows.map(function (row) {
      return row.feeder;
    });
    const mainIncomers = feeders.filter(function (feeder) {
      return App.isMainIncFeeder(feeder) && matchesFeederGroup(feeder, state.feederGroup);
    });

    const rows = mainIncomers.map(function (feeder) {
      const input = rowMap[feeder.id] && rowMap[feeder.id].sentOut !== null ? rowMap[feeder.id].sentOut : null;

      // AUDIT-FIX HIGH-04: Track whether any child feeder has missing (null) sentOut.
      // Do NOT coerce null to zero — missing child data must be flagged separately.
      var childHasPartialData = false;
      var childOutgoingTotal = 0;

      feeders.filter(function (candidate) {
        return candidate.parentFeederId === feeder.id && App.is11KvOutgoingFeeder(candidate);
      }).forEach(function (childFeeder) {
        const childRow = rowMap[childFeeder.id];
        if (childRow && childRow.sentOut !== null) {
          childOutgoingTotal += childRow.sentOut;
        } else {
          // Child feeder is present in config but has no sentOut data this month.
          childHasPartialData = true;
        }
      });

      const lossUnits = input !== null ? Number((input - childOutgoingTotal).toFixed(2)) : null;
      const lossPercent = input && input !== 0 ? Number(((lossUnits / input) * 100).toFixed(2)) : null;

      let remark = "Normal";
      if (input === null) {
        remark = "No Incomer Data";
      } else if (childHasPartialData) {
        remark = "Incomplete Child Data";
      } else if (lossUnits < 0) {
        remark = "Negative / Check MF or mapping";
      } else if (lossPercent !== null && Math.abs(lossPercent) > ENERGY_BALANCE_ALERT_PERCENT) {
        remark = "Abnormal / High Loss";
      }

      return {
        incomerName: App.getFeederLabel(feeder),
        inputSentOut: input,
        childOutgoingTotal: Number(childOutgoingTotal.toFixed(2)),
        lossUnits: lossUnits,
        lossPercent: lossPercent,
        childHasPartialData: childHasPartialData,
        remark: remark
      };
    });

    const totals = rows.reduce(function (accumulator, row) {
      accumulator.inputSentOut += row.inputSentOut !== null ? row.inputSentOut : 0;
      accumulator.childOutgoingTotal += row.childOutgoingTotal !== null ? row.childOutgoingTotal : 0;
      accumulator.hasPartialData = accumulator.hasPartialData || row.childHasPartialData;
      return accumulator;
    }, {
      inputSentOut: 0,
      childOutgoingTotal: 0,
      hasPartialData: false
    });
    totals.lossUnits = Number((totals.inputSentOut - totals.childOutgoingTotal).toFixed(2));
    totals.lossPercent = totals.inputSentOut ? Number(((totals.lossUnits / totals.inputSentOut) * 100).toFixed(2)) : null;

    return {
      rows: rows,
      totals: totals,
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "Month: " + getMonthLabel(state),
        "Feeder Group: " + String(state.feederGroup || "all")
      ]
    };
  }

  // AUDIT-FIX HIGH-04: Energy Balance view — surface partial child data in remark column.
  function buildMonthlyEnergyBalanceView(state, consumptionAnalysis) {
    const analysis = buildMonthlyEnergyBalanceAnalysis(state, consumptionAnalysis);
    const rows = analysis.rows.map(function (row) {
      return {
        incomerName: row.incomerName,
        inputSentOut: formatNumber(row.inputSentOut, 2),
        childOutgoingTotal: formatNumber(row.childOutgoingTotal, 2),
        lossUnits: row.lossUnits !== null ? formatNumber(row.lossUnits, 2) : "-",
        lossPercent: row.lossPercent !== null ? formatPercent(row.lossPercent) : "-",
        remark: row.remark
      };
    });

    if (rows.length) {
      rows.push({
        incomerName: "Grand Total",
        inputSentOut: formatNumber(analysis.totals.inputSentOut, 2),
        childOutgoingTotal: formatNumber(analysis.totals.childOutgoingTotal, 2),
        lossUnits: formatNumber(analysis.totals.lossUnits, 2),
        lossPercent: analysis.totals.lossPercent !== null ? formatPercent(analysis.totals.lossPercent) : "-",
        remark: analysis.totals.hasPartialData
          ? "Incomplete Child Data in one or more groups"
          : (analysis.totals.lossUnits < 0 ? "Negative / Check Mapping" : "Summary")
      });
    }

    return {
      dataset: {
        title: "Monthly Energy Balance / Loss Report",
        subtitle: "Main incomer sent out versus child outgoing total for the selected month",
        tags: analysis.tags,
        tables: [{
          title: "Energy Balance / Loss",
          columns: [
            { key: "incomerName", label: "Group / Incomer" },
            { key: "inputSentOut", label: "Input Sent Out" },
            { key: "childOutgoingTotal", label: "Child Outgoing Total" },
            { key: "lossUnits", label: "Loss Units" },
            { key: "lossPercent", label: "Loss %" },
            { key: "remark", label: "Remark" }
          ],
          rows: rows,
          emptyMessage: "No main incomer energy balance rows are available for the selected month."
        }]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  // AUDIT-FIX HIGH-05: Remove null-to-zero coercion in reconciliation status.
  // getReconciliationStatus now receives null values as null, not 0.
  function getReconciliationStatus(inputSentOut, childOutgoingTotal, differenceUnits, differencePercent) {
    // Explicit missing-data check: null inputSentOut or null differenceUnits
    if (inputSentOut === null || !Number.isFinite(Number(inputSentOut))) {
      return {
        status: "Missing Data",
        remark: "Main incomer input sent out is missing or unavailable for the selected month.",
        rowClass: "report-row-warning"
      };
    }

    if (Math.abs(Number(inputSentOut)) < 0.000001) {
      return {
        status: "Zero Input",
        remark: "Main incomer input is zero for the selected month.",
        rowClass: "report-row-warning"
      };
    }

    if (differenceUnits === null || !Number.isFinite(Number(differenceUnits))) {
      return {
        status: "Missing Data",
        remark: "Difference could not be calculated — one or more values are missing.",
        rowClass: "report-row-warning"
      };
    }

    if (differenceUnits < 0) {
      return {
        status: "Negative Difference / Data Mismatch",
        remark: "Child outgoing total is greater than main incomer input. Check mapping, MF, or readings.",
        rowClass: "report-row-error"
      };
    }

    if (differencePercent !== null && differencePercent <= 2) {
      return {
        status: "Balanced",
        remark: "Difference is within balanced tolerance.",
        rowClass: ""
      };
    }

    if (differencePercent !== null && differencePercent <= 6) {
      return {
        status: "Acceptable Loss",
        remark: "Difference is above balanced tolerance but still within acceptable monthly loss range.",
        rowClass: "report-row-warning"
      };
    }

    if (differencePercent === null) {
      return {
        status: "Missing Data",
        remark: "Loss percentage could not be calculated.",
        rowClass: "report-row-warning"
      };
    }

    return {
      status: "High Loss",
      remark: "Difference is above the acceptable loss threshold. Review feeder mapping and readings.",
      rowClass: "report-row-error"
    };
  }

  function buildMainIncReconciliationAnalysis(state, consumptionAnalysis) {
    const analysis = consumptionAnalysis || buildMonthlyConsumptionAnalysis(state);
    const rowMap = analysis.rows.reduce(function (accumulator, row) {
      accumulator[row.feederId] = row;
      return accumulator;
    }, {});
    const feeders = analysis.rows.map(function (row) {
      return row.feeder;
    });
    function matchesReconciliationGroup(mainIncomer, groupValue) {
      const group = String(groupValue || "all");
      if (group.indexOf("parent:") === 0) {
        return group.split(":")[1] === mainIncomer.id;
      }
      return true;
    }
    const mainIncomers = App.sortFeeders(feeders).filter(function (feeder) {
      if (!App.isMainIncFeeder(feeder)) {
        return false;
      }
      if (state.mainIncomerId && feeder.id !== state.mainIncomerId) {
        return false;
      }
      return matchesReconciliationGroup(feeder, state.feederGroup);
    });
    const detailRows = [];
    let totalInputSentOut = 0;
    let totalChildOutgoing = 0;

    const rows = mainIncomers.map(function (feeder) {
      const inputRow = rowMap[feeder.id];
      const inputSentOut = inputRow && inputRow.sentOut !== null ? inputRow.sentOut : null;
      const childFeeders = App.sortFeeders(feeders.filter(function (candidate) {
        return candidate.parentFeederId === feeder.id && App.is11KvOutgoingFeeder(candidate);
      }));
      const childDetails = childFeeders.map(function (childFeeder) {
        const childRow = rowMap[childFeeder.id];
        const childSentOut = childRow && childRow.sentOut !== null ? childRow.sentOut : null;
        return {
          mainIncomerName: App.getFeederLabel(feeder),
          childFeederName: App.getFeederLabel(childFeeder),
          childSentOut: childSentOut,
          childStatus: childSentOut === null ? "No Data" : "Mapped",
          shareOfGroup: inputSentOut && childSentOut !== null ? Number(((childSentOut / inputSentOut) * 100).toFixed(2)) : null
        };
      });
      const childOutgoingTotal = childDetails.reduce(function (sum, childItem) {
        return sum + (childItem.childSentOut !== null ? childItem.childSentOut : 0);
      }, 0);
      const differenceUnits = inputSentOut !== null ? Number((inputSentOut - childOutgoingTotal).toFixed(2)) : null;
      const differencePercent = inputSentOut && inputSentOut !== 0 && differenceUnits !== null
        ? Number(((differenceUnits / inputSentOut) * 100).toFixed(2))
        : null;
      // AUDIT-FIX HIGH-05: Pass null values as null — do NOT coerce to 0.
      const statusInfo = getReconciliationStatus(
        inputSentOut,
        childOutgoingTotal,
        differenceUnits,
        differencePercent
      );

      childDetails.forEach(function (childItem) {
        detailRows.push({
          mainIncomerName: childItem.mainIncomerName,
          childFeederName: childItem.childFeederName,
          childSentOut: childItem.childSentOut,
          shareOfGroup: childItem.shareOfGroup,
          childStatus: childItem.childStatus
        });
      });

      totalInputSentOut += inputSentOut !== null ? inputSentOut : 0;
      totalChildOutgoing += childOutgoingTotal;

      return {
        mainIncomerName: App.getFeederLabel(feeder),
        inputSentOut: inputSentOut,
        childFeedersCount: childFeeders.length,
        childOutgoingTotal: Number(childOutgoingTotal.toFixed(2)),
        differenceUnits: differenceUnits,
        differencePercent: differencePercent,
        status: statusInfo.status,
        remark: statusInfo.remark,
        rowClass: statusInfo.rowClass
      };
    });

    const netDifference = Number((totalInputSentOut - totalChildOutgoing).toFixed(2));
    const netLossPercent = totalInputSentOut ? Number(((netDifference / totalInputSentOut) * 100).toFixed(2)) : null;
    const highestMismatchRow = rows.slice().sort(function (left, right) {
      const rightValue = right.differencePercent !== null ? Math.abs(right.differencePercent) : Math.abs(right.differenceUnits || 0);
      const leftValue = left.differencePercent !== null ? Math.abs(left.differencePercent) : Math.abs(left.differenceUnits || 0);
      return rightValue - leftValue;
    })[0] || null;

    return {
      rows: rows,
      detailRows: detailRows,
      summaryCards: [
        { label: "Total Groups Checked", value: String(rows.length) },
        { label: "Total Input Sent Out", value: formatNumber(totalInputSentOut, 2) || "0" },
        { label: "Total Child Outgoing", value: formatNumber(totalChildOutgoing, 2) || "0" },
        { label: "Net Difference", value: formatNumber(netDifference, 2) || "0" },
        { label: "Net Loss %", value: formatPercent(netLossPercent) || "-" },
        { label: "Highest Mismatch Group", value: highestMismatchRow ? (highestMismatchRow.mainIncomerName + " | " + (formatPercent(highestMismatchRow.differencePercent) || highestMismatchRow.status)) : "-" }
      ],
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "Month: " + getMonthLabel(state),
        "Feeder Group: " + String(state.feederGroup || "all"),
        state.mainIncomerId ? ("Main Incomer: " + (mainIncomers[0] ? App.getFeederLabel(mainIncomers[0]) : "Selected")) : "Main Incomer: All"
      ],
      note: "Input sent out comes from the main incomer monthly sent out. Child outgoing total is the sum of mapped outgoing feeders under that incomer.",
      totals: {
        totalInputSentOut: totalInputSentOut,
        totalChildOutgoing: totalChildOutgoing,
        netDifference: netDifference,
        netLossPercent: netLossPercent
      }
    };
  }

  function buildMainIncReconciliationView(state, consumptionAnalysis) {
    const analysis = buildMainIncReconciliationAnalysis(state, consumptionAnalysis);
    return {
      dataset: {
        title: "Main INC vs Child Reconciliation Report",
        subtitle: "Monthly main incomer energy versus mapped child outgoing feeder sent out summary",
        tags: analysis.tags,
        summaryCards: analysis.summaryCards,
        note: analysis.note,
        tables: [{
          title: "Main Incomer Reconciliation",
          columns: [
            { key: "mainIncomerName", label: "Main Incomer" },
            { key: "inputSentOut", label: "Input Sent Out" },
            { key: "childFeedersCount", label: "Child Feeders Count" },
            { key: "childOutgoingTotal", label: "Child Outgoing Total" },
            { key: "differenceUnits", label: "Difference Units" },
            { key: "differencePercent", label: "Difference %" },
            { key: "status", label: "Status" },
            { key: "remark", label: "Remark" }
          ],
          rows: analysis.rows.map(function (row) {
            return {
              mainIncomerName: row.mainIncomerName,
              inputSentOut: formatNumber(row.inputSentOut, 2),
              childFeedersCount: String(row.childFeedersCount),
              childOutgoingTotal: formatNumber(row.childOutgoingTotal, 2),
              differenceUnits: formatNumber(row.differenceUnits, 2),
              differencePercent: formatPercent(row.differencePercent),
              status: row.status,
              remark: row.remark,
              _rowClass: row.rowClass
            };
          }),
          emptyMessage: "No main incomer reconciliation rows are available for the selected month."
        }, {
          title: "Mapped Child Feeders",
          columns: [
            { key: "mainIncomerName", label: "Main Incomer" },
            { key: "childFeederName", label: "Child Feeder" },
            { key: "childSentOut", label: "Child Sent Out" },
            { key: "shareOfGroup", label: "Share of Group %" },
            { key: "childStatus", label: "Status" }
          ],
          rows: analysis.detailRows.map(function (row) {
            return {
              mainIncomerName: row.mainIncomerName,
              childFeederName: row.childFeederName,
              childSentOut: formatNumber(row.childSentOut, 2),
              shareOfGroup: formatPercent(row.shareOfGroup),
              childStatus: row.childStatus
            };
          }),
          emptyMessage: "No mapped child feeders are available for the selected incomer or group."
        }]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function buildFeederLoadTrendAnalysis(state) {
    const range = getMonthRange(state);
    const monthRecords = getMonthDailyLogs(state);
    const feeders = getVisibleFeedersForSubstation(state, monthRecords).filter(function (feeder) {
      return matchesFeederGroup(feeder, state.feederGroup) && matchesFeederSelection(feeder, state.feederId);
    });
    const expectedHoursPerDay = App.constants && App.constants.dailyHours ? App.constants.dailyHours.length : 25;
    const detailRows = [];
    const summaryByFeeder = {};

    feeders.forEach(function (feeder) {
      summaryByFeeder[feeder.id] = {
        feederName: App.getFeederLabel(feeder),
        highestPeakAmp: null,
        highestPeakDate: "",
        highestPeakTime: "",
        lowestAmp: null,
        lowestAmpDate: "",
        lowestAmpTime: "",
        ampTotal: 0,
        ampCount: 0,
        validReadingDays: 0
      };
    });

    monthRecords.forEach(function (record) {
      feeders.forEach(function (feeder) {
        let maxAmp = null;
        let maxTime = "";
        let minAmp = null;
        let minTime = "";
        let ampValues = [];
        let kvValues = [];

        record.rows.forEach(function (row, rowIndex) {
          const ampValue = App.modules.dailylog.getNumericReadingValue(record, feeder.id, rowIndex, "amp");
          const kvValue = App.modules.dailylog.getNumericReadingValue(record, feeder.id, rowIndex, "kv");

          if (Number.isFinite(ampValue)) {
            ampValues.push(ampValue);
            if (maxAmp === null || ampValue > maxAmp) {
              maxAmp = ampValue;
              maxTime = row.hour;
            }
            if (minAmp === null || ampValue < minAmp) {
              minAmp = ampValue;
              minTime = row.hour;
            }
          }

          if (Number.isFinite(kvValue)) {
            kvValues.push(kvValue);
          }
        });

        if (!ampValues.length) {
          return;
        }

        const dailyAverageAmp = average(ampValues);
        const dailyMaxKv = kvValues.length ? Math.max.apply(Math, kvValues) : null;
        const dailyMinKv = kvValues.length ? Math.min.apply(Math, kvValues) : null;

        detailRows.push({
          date: record.date,
          feederId: feeder.id,
          feederName: App.getFeederLabel(feeder),
          dailyPeakAmp: maxAmp,
          peakTime: maxTime,
          dailyMinimumAmp: minAmp,
          minimumTime: minTime,
          dailyAverageAmp: dailyAverageAmp,
          dailyMaxKv: dailyMaxKv,
          dailyMinKv: dailyMinKv
        });

        const summary = summaryByFeeder[feeder.id];
        summary.validReadingDays += 1;
        summary.ampTotal += ampValues.reduce(function (sum, item) {
          return sum + item;
        }, 0);
        summary.ampCount += ampValues.length;

        if (summary.highestPeakAmp === null || maxAmp > summary.highestPeakAmp) {
          summary.highestPeakAmp = maxAmp;
          summary.highestPeakDate = record.date;
          summary.highestPeakTime = maxTime;
        }
        if (summary.lowestAmp === null || minAmp < summary.lowestAmp) {
          summary.lowestAmp = minAmp;
          summary.lowestAmpDate = record.date;
          summary.lowestAmpTime = minTime;
        }
      });
    });

    const summaryRows = feeders.map(function (feeder) {
      const summary = summaryByFeeder[feeder.id];
      const dataAvailability = range.daysInMonth ? ((summary.ampCount / (range.daysInMonth * expectedHoursPerDay)) * 100) : null;
      return {
        feederName: summary.feederName,
        highestPeakAmp: summary.highestPeakAmp,
        highestPeakDate: summary.highestPeakDate,
        highestPeakTime: summary.highestPeakTime,
        lowestAmp: summary.lowestAmp,
        lowestAmpDate: summary.lowestAmpDate,
        lowestAmpTime: summary.lowestAmpTime,
        monthlyAverageAmp: summary.ampCount ? (summary.ampTotal / summary.ampCount) : null,
        validReadingDays: summary.validReadingDays,
        dataAvailability: dataAvailability
      };
    }).filter(function (row) {
      return row.feederName;
    });

    detailRows.sort(function (left, right) {
      const dateDelta = String(left.date).localeCompare(String(right.date));
      if (dateDelta !== 0) {
        return dateDelta;
      }
      const feederDelta = String(left.feederName).localeCompare(String(right.feederName));
      if (feederDelta !== 0) {
        return feederDelta;
      }
      return parseTimeToMinutes(left.peakTime) - parseTimeToMinutes(right.peakTime);
    });

    return {
      summaryRows: summaryRows,
      detailRows: detailRows,
      tags: [
        "Substation: " + getSubstationLabel(state.substationId),
        "Month: " + getMonthLabel(state),
        "Feeder Group: " + String(state.feederGroup || "all"),
        state.feederId ? ("Feeder: " + (summaryByFeeder[state.feederId] ? summaryByFeeder[state.feederId].feederName : "")) : "Feeder: All"
      ],
      note: "Only valid numeric hourly amp and kv values are scanned. Event-coded cells and blanks are ignored. Estimated numeric readings are included when present as numeric values."
    };
  }

  function buildFeederLoadTrendView(state) {
    const analysis = buildFeederLoadTrendAnalysis(state);
    return {
      dataset: {
        title: "Feeder Load Trend Report",
        subtitle: "Monthly feeder-wise daily peak, minimum, and average load trend from saved Daily Log data",
        tags: analysis.tags,
        note: analysis.note,
        tables: [
          {
            title: "Feeder-wise Monthly Summary",
            columns: [
              { key: "feederName", label: "Feeder" },
              { key: "highestPeakAmp", label: "Highest Peak" },
              { key: "highestPeakDateTime", label: "Date / Time of Highest Peak" },
              { key: "lowestAmp", label: "Lowest Amp" },
              { key: "lowestAmpDateTime", label: "Date / Time of Lowest Amp" },
              { key: "monthlyAverageAmp", label: "Monthly Average Amp" },
              { key: "validReadingDays", label: "Valid Reading Days" },
              { key: "dataAvailability", label: "Data Availability %" }
            ],
            rows: analysis.summaryRows.map(function (row) {
              return {
                feederName: row.feederName,
                highestPeakAmp: formatNumber(row.highestPeakAmp, 2),
                highestPeakDateTime: row.highestPeakDate ? (App.formatDate(row.highestPeakDate) + " " + row.highestPeakTime) : "",
                lowestAmp: formatNumber(row.lowestAmp, 2),
                lowestAmpDateTime: row.lowestAmpDate ? (App.formatDate(row.lowestAmpDate) + " " + row.lowestAmpTime) : "",
                monthlyAverageAmp: formatNumber(row.monthlyAverageAmp, 2),
                validReadingDays: String(row.validReadingDays || 0),
                dataAvailability: formatPercent(row.dataAvailability)
              };
            }),
            emptyMessage: "No valid feeder load trend data is available for the selected month."
          },
          {
            title: "Daily Feeder Load Trend",
            columns: [
              { key: "date", label: "Date" },
              { key: "feederName", label: "Feeder" },
              { key: "dailyPeakAmp", label: "Daily Peak Amp" },
              { key: "peakTime", label: "Peak Time" },
              { key: "dailyMinimumAmp", label: "Daily Minimum Amp" },
              { key: "minimumTime", label: "Minimum Time" },
              { key: "dailyAverageAmp", label: "Daily Average Amp" },
              { key: "dailyMaxKv", label: "Daily Max KV" },
              { key: "dailyMinKv", label: "Daily Min KV" }
            ],
            rows: analysis.detailRows.map(function (row) {
              return {
                date: App.formatDate(row.date),
                feederName: row.feederName,
                dailyPeakAmp: formatNumber(row.dailyPeakAmp, 2),
                peakTime: row.peakTime || "",
                dailyMinimumAmp: formatNumber(row.dailyMinimumAmp, 2),
                minimumTime: row.minimumTime || "",
                dailyAverageAmp: formatNumber(row.dailyAverageAmp, 2),
                dailyMaxKv: formatNumber(row.dailyMaxKv, 2),
                dailyMinKv: formatNumber(row.dailyMinKv, 2)
              };
            }),
            emptyMessage: "No daily feeder trend rows are available for the selected month."
          }
        ]
      },
      printOptions: {
        orientation: "landscape"
      }
    };
  }

  function buildWeeklyBatteryView(state) {
    const monthValue = getMonthValue(state);
    const records = App.storage.getCollection("batteryRecords").filter(function (record) {
      return record.substationId === state.substationId && String(record.date || "").slice(0, 7) === monthValue;
    }).sort(function (left, right) {
      return String(left.date).localeCompare(String(right.date));
    });

    return {
      dataset: {
        title: "Weekly Report",
        subtitle: "Saved weekly battery maintenance records for the selected month",
        tags: [
          "Substation: " + getSubstationLabel(state.substationId),
          "Month: " + getMonthLabel(state),
          "Records: " + records.length
        ],
        tables: [{
          title: "Weekly Battery Maintenance",
          columns: [
            { key: "date", label: "Date" },
            { key: "weekLabel", label: "Week Label" },
            { key: "batterySetName", label: "Battery Set" },
            { key: "gravityMin", label: "Gravity Min" },
            { key: "gravityMax", label: "Gravity Max" },
            { key: "voltageMin", label: "Voltage Min" },
            { key: "voltageMax", label: "Voltage Max" },
            { key: "totalVoltage", label: "Total Voltage" },
            { key: "overallBatteryCondition", label: "Condition" }
          ],
          rows: records.map(function (record) {
            return {
              date: App.formatDate(record.date),
              weekLabel: record.weekLabel || "",
              batterySetName: record.batterySetName || "Battery 1",
              gravityMin: formatNumber(record.gravityMin, 3),
              gravityMax: formatNumber(record.gravityMax, 3),
              voltageMin: formatNumber(record.voltageMin, 2),
              voltageMax: formatNumber(record.voltageMax, 2),
              totalVoltage: formatNumber(record.totalVoltage, 2),
              overallBatteryCondition: record.overallBatteryCondition || ""
            };
          }),
          emptyMessage: "No weekly battery records are available for the selected month."
        }]
      },
      records: records,
      printOptions: {
        orientation: "portrait",
        pageSize: "A4",
        margin: "8mm",
        bodyClass: records.length > 1 ? "print-battery-batch" : "print-battery-single"
      }
    };
  }

  function buildMonthlyBundle(state) {
    return getCachedMonthlyBundle(state, function () {
      const consumptionView = buildMonthlyConsumptionView(state);
      const minMaxView = buildMonthlyMinMaxView(state);
      const interruptionView = buildMonthlyInterruptionView(state);
      const energyBalanceView = buildMonthlyEnergyBalanceView(state, consumptionView.analysis);
      const mainIncReconciliationView = buildMainIncReconciliationView(state, consumptionView.analysis);
      const loadTrendView = buildFeederLoadTrendView(state);
      const abnormalConsumptionView = buildAbnormalConsumptionView(state);
      const eventImpactView = buildEventImpactView(state);
      const dataCompletenessView = buildDataCompletenessView(state);

      return {
        consumption: consumptionView,
        minmax: minMaxView,
        interruption: interruptionView,
        energy_balance: energyBalanceView,
        main_inc_reconciliation: mainIncReconciliationView,
        load_trend: loadTrendView,
        abnormal_consumption: abnormalConsumptionView,
        event_impact: eventImpactView,
        data_completeness: dataCompletenessView
      };
    });
  }

  function buildCurrentView(state) {
    if (!state.substationId || !App.findSubstation(state.substationId)) {
      return buildEmptyView("Reports", "Substation report preview", [], "Add a substation first to use the reports module.");
    }

    if (state.reportMode === "weekly_report") {
      return buildWeeklyBatteryView(state);
    }

    if (state.reportMode === "monthly_report") {
      if (state.previewTab === "month_end_pack") {
        return buildMonthEndPackView(state);
      }
      const monthlyViews = buildMonthlyBundle(state);
      return monthlyViews[state.previewTab] || monthlyViews.consumption;
    }

    if (state.legacyReportType === "fault_report") {
      return buildDailyFaultView(state);
    }
    if (state.legacyReportType === "maintenance_report") {
      return buildMaintenanceView(state);
    }
    if (state.legacyReportType === "daily_minmax") {
      return buildDailyMinMaxView(state);
    }
    return buildDailyLogView(state);
  }

  function getMonthEndPackState(state) {
    const packState = clone(state);
    const monthRange = getMonthRange(packState);
    const monthRecords = getMonthDailyLogs(packState);

    packState.reportMode = "monthly_report";
    packState.feederGroup = "all";
    packState.feederId = "";
    packState.mainIncomerId = "";
    packState.eventType = "all";
    packState.startDate = monthRange.start;
    packState.endDate = monthRange.end;
    packState.date = monthRecords.length ? monthRecords[monthRecords.length - 1].date : monthRange.end;

    return packState;
  }

  function buildMonthEndPackDefinitions(state) {
    const packState = getMonthEndPackState(state);
    const monthlyViews = buildMonthlyBundle(packState);
    const dailyMinMaxView = buildDailyMinMaxView(packState);
    const monthlyMinMaxTables = asArray(monthlyViews.minmax.dataset.tables);
    const loadTrendTables = asArray(monthlyViews.load_trend.dataset.tables);
    const reconciliationTables = asArray(monthlyViews.main_inc_reconciliation.dataset.tables);

    return [
      {
        key: "consumption",
        csvName: "monthly-consumption",
        dataset: monthlyViews.consumption.dataset,
        sheets: [
          { name: "Consumption", table: monthlyViews.consumption.dataset.tables[0] }
        ]
      },
      {
        key: "daily_minmax",
        csvName: "daily-minmax-summary",
        dataset: {
          title: "Daily Min/Max Summary",
          subtitle: "Reference day min/max feeder summary included in the month-end pack",
          tags: dailyMinMaxView.dataset.tags,
          summaryCards: dailyMinMaxView.dataset.summaryCards || [],
          note: dailyMinMaxView.dataset.note,
          tables: asArray(dailyMinMaxView.dataset.tables)
        },
        sheets: [
          { name: "Daily MinMax", table: dailyMinMaxView.dataset.tables[0] }
        ]
      },
      {
        key: "monthly_minmax",
        csvName: "monthly-minmax",
        dataset: {
          title: "Monthly Min/Max Report",
          subtitle: "Monthly peak, minimum, average, and availability scan for the selected month",
          tags: monthlyViews.minmax.dataset.tags,
          summaryCards: monthlyViews.minmax.dataset.summaryCards || [],
          note: monthlyViews.minmax.dataset.note,
          tables: monthlyMinMaxTables.length > 1 ? [monthlyMinMaxTables[1]] : monthlyMinMaxTables
        },
        sheets: [
          { name: "Monthly MinMax", table: monthlyMinMaxTables.length > 1 ? monthlyMinMaxTables[1] : monthlyMinMaxTables[0] }
        ]
      },
      {
        key: "interruption",
        csvName: "monthly-interruption",
        dataset: monthlyViews.interruption.dataset,
        sheets: [
          { name: "Interruption", table: monthlyViews.interruption.dataset.tables[0] }
        ]
      },
      {
        key: "energy_balance",
        csvName: "monthly-energy-balance",
        dataset: monthlyViews.energy_balance.dataset,
        sheets: [
          { name: "Energy Balance", table: monthlyViews.energy_balance.dataset.tables[0] }
        ]
      },
      {
        key: "load_trend",
        csvName: "feeder-load-trend",
        dataset: monthlyViews.load_trend.dataset,
        sheets: [
          { name: "Load Trend Summary", table: loadTrendTables[0] },
          { name: "Load Trend Daily", table: loadTrendTables[1] }
        ]
      },
      {
        key: "abnormal_consumption",
        csvName: "abnormal-consumption",
        dataset: monthlyViews.abnormal_consumption.dataset,
        sheets: [
          { name: "Abnormal Consumption", table: monthlyViews.abnormal_consumption.dataset.tables[0] }
        ]
      },
      {
        key: "event_impact",
        csvName: "event-impact",
        dataset: monthlyViews.event_impact.dataset,
        sheets: [
          { name: "Event Impact", table: monthlyViews.event_impact.dataset.tables[0] }
        ]
      },
      {
        key: "data_completeness",
        csvName: "data-completeness",
        dataset: monthlyViews.data_completeness.dataset,
        sheets: [
          { name: "Data Completeness", table: monthlyViews.data_completeness.dataset.tables[0] }
        ]
      },
      {
        key: "main_inc_reconciliation",
        csvName: "inc-reconciliation",
        dataset: monthlyViews.main_inc_reconciliation.dataset,
        sheets: [
          { name: "INC Reconciliation", table: reconciliationTables[0] },
          { name: "INC Child Detail", table: reconciliationTables[1] }
        ]
      }
    ];
  }

  function buildMonthEndPackDataset(state) {
    const packState = getMonthEndPackState(state);
    const definitions = buildMonthEndPackDefinitions(state);

    return {
      title: "One Click Month-End Report Pack",
      subtitle: "Combined month-end preview, print, and export set for the selected substation",
      tags: [
        "Substation: " + getSubstationLabel(packState.substationId),
        "Month: " + getMonthLabel(packState),
        "Reference Daily Min/Max Date: " + App.formatDate(packState.date)
      ],
      summaryCards: [
        { label: "Reports Included", value: String(definitions.length) },
        { label: "Substation", value: getSubstationLabel(packState.substationId) },
        { label: "Month", value: getMonthLabel(packState) }
      ],
      note: "This pack reuses the existing monthly report generators and prepares a clean month-end preview, print, Excel XML workbook, JSON package, and CSV set.",
      sections: definitions.map(function (definition) {
        return definition.dataset;
      })
    };
  }

  function buildMonthEndPackPayload(state) {
    const packState = getMonthEndPackState(state);
    const definitions = buildMonthEndPackDefinitions(state);

    return {
      metadata: {
        packName: "One Click Month-End Report Pack",
        generatedAt: new Date().toISOString(),
        reportCount: definitions.length
      },
      selection: {
        month: packState.month,
        year: packState.year,
        monthLabel: getMonthLabel(packState),
        substationId: packState.substationId,
        substationName: getSubstationLabel(packState.substationId),
        referenceDailyMinMaxDate: packState.date
      },
      reports: definitions.reduce(function (accumulator, definition) {
        accumulator[definition.key] = definition.dataset;
        return accumulator;
      }, {})
    };
  }

  function buildMonthEndPackView(state) {
    return {
      dataset: buildMonthEndPackDataset(state),
      printOptions: {
        orientation: "landscape",
        pageSize: "A4",
        margin: "8mm",
        bodyClass: "print-month-pack"
      }
    };
  }

  function getCurrentReportFilename(state, suffix) {
    const modeLabel = state.reportMode === "monthly_report" ? "monthly" : (state.reportMode === "weekly_report" ? "weekly" : state.legacyReportType);
    const substationLabel = state.substationId ? getSubstationLabel(state.substationId) : "all-substations";
    const period = state.reportMode === "monthly_report" || state.reportMode === "weekly_report" ? getMonthValue(state) : state.date;
    return safeFilename([modeLabel, substationLabel, period, suffix || "report"].join("-"));
  }

  function buildCsvFromTables(tables) {
    return asArray(tables).map(function (table) {
      if (table.kind === "interruption-matrix") {
        const matrixColumns = [{ key: "feederName", label: "Feeder" }].concat(INTERRUPTION_TYPES.reduce(function (accumulator, type) {
          accumulator.push({ key: type + "Qty", label: type + " Qty" });
          accumulator.push({ key: type + "Time", label: type + " Time" });
          return accumulator;
        }, [])).concat([{ key: "totalQty", label: "Total Qty" }, { key: "totalTime", label: "Total Time" }]);
        const matrixTable = {
          title: table.title,
          columns: matrixColumns,
          rows: asArray(table.rows).concat(table.totalRow ? [Object.assign({ feederName: "Grand Total" }, table.totalRow)] : [])
        };
        return buildCsvFromTables([matrixTable]);
      }

      const header = asArray(table.columns).map(function (column) {
        return escapeCsvValue(column.label);
      }).join(",");
      const lines = asArray(table.rows).map(function (row) {
        return asArray(table.columns).map(function (column) {
          return escapeCsvValue(row[column.key]);
        }).join(",");
      });
      return [table.title || table.name || "", header].concat(lines).join("\n");
    }).join("\n\n");
  }

  function getExportTables(tables) {
    return asArray(tables).reduce(function (accumulator, table) {
      if (table.kind === "interruption-matrix") {
        accumulator.push({
          title: table.title,
          name: table.title,
          columns: [{ key: "feederName", label: "Feeder" }].concat(INTERRUPTION_TYPES.reduce(function (items, type) {
            items.push({ key: type + "Qty", label: type + " Qty" });
            items.push({ key: type + "Time", label: type + " Time" });
            return items;
          }, [])).concat([{ key: "totalQty", label: "Total Qty" }, { key: "totalTime", label: "Total Time" }]),
          rows: asArray(table.rows).concat(table.totalRow ? [Object.assign({ feederName: "Grand Total" }, table.totalRow)] : [])
        });
      } else {
        accumulator.push(table);
      }
      return accumulator;
    }, []);
  }

  function buildSpreadsheetXml(filename, sheets) {
    const worksheetXml = asArray(sheets).map(function (sheet) {
      return (
        '<Worksheet ss:Name="' + xmlEscape(sanitizeSheetName(sheet.name || sheet.title || "Sheet1")) + '"><Table>' +
        '<Row>' + asArray(sheet.columns).map(function (column) {
          return '<Cell><Data ss:Type="String">' + xmlEscape(column.label) + "</Data></Cell>";
        }).join("") + "</Row>" +
        asArray(sheet.rows).map(function (row) {
          return "<Row>" + asArray(sheet.columns).map(function (column) {
            const value = row[column.key];
            const type = Number.isFinite(Number(value)) && value !== "" && !/%$/.test(String(value)) ? "Number" : "String";
            return '<Cell><Data ss:Type="' + type + '">' + xmlEscape(value) + "</Data></Cell>";
          }).join("") + "</Row>";
        }).join("") +
        "</Table></Worksheet>"
      );
    }).join("");

    return '<?xml version="1.0"?>' +
      '<?mso-application progid="Excel.Sheet"?>' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      worksheetXml +
      "</Workbook>";
  }

  function isMonthEndPackActive(state) {
    return state.reportMode === "monthly_report" && state.previewTab === "month_end_pack";
  }

  function buildMonthEndPackWorkbookSheets(state) {
    return buildMonthEndPackDefinitions(state).reduce(function (accumulator, definition) {
      return accumulator.concat(asArray(definition.sheets).filter(function (sheet) {
        return sheet && sheet.table;
      }).map(function (sheet) {
        const tables = getExportTables([sheet.table]);
        return {
          name: sheet.name,
          columns: tables[0].columns,
          rows: tables[0].rows
        };
      }));
    }, []);
  }

  function exportMonthEndPackAsJson(state) {
    const payload = buildMonthEndPackPayload(state);
    App.downloadTextFile(getCurrentReportFilename(getMonthEndPackState(state), "month-end-pack") + ".json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  }

  function exportMonthEndPackAsCsv(state) {
    const definitions = buildMonthEndPackDefinitions(state);
    if (!definitions.length) return;

    App.toast("Preparing " + definitions.length + " CSV files. Please allow multiple downloads if prompted.", "info");

    // AUDIT-FIX MED-02 / 5R: Sequential export with wider gap to prevent browser block
    definitions.forEach(function (definition, index) {
      global.setTimeout(function () {
        App.downloadTextFile(
          getCurrentReportFilename(getMonthEndPackState(state), definition.csvName) + ".csv",
          buildCsvFromTables(getExportTables(definition.dataset.tables)),
          "text/csv;charset=utf-8"
        );
      }, index * 500); // Increased from 120ms to 500ms for browser safety
    });
  }

  function exportCurrentReportAsJson(state) {
    if (isMonthEndPackActive(state)) {
      exportMonthEndPackAsJson(state);
      return;
    }
    const view = buildCurrentView(state);
    App.downloadTextFile(getCurrentReportFilename(state, "report") + ".json", JSON.stringify(view.dataset, null, 2), "application/json;charset=utf-8");
  }

  function exportCurrentReportAsCsv(state) {
    if (isMonthEndPackActive(state)) {
      exportMonthEndPackAsCsv(state);
      return;
    }
    const view = buildCurrentView(state);
    const tables = getExportTables(view.dataset.tables);
    App.downloadTextFile(getCurrentReportFilename(state, "report") + ".csv", buildCsvFromTables(tables), "text/csv;charset=utf-8");
  }

  function exportCurrentReportAsExcel(state) {
    if (isMonthEndPackActive(state)) {
      exportMonthlyWorkbook(state);
      return;
    }
    const view = buildCurrentView(state);
    const tables = getExportTables(view.dataset.tables).map(function (table, index) {
      return {
        name: sanitizeSheetName(table.title || table.name || ("Sheet" + (index + 1))),
        columns: table.columns,
        rows: table.rows
      };
    });
    App.downloadTextFile(getCurrentReportFilename(state, "report-excel-xml") + ".xls", buildSpreadsheetXml("current-report", tables), "application/vnd.ms-excel");
  }

  function exportMonthlyWorkbook(state) {
    const sheets = buildMonthEndPackWorkbookSheets(state);
    App.downloadTextFile(getCurrentReportFilename(getMonthEndPackState(state), "month-end-pack-excel-xml") + ".xls", buildSpreadsheetXml("month-workbook", sheets), "application/vnd.ms-excel");
  }

  async function exportFullBackup() {
    const payload = await App.storage.exportBackupPackageAsync({ source: "reports" });
    App.downloadTextFile("msedcl-substation-full-backup.json", payload, "application/json;charset=utf-8");
  }

  function printCurrentReport(state) {
    const view = buildCurrentView(state);

    if (state.reportMode === "weekly_report") {
      const records = asArray(view.records);

      // AUDIT-FIX HIGH-11 / 3L: Guard against missing battery module before calling its methods.
      if (!App.modules.battery || typeof App.modules.battery.buildPrintHtml !== "function") {
        App.toast("Battery print module is not available. Please reload the page.", "error");
        return;
      }

      if (records.length === 0) {
        App.toast("No weekly battery records found for the selected month.", "warning");
        return;
      }

      // AUDIT-FIX MED-09 / 5Q: Group records by batterySetName before printing.
      // Mixed battery sets must NOT appear in the same two-per-page print group.
      // Build one group per unique batterySetName, sorted by date within each group.
      var setGroups = records.reduce(function (accumulator, record) {
        var setKey = String(record.batterySetName || "Battery 1");
        if (!accumulator[setKey]) {
          accumulator[setKey] = [];
        }
        accumulator[setKey].push(record);
        return accumulator;
      }, {});

      Object.keys(setGroups).sort().forEach(function (setKey) {
        var group = setGroups[setKey].sort(function (left, right) {
          return String(left.date).localeCompare(String(right.date));
        });
        var groupTitle = "Weekly Battery Maintenance \u2014 " + setKey;
        if (group.length === 1) {
          App.openPrintWindow(groupTitle, App.modules.battery.buildPrintHtml(group[0]), view.printOptions);
        } else {
          App.openPrintWindow(groupTitle, App.modules.battery.buildTwoPerPagePrintHtml(group), view.printOptions);
        }
      });
      return;
    }

    App.openPrintWindow(view.dataset.title, view.printHtml || buildDatasetPrintHtml(view.dataset), view.printOptions || { orientation: "landscape" });
  }

  function printMonthEndPack(state) {
    if (state.reportMode !== "monthly_report") {
      App.toast("Month End Pack is available only for Monthly Report mode.", "warning");
      return;
    }
    const view = buildMonthEndPackView(state);
    App.openPrintWindow("One Click Month-End Report Pack", buildDatasetPrintHtml(view.dataset), view.printOptions);
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
    return Array.prototype.filter.call(parent.childNodes || [], function (node) {
      return node.nodeType === 1 && node.localName === name;
    });
  }

  function parseSpreadsheetXmlText(text) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "application/xml");
    const parserError = xml.getElementsByTagName("parsererror")[0];
    if (parserError) {
      throw new Error("Excel XML parse failed.");
    }

    const worksheets = Array.prototype.filter.call(xml.getElementsByTagName("*"), function (node) {
      return node.localName === "Worksheet";
    });

    return worksheets.map(function (worksheet) {
      const rows = Array.prototype.filter.call(worksheet.getElementsByTagName("*"), function (node) {
        return node.localName === "Row";
      });

      if (!rows.length) {
        return [];
      }

      const matrix = rows.map(function (row) {
        return getChildElementsByLocalName(row, "Cell").map(function (cell) {
          const dataNode = getChildElementsByLocalName(cell, "Data")[0];
          return dataNode ? String(dataNode.textContent || "").trim() : "";
        });
      });

      const headers = asArray(matrix[0]).map(normalizeHeaderKey);
      return matrix.slice(1).map(function (row) {
        return headers.reduce(function (accumulator, header, headerIndex) {
          accumulator[header] = row[headerIndex] === undefined ? "" : String(row[headerIndex]).trim();
          return accumulator;
        }, {});
      });
    }).filter(function (rows) {
      return rows.length;
    });
  }

  function getFileExtension(fileName) {
    const parts = String(fileName || "").toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() : "";
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

  function getRowValue(row, aliases) {
    const aliasList = asArray(aliases).map(normalizeHeaderKey);
    const key = Object.keys(row).find(function (item) {
      return aliasList.indexOf(item) >= 0;
    });
    return key ? row[key] : "";
  }

  function findImportedSubstation(row) {
    const substationId = String(getRowValue(row, ["substation_id", "substationid"]) || "").trim();
    if (substationId) {
      return App.findSubstation(substationId);
    }

    const substationName = String(getRowValue(row, ["substation", "substation_name", "substationname"]) || "").trim().toLowerCase();
    if (!substationName) {
      return null;
    }

    return App.getSubstations().find(function (item) {
      return String(item.name || "").trim().toLowerCase() === substationName;
    }) || null;
  }

  function findImportedFeeder(substation, row) {
    if (!substation) {
      return null;
    }

    const feederId = String(getRowValue(row, ["feeder_id", "feederid"]) || "").trim();
    if (feederId) {
      return asArray(substation.feeders).find(function (item) {
        return item.id === feederId;
      }) || null;
    }

    const feederName = String(getRowValue(row, ["feeder", "feeder_name", "feedername"]) || "").trim().toLowerCase();
    if (!feederName) {
      return null;
    }

    return asArray(substation.feeders).find(function (item) {
      return String(App.getFeederLabel(item) || "").trim().toLowerCase() === feederName;
    }) || null;
  }

  function validateDateField(value, label, errors) {
    if (value && !isValidDateString(value)) {
      errors.push(label + " has invalid date format.");
    }
  }

  function validateTimeField(value, label, errors) {
    const text = String(value || "").trim();
    if (text && !TIME_PATTERN.test(text)) {
      errors.push(label + " must use HH:MM 24-hour format.");
    }
  }

  function validateNumericField(value, label, errors) {
    const text = String(value || "").trim();
    if (text && !Number.isFinite(Number(text))) {
      errors.push(label + " must be numeric.");
    }
  }

  function validateMfField(row, errors) {
    const mfValue = getRowValue(row, ["mf"]);
    if (String(mfValue || "").trim() && !Number.isFinite(Number(mfValue))) {
      errors.push("MF value must be numeric.");
    }
  }

  function buildDuplicateKey(parts) {
    return parts.map(function (part) {
      return String(part || "").trim().toLowerCase();
    }).join("|");
  }

  function validateAndNormalizeFaultImportRow(row, index) {
    const errors = [];
    const substation = findImportedSubstation(row);
    const feeder = findImportedFeeder(substation, row);
    const date = String(getRowValue(row, ["date"]) || "").trim();
    const startTime = String(getRowValue(row, ["start_time", "starttime", "from", "from_time"]) || "").trim();
    const endTime = String(getRowValue(row, ["end_time", "endtime", "to", "to_time"]) || "").trim();
    const faultType = String(getRowValue(row, ["fault_type", "faulttype", "type"]) || "").trim().toUpperCase();
    const feederName = feeder ? App.getFeederLabel(feeder) : String(getRowValue(row, ["feeder", "feeder_name", "feedername"]) || "").trim();

    if (!substation) {
      errors.push("Substation not found.");
    }
    if (feederName && substation && !feeder) {
      errors.push("Feeder does not exist in the selected substation.");
    }
    validateDateField(date, "Date", errors);
    validateTimeField(startTime, "Start time", errors);
    validateTimeField(endTime, "End time", errors);
    if (!faultType || FAULT_TYPES.indexOf(faultType) === -1) {
      errors.push("Fault type is invalid.");
    }
    validateNumericField(getRowValue(row, ["duration_minutes", "durationminutes"]), "Duration minutes", errors);
    validateMfField(row, errors);

    return {
      valid: !errors.length,
      errors: errors,
      duplicateKey: buildDuplicateKey([date, substation ? substation.id : "", feeder ? feeder.id : feederName, startTime, endTime, faultType]),
      record: {
        id: String(getRowValue(row, ["id"]) || "").trim(),
        date: date,
        substationId: substation ? substation.id : "",
        substationName: substation ? substation.name : "",
        feederId: feeder ? feeder.id : "",
        feederName: feederName,
        startTime: startTime,
        endTime: endTime,
        durationMinutes: Number(getRowValue(row, ["duration_minutes", "durationminutes"]) || 0),
        faultType: faultType,
        source: String(getRowValue(row, ["source"]) || "MANUAL").trim().toUpperCase() || "MANUAL",
        remark: String(getRowValue(row, ["remark"]) || "").trim()
      },
      rowNumber: index + 2
    };
  }

  function validateAndNormalizeMaintenanceImportRow(row, index) {
    const errors = [];
    const substation = findImportedSubstation(row);
    const date = String(getRowValue(row, ["date"]) || "").trim();
    const time = String(getRowValue(row, ["time"]) || "").trim();
    const workDetail = String(getRowValue(row, ["work_detail", "workdetail"]) || "").trim();

    if (!substation) {
      errors.push("Substation not found.");
    }
    validateDateField(date, "Date", errors);
    validateTimeField(time, "Time", errors);
    if (!workDetail) {
      errors.push("Work detail is required.");
    }
    validateMfField(row, errors);

    return {
      valid: !errors.length,
      errors: errors,
      duplicateKey: buildDuplicateKey([date, substation ? substation.id : "", time, workDetail]),
      record: {
        id: String(getRowValue(row, ["id"]) || "").trim(),
        date: date,
        substationId: substation ? substation.id : "",
        substationName: substation ? substation.name : "",
        time: time,
        workDetail: workDetail,
        remark: String(getRowValue(row, ["remark"]) || "").trim()
      },
      rowNumber: index + 2
    };
  }

  function validateAndNormalizeBatteryImportRow(row, index) {
    const errors = [];
    const substation = findImportedSubstation(row);
    const date = String(getRowValue(row, ["date"]) || "").trim();

    if (!substation) {
      errors.push("Substation not found.");
    }
    validateDateField(date, "Date", errors);
    ["gravity_max", "gravity_min", "voltage_max", "voltage_min", "total_voltage"].forEach(function (field) {
      validateNumericField(getRowValue(row, [field]), field.replace(/_/g, " "), errors);
    });
    validateMfField(row, errors);

    return {
      valid: !errors.length,
      errors: errors,
      duplicateKey: buildDuplicateKey([date, substation ? substation.id : "", getRowValue(row, ["battery_set_name", "batterysetname"]) || "Battery 1"]),
      record: {
        id: String(getRowValue(row, ["id"]) || "").trim(),
        substationId: substation ? substation.id : "",
        substationName: substation ? substation.name : "",
        date: date,
        weekKey: String(getRowValue(row, ["week_key", "weekkey"]) || "").trim(),
        weekLabel: String(getRowValue(row, ["week_label", "weeklabel"]) || "").trim(),
        batterySetName: String(getRowValue(row, ["battery_set_name", "batterysetname"]) || "Battery 1").trim(),
        cellReadings: [],
        remarkChecks: [],
        generatedRemarkText: String(getRowValue(row, ["generated_remark_text", "generatedremarktext"]) || "").trim(),
        gravityMax: getRowValue(row, ["gravity_max"]),
        gravityMin: getRowValue(row, ["gravity_min"]),
        voltageMax: getRowValue(row, ["voltage_max"]),
        voltageMin: getRowValue(row, ["voltage_min"]),
        totalVoltage: getRowValue(row, ["total_voltage"]),
        gravityCondition: String(getRowValue(row, ["gravity_condition"]) || "").trim(),
        voltageCondition: String(getRowValue(row, ["voltage_condition"]) || "").trim(),
        overallBatteryCondition: String(getRowValue(row, ["overall_battery_condition", "overallbatterycondition"]) || "").trim(),
        operatorName: String(getRowValue(row, ["operator_name", "operatorname"]) || "").trim(),
        inchargeName: String(getRowValue(row, ["incharge_name", "inchargename"]) || "").trim()
      },
      rowNumber: index + 2
    };
  }

  function validateAndNormalizeChargeHandoverImportRow(row, index) {
    const errors = [];
    const substation = findImportedSubstation(row);
    const date = String(getRowValue(row, ["date"]) || "").trim();
    const givenTime = String(getRowValue(row, ["charge_given_time", "chargegiventime"]) || "").trim();
    const takenTime = String(getRowValue(row, ["charge_taken_time", "chargetakentime"]) || "").trim();

    if (!substation) {
      errors.push("Substation not found.");
    }
    validateDateField(date, "Date", errors);
    validateTimeField(givenTime, "Charge given time", errors);
    validateTimeField(takenTime, "Charge taken time", errors);
    validateTimeField(getRowValue(row, ["duty_start_time", "dutystarttime"]), "Duty start time", errors);
    validateTimeField(getRowValue(row, ["duty_end_time", "dutyendtime"]), "Duty end time", errors);
    validateMfField(row, errors);

    return {
      valid: !errors.length,
      errors: errors,
      duplicateKey: buildDuplicateKey([date, substation ? substation.id : "", givenTime, takenTime, getRowValue(row, ["charge_given_by", "chargegivenby"]), getRowValue(row, ["charge_taken_by", "chargetakenby"])]),
      record: {
        id: String(getRowValue(row, ["id"]) || "").trim(),
        date: date,
        substationId: substation ? substation.id : "",
        substationName: substation ? substation.name : "",
        dutyType: String(getRowValue(row, ["duty_type", "dutytype"]) || "").trim(),
        shiftType: String(getRowValue(row, ["shift_type", "shifttype"]) || "").trim(),
        chargeGivenBy: String(getRowValue(row, ["charge_given_by", "chargegivenby"]) || "").trim(),
        chargeTakenBy: String(getRowValue(row, ["charge_taken_by", "chargetakenby"]) || "").trim(),
        chargeGivenTime: givenTime,
        chargeTakenTime: takenTime,
        dutyStartTime: String(getRowValue(row, ["duty_start_time", "dutystarttime"]) || "").trim(),
        dutyEndTime: String(getRowValue(row, ["duty_end_time", "dutyendtime"]) || "").trim(),
        generalStatus: String(getRowValue(row, ["general_status", "generalstatus"]) || "").trim(),
        pendingWork: String(getRowValue(row, ["pending_work", "pendingwork"]) || "").trim(),
        faultPending: String(getRowValue(row, ["fault_pending", "faultpending"]) || "").trim(),
        shutdownPending: String(getRowValue(row, ["shutdown_pending", "shutdownpending"]) || "").trim(),
        importantInstructions: String(getRowValue(row, ["important_instructions", "importantinstructions"]) || "").trim(),
        logbookUpdated: String(getRowValue(row, ["logbook_updated", "logbookupdated"]) || "").trim(),
        remark: String(getRowValue(row, ["remark"]) || "").trim()
      },
      rowNumber: index + 2
    };
  }

  function getImporter(collectionName) {
    if (collectionName === "faults") {
      return { prefix: "fault", validate: validateAndNormalizeFaultImportRow };
    }
    if (collectionName === "maintenanceLogs") {
      return { prefix: "maintenance", validate: validateAndNormalizeMaintenanceImportRow };
    }
    if (collectionName === "batteryRecords") {
      return { prefix: "battery", validate: validateAndNormalizeBatteryImportRow };
    }
    if (collectionName === "chargeHandoverRecords") {
      return { prefix: "handover", validate: validateAndNormalizeChargeHandoverImportRow };
    }
    return null;
  }

  function extractRowsFromJson(parsed) {
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.records)) {
      return parsed.records;
    }
    if (parsed && parsed.rows && Array.isArray(parsed.rows)) {
      return parsed.rows;
    }
    return [];
  }

  function importOperationalRows(collectionName, rows) {
    const importer = getImporter(collectionName);
    if (!importer) {
      throw new Error("Selected import collection is not supported.");
    }

    const existingRecords = App.storage.getCollection(collectionName);
    const existingKeys = existingRecords.reduce(function (accumulator, record) {
      let duplicateKey = "";
      if (collectionName === "faults") {
        duplicateKey = buildDuplicateKey([record.date, record.substationId, record.feederId || record.feederName, record.startTime, record.endTime, record.faultType]);
      } else if (collectionName === "maintenanceLogs") {
        duplicateKey = buildDuplicateKey([record.date, record.substationId, record.time, record.workDetail]);
      } else if (collectionName === "batteryRecords") {
        duplicateKey = buildDuplicateKey([record.date, record.substationId, record.batterySetName || "Battery 1"]);
      } else if (collectionName === "chargeHandoverRecords") {
        duplicateKey = buildDuplicateKey([record.date, record.substationId, record.chargeGivenTime, record.chargeTakenTime, record.chargeGivenBy, record.chargeTakenBy]);
      }
      accumulator[duplicateKey] = true;
      return accumulator;
    }, {});

    const seenKeys = {};
    const errors = [];
    let importedCount = 0;
    let skippedCount = 0;

    rows.forEach(function (row, index) {
      const validation = importer.validate(row, index);

      if (!validation.valid) {
        errors.push("Row " + validation.rowNumber + ": " + validation.errors.join(" "));
        return;
      }

      if (!validation.record.id && validation.duplicateKey && (existingKeys[validation.duplicateKey] || seenKeys[validation.duplicateKey])) {
        skippedCount += 1;
        return;
      }

      if (validation.duplicateKey) {
        seenKeys[validation.duplicateKey] = true;
      }

      App.storage.upsert(collectionName, validation.record, importer.prefix);
      importedCount += 1;
    });

    return {
      importedCount: importedCount,
      skippedCount: skippedCount,
      errors: errors
    };
  }

  async function importFromFile(state, container) {
    const fileInput = container.querySelector("#reports-import-file");
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      App.toast("Choose a file to import.", "warning");
      return;
    }

    const file = fileInput.files[0];
    const sharedImportStrategy = state.importCollection === "full_backup" ? "replace_all" : "merge_existing";

    if (App.dataTools && typeof App.dataTools.validateImportFile === "function" && typeof App.dataTools.applyImportPreview === "function") {
      const preview = await App.dataTools.validateImportFile({
        file: file,
        importTarget: state.importCollection,
        importStrategy: sharedImportStrategy,
        month: state.month,
        year: state.year
      });
      const hardErrors = asArray(preview && preview.issues).filter(function (item) {
        return item && item.level === "error";
      });

      if (hardErrors.length) {
        state.importStatus = "Import blocked: " + hardErrors[0].message;
        App.toast(state.importStatus, "error");
        App.renderCurrentRoute();
        return;
      }

      const appliedCount = await App.dataTools.applyImportPreview(preview, {
        importStrategy: sharedImportStrategy,
        month: state.month,
        year: state.year
      });
      const warningCount = asArray(preview && preview.issues).filter(function (item) {
        return item && item.level === "warning";
      }).length;
      state.importStatus = "Import applied through shared Data Tools validation. Count: " + appliedCount + ". Warnings: " + warningCount + ".";
      App.toast("Import completed. Count: " + appliedCount + ".", warningCount ? "warning" : "success");
      App.renderCurrentRoute();
      return;
    }

    const extension = getFileExtension(file.name);
    const text = await readFileAsText(file);

    if (state.importCollection === "full_backup") {
      if (extension !== "json") {
        throw new Error("Full backup restore requires a JSON backup file.");
      }
      await App.storage.importDataAsync(JSON.parse(text));
      state.importStatus = "Full backup restored successfully.";
      App.toast("Full backup restored.", "success");
      App.renderCurrentRoute();
      return;
    }

    let rows = [];
    if (extension === "json") {
      rows = extractRowsFromJson(JSON.parse(text));
    } else if (extension === "csv") {
      rows = parseCsvText(text);
    } else if (extension === "xls" || extension === "xml") {
      const sheets = parseSpreadsheetXmlText(text);
      rows = sheets[0] || [];
    } else {
      throw new Error("Unsupported file type. Use JSON, CSV, or Spreadsheet XML files (`.xls` / `.xml`).");
    }

    const result = importOperationalRows(state.importCollection, rows);
    const summary = [
      "Imported: " + result.importedCount,
      "Skipped duplicates: " + result.skippedCount,
      result.errors.length ? ("Errors: " + result.errors.length) : "Errors: 0"
    ].join(" | ");

    state.importStatus = summary + (result.errors.length ? (" | " + result.errors[0]) : "");
    App.toast("Import completed. " + summary, result.errors.length ? "warning" : "success");
    App.renderCurrentRoute();
  }

  function buildImportStatusHtml(statusText) {
    if (!statusText) {
      return '<p class="small-status">Excel XML import accepts Spreadsheet XML files exported by this system (`.xls` / `.xml`). JSON and CSV imports support operational register rows with validation.</p>';
    }
    return '<p class="small-status">' + App.escapeHtml(statusText) + "</p>";
  }

  function renderReportControls(state) {
    const yearValue = Number(state.year) || Number(getTodayParts().year);
    const isPackActive = isMonthEndPackActive(state);
    return [
      '<div class="card">',
      '  <div class="card-header">',
      "    <div>",
      "      <h3>Reports</h3>",
      "      <p>Existing daily, fault, maintenance, and weekly battery reports remain available while monthly summaries are added here.</p>",
      "    </div>",
      "  </div>",
      '  <div class="filter-row">',
      '    <div class="field-group"><label for="reports-mode">Report Type</label><select id="reports-mode">' + buildModeOptions(state.reportMode) + "</select></div>",
      '    <div class="field-group"><label for="reports-month">Month</label><select id="reports-month">' + buildMonthOptions(state.month) + "</select></div>",
      '    <div class="field-group"><label for="reports-year">Year</label><input id="reports-year" type="number" min="2020" max="2100" value="' + App.escapeHtml(yearValue) + '"></div>',
      '    <div class="field-group"><label for="reports-substation">Substation</label><select id="reports-substation">' + App.buildSubstationOptions(state.substationId, false) + "</select></div>",
      (!isPackActive ? ('    <div class="field-group"><label for="reports-feeder-group">Feeder Group</label><select id="reports-feeder-group">' + buildFeederGroupOptions(state) + '</select></div>') : ""),
      '    <div class="field-group"><label>&nbsp;</label><button type="button" class="primary-button" id="reports-generate-button">Generate</button></div>',
      "  </div>",
      '  <div class="filter-row">',
      (state.reportMode === "daily_report" ? (
        '<div class="field-group"><label for="reports-daily-type">Daily View</label><select id="reports-daily-type">' + buildDailyReportOptions(state.legacyReportType) + "</select></div>" +
        '<div class="field-group"><label for="reports-date">Date</label><input id="reports-date" type="date" value="' + App.escapeHtml(state.date) + '"></div>' +
        '<div class="field-group"><label for="reports-start-date">From Date</label><input id="reports-start-date" type="date" value="' + App.escapeHtml(state.startDate || "") + '"></div>' +
        '<div class="field-group"><label for="reports-end-date">To Date</label><input id="reports-end-date" type="date" value="' + App.escapeHtml(state.endDate || "") + '"></div>'
      ) : "") +
      (state.reportMode === "weekly_report" ? (
        '<div class="tag">Weekly battery records are filtered by selected month and substation. Print keeps the two-reports-per-page register layout across multiple pages.</div>'
      ) : "") +
      (state.reportMode === "monthly_report" ? (
        (!isPackActive ? ('<div class="field-group"><label for="reports-date">Daily Min/Max Date</label><input id="reports-date" type="date" value="' + App.escapeHtml(state.date) + '"></div>') : "") +
        ((state.previewTab === "load_trend" || state.previewTab === "abnormal_consumption" || state.previewTab === "event_impact" || state.previewTab === "data_completeness") ? ('<div class="field-group"><label for="reports-feeder">Feeder</label><select id="reports-feeder">' + buildFeederOptions(state) + '</select></div>') : "") +
        (state.previewTab === "main_inc_reconciliation" ? ('<div class="field-group"><label for="reports-main-incomer">Main Incomer</label><select id="reports-main-incomer">' + buildMainIncomerOptions(state) + '</select></div>') : "") +
        (state.previewTab === "abnormal_consumption" ? ('<div class="field-group"><label for="reports-threshold-mode">Threshold Mode</label><select id="reports-threshold-mode">' + buildThresholdModeOptions(state.thresholdMode) + '</select></div>') : "") +
        (state.previewTab === "event_impact" ? (
          '<div class="field-group"><label for="reports-start-date">From Date</label><input id="reports-start-date" type="date" value="' + App.escapeHtml(state.startDate || getMonthRange(state).start) + '"></div>' +
          '<div class="field-group"><label for="reports-end-date">To Date</label><input id="reports-end-date" type="date" value="' + App.escapeHtml(state.endDate || getMonthRange(state).end) + '"></div>' +
          '<div class="field-group"><label for="reports-event-type">Event Type</label><select id="reports-event-type">' + buildEventTypeOptions(state.eventType) + '</select></div>'
        ) : "") +
        '<div class="tag">Monthly tabs below reuse the selected month, substation, and feeder group.</div>'
      ) : "") +
      "  </div>",
      (state.reportMode === "monthly_report" ? ('  <div class="history-tab-row">' + buildMonthlyPreviewTabs(state.previewTab) + "</div>") : ""),
      '  <div class="filter-row">',
      '    <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="reports-print-button">' + (isPackActive ? "Print All" : "Print") + '</button></div>',
      '    <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="reports-excel-button">' + (isPackActive ? "Export Excel XML Pack (.xls)" : "Excel XML (.xls)") + '</button></div>',
      '    <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="reports-csv-button">' + (isPackActive ? "Export CSV Pack" : "CSV") + '</button></div>',
      '    <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="reports-json-button">' + (isPackActive ? "Export JSON Pack" : "JSON") + '</button></div>',
      (state.reportMode === "monthly_report" && !isPackActive ? ('    <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="reports-month-workbook-button">Full Month Workbook Excel XML (.xls)</button></div>') : ""),
      (state.reportMode === "monthly_report" ? ('    <div class="field-group"><label>&nbsp;</label><button type="button" class="primary-button" id="reports-month-pack-button">Generate Month-End Pack</button></div>') : ""),
      '    <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="reports-backup-button">Full Backup JSON</button></div>',
      "  </div>",
      "</div>"
    ].join("");
  }

  function renderImportTools(state) {
    return [
      '<div class="card">',
      '  <div class="card-header">',
      "    <div>",
      "      <h3>Import / Restore Tools</h3>",
      "      <p>Import validated operational data rows or restore a full JSON backup without going online. This shortcut reuses the stronger Data Tools validation and safety-backup flow.</p>",
      "    </div>",
      "  </div>",
      '  <div class="filter-row">',
      '    <div class="field-group"><label for="reports-import-collection">Import Target</label><select id="reports-import-collection">' + buildImportCollectionOptions(state.importCollection) + "</select></div>",
      '    <div class="field-group"><label for="reports-import-file">Import File (JSON / CSV / Excel XML)</label><input id="reports-import-file" type="file" accept=".json,.csv,.xls,.xml"></div>',
      '    <div class="field-group"><label>&nbsp;</label><button type="button" class="primary-button" id="reports-import-button">Import Selected File</button></div>',
      "  </div>",
      buildImportStatusHtml(state.importStatus),
      "</div>"
    ].join("");
  }

  function getPreviewNote(state) {
    if (state.reportMode === "monthly_report") {
      if (state.previewTab === "month_end_pack") {
        return "Month-End Pack preview shows all key monthly reports in sequence for one-click print and export.";
      }
      return "Use the tabs to switch between Monthly Consumption, Min/Max, Interruption, Energy Balance, reconciliation, and other monthly previews.";
    }
    if (state.reportMode === "weekly_report") {
      return "Weekly Report currently shows saved weekly battery maintenance records for the selected month.";
    }
    return "Daily Report keeps existing Daily Log, Fault, Maintenance, and Daily Min/Max report flows available. Daily Log preview is summary-first, while Print opens the full DLR sheet.";
  }

  App.reportPackTools = {
    buildMonthEndPackState: function (selection) {
      const today = getTodayParts();
      const baseState = Object.assign({
        reportMode: "monthly_report",
        previewTab: "month_end_pack",
        substationId: "",
        feederGroup: "all",
        feederId: "",
        mainIncomerId: "",
        thresholdMode: "recent_average",
        eventType: "all",
        month: today.month,
        year: today.year,
        date: today.date,
        startDate: today.date,
        endDate: today.date
      }, selection || {});
      return getMonthEndPackState(baseState);
    },
    buildMonthEndPackDataset: function (selection) {
      return buildMonthEndPackDataset(this.buildMonthEndPackState(selection));
    },
    buildMonthEndPackPayload: function (selection) {
      return buildMonthEndPackPayload(this.buildMonthEndPackState(selection));
    },
    buildMonthEndPackWorkbookSheets: function (selection) {
      return buildMonthEndPackWorkbookSheets(this.buildMonthEndPackState(selection));
    },
    buildSpreadsheetXml: function (filename, sheets) {
      return buildSpreadsheetXml(filename, sheets);
    }
  };

  App.registerModule("reports", {
    title: "Reports",
    subtitle: "Daily, weekly, and monthly operational reports with office-friendly preview, print, export, and restore tools.",

    render: function () {
      const state = ensureStateSelections();
      const currentView = buildCurrentView(state);

      return [
        '<section class="module-shell">',
        renderReportControls(state),
        '<div class="section-block"><p class="small-status">' + App.escapeHtml(getPreviewNote(state)) + "</p></div>",
        buildDatasetHtml(currentView.dataset),
        renderImportTools(state),
        "</section>"
      ].join("");
    },

    afterRender: function (container) {
      const state = ensureStateSelections();

      function syncStateFromControls() {
        const modeInput = container.querySelector("#reports-mode");
        const monthInput = container.querySelector("#reports-month");
        const yearInput = container.querySelector("#reports-year");
        const substationInput = container.querySelector("#reports-substation");
        const feederGroupInput = container.querySelector("#reports-feeder-group");
        const feederInput = container.querySelector("#reports-feeder");
        const mainIncomerInput = container.querySelector("#reports-main-incomer");
        const thresholdModeInput = container.querySelector("#reports-threshold-mode");
        const eventTypeInput = container.querySelector("#reports-event-type");
        const dailyTypeInput = container.querySelector("#reports-daily-type");
        const dateInput = container.querySelector("#reports-date");
        const startDateInput = container.querySelector("#reports-start-date");
        const endDateInput = container.querySelector("#reports-end-date");
        const importCollectionInput = container.querySelector("#reports-import-collection");

        state.reportMode = modeInput ? modeInput.value : state.reportMode;
        state.month = monthInput ? monthInput.value : state.month;
        state.year = yearInput ? String(yearInput.value || state.year) : state.year;
        state.substationId = substationInput ? substationInput.value : state.substationId;
        state.feederGroup = feederGroupInput ? feederGroupInput.value : state.feederGroup;
        state.feederId = feederInput ? feederInput.value : state.feederId;
        state.mainIncomerId = mainIncomerInput ? mainIncomerInput.value : state.mainIncomerId;
        state.thresholdMode = thresholdModeInput ? thresholdModeInput.value : state.thresholdMode;
        state.eventType = eventTypeInput ? eventTypeInput.value : state.eventType;
        state.legacyReportType = dailyTypeInput ? dailyTypeInput.value : state.legacyReportType;
        state.date = dateInput ? dateInput.value : state.date;
        state.startDate = startDateInput ? startDateInput.value : state.startDate;
        state.endDate = endDateInput ? endDateInput.value : state.endDate;
        state.importCollection = importCollectionInput ? importCollectionInput.value : state.importCollection;
      }

      ["#reports-mode", "#reports-month", "#reports-year", "#reports-substation", "#reports-feeder-group", "#reports-feeder", "#reports-main-incomer", "#reports-threshold-mode", "#reports-event-type", "#reports-daily-type", "#reports-date", "#reports-start-date", "#reports-end-date", "#reports-import-collection"].forEach(function (selector) {
        const input = container.querySelector(selector);
        if (input) {
          input.addEventListener("change", function () {
            syncStateFromControls();
            if (
              selector === "#reports-mode" ||
              selector === "#reports-substation" ||
              (selector === "#reports-feeder-group" && state.reportMode === "monthly_report" && (state.previewTab === "load_trend" || state.previewTab === "abnormal_consumption" || state.previewTab === "event_impact" || state.previewTab === "data_completeness" || state.previewTab === "main_inc_reconciliation"))
            ) {
              App.renderCurrentRoute();
            }
          });
        }
      });

      const generateButton = container.querySelector("#reports-generate-button");
      if (generateButton) {
        generateButton.addEventListener("click", function () {
          syncStateFromControls();
          App.renderCurrentRoute();
        });
      }

      container.querySelectorAll("[data-report-tab]").forEach(function (button) {
        button.addEventListener("click", function () {
          syncStateFromControls();
          state.previewTab = button.getAttribute("data-report-tab");
          App.renderCurrentRoute();
        });
      });

      const printButton = container.querySelector("#reports-print-button");
      if (printButton) {
        printButton.addEventListener("click", function () {
          syncStateFromControls();
          printCurrentReport(state);
        });
      }

      const excelButton = container.querySelector("#reports-excel-button");
      if (excelButton) {
        excelButton.addEventListener("click", function () {
          syncStateFromControls();
          exportCurrentReportAsExcel(state);
        });
      }

      const csvButton = container.querySelector("#reports-csv-button");
      if (csvButton) {
        csvButton.addEventListener("click", function () {
          syncStateFromControls();
          exportCurrentReportAsCsv(state);
        });
      }

      const jsonButton = container.querySelector("#reports-json-button");
      if (jsonButton) {
        jsonButton.addEventListener("click", function () {
          syncStateFromControls();
          exportCurrentReportAsJson(state);
        });
      }

      const workbookButton = container.querySelector("#reports-month-workbook-button");
      if (workbookButton) {
        workbookButton.addEventListener("click", function () {
          syncStateFromControls();
          if (state.reportMode !== "monthly_report") {
            App.toast("Full month workbook export is available in Monthly Report mode.", "warning");
            return;
          }
          exportMonthlyWorkbook(state);
        });
      }

      const packButton = container.querySelector("#reports-month-pack-button");
      if (packButton) {
        packButton.addEventListener("click", function () {
          syncStateFromControls();
          if (state.reportMode !== "monthly_report") {
            App.toast("Month-End Pack is available only in Monthly Report mode.", "warning");
            return;
          }
          state.previewTab = "month_end_pack";
          App.renderCurrentRoute();
        });
      }

      const backupButton = container.querySelector("#reports-backup-button");
      if (backupButton) {
        backupButton.addEventListener("click", function () {
          exportFullBackup().catch(function (error) {
            state.importStatus = error && error.message ? error.message : "Full backup export failed.";
            App.toast(state.importStatus, "error");
            App.renderCurrentRoute();
          });
        });
      }

      const importButton = container.querySelector("#reports-import-button");
      if (importButton) {
        importButton.addEventListener("click", function () {
          syncStateFromControls();
          importFromFile(state, container).catch(function (error) {
            state.importStatus = error && error.message ? error.message : "Import failed.";
            App.toast(state.importStatus, "error");
            App.renderCurrentRoute();
          });
        });
      }
    }
  });

})(window);
