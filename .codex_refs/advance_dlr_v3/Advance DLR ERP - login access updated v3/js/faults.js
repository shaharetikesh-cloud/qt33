(function (global) {
  const App = global.SubstationRegisterApp;
  const FAULT_TYPES = ["EF", "SD", "LP", "BD", "OC", "LS", "SF"];
  const MONTHLY_FAULT_TYPES = ["EF", "LS", "BD", "OC", "SD", "LP", "SF"];
  const AUTO_FAULT_SOURCES = ["AUTO_GAP", "AUTO_EVENT", "PROPAGATED_EVENT"];

  function getModuleState() {
    return App.getModuleState("faults", {
      editingId: null,
      dailySubstationId: "",
      dailyDate: App.getTodayValue(),
      monthlySubstationId: "",
      monthlyMonth: App.getTodayValue().slice(0, 7)
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSource(value) {
    const normalized = String(value || "MANUAL").trim().toUpperCase();

    if (normalized === "AUTO") {
      return "AUTO_GAP";
    }

    if (AUTO_FAULT_SOURCES.indexOf(normalized) >= 0 || normalized === "MANUAL") {
      return normalized;
    }

    return "MANUAL";
  }

  function isManagedAutoSource(value) {
    return AUTO_FAULT_SOURCES.indexOf(normalizeSource(value)) >= 0;
  }

  function parseFaultTime(value) {
    return App.parse24HourTime(value);
  }

  function normalizeFaultTime(value) {
    return App.normalizeTimeInput(value);
  }

  function calculateFaultDurationMinutes(startTime, endTime) {
    const startMinutes = App.timeToMinutesAllowing2400(startTime);
    const endMinutes = App.timeToMinutesAllowing2400(endTime);

    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
      return 0;
    }

    let resolvedEndMinutes = endMinutes;
    if (resolvedEndMinutes < startMinutes) {
      resolvedEndMinutes += 24 * 60;
    }

    return Math.max(0, resolvedEndMinutes - startMinutes);
  }

  function formatDurationClock(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 0) {
      return "00:00";
    }

    const hours = Math.floor(value / 60);
    const remaining = value % 60;
    return String(hours).padStart(2, "0") + ":" + String(remaining).padStart(2, "0");
  }

  function getSubstationName(substationId, fallbackName) {
    const substation = App.findSubstation(substationId);
    return substation ? substation.name : (fallbackName || "Unknown Substation");
  }

  function getFeederReferenceKey(feederId, feederName) {
    return feederId ? "id:" + feederId : "name:" + String(feederName || "").trim().toLowerCase();
  }

  function getFaultIdentityKey(item) {
    return [
      String(item.substationId || "").trim(),
      String(item.date || "").trim(),
      getFeederReferenceKey(item.feederId, item.feederName),
      String(item.faultType || "").trim().toUpperCase(),
      normalizeFaultTime(item.startTime),
      normalizeFaultTime(item.endTime)
    ].join("|");
  }

  function buildAutoFaultKey(substationId, dateValue, feederId, feederName, startTime, endTime, source) {
    return [
      String(substationId || "").trim(),
      String(dateValue || "").trim(),
      getFeederReferenceKey(feederId, feederName),
      "LS",
      normalizeFaultTime(startTime),
      normalizeFaultTime(endTime),
      String(source || "AUTO_GAP").trim().toUpperCase()
    ].join("|");
  }

  function getFaultSortStamp(item) {
    const sortTime = normalizeFaultTime(item && item.startTime) || "00:00";
    const safeTime = sortTime === "24:00" ? "23:59" : sortTime;
    const stamp = new Date(String(item.date || "") + "T" + safeTime).getTime();
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function sortFaultRecords(records) {
    return (Array.isArray(records) ? records.slice() : []).sort(function (left, right) {
      const timeDiff = getFaultSortStamp(left) - getFaultSortStamp(right);
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return String(left.feederName || "").localeCompare(String(right.feederName || ""));
    });
  }

  function getEditingRecord() {
    const state = getModuleState();
    return state.editingId ? App.storage.findById("faults", state.editingId) : null;
  }

  function getSubstationFeederOptions(substationId) {
    const substation = App.findSubstation(substationId);
    if (!substation || !Array.isArray(substation.feeders)) {
      return [];
    }

    return App.sortFeeders(substation.feeders).filter(function (feeder) {
      return !App.isTotalFeeder(feeder) && feeder.isVisible !== false;
    });
  }

  function renderFeederOptions(substationId, selectedFeederId, selectedName) {
    const options = ['<option value="">Select feeder</option>'];
    const feeders = getSubstationFeederOptions(substationId);
    let fallbackSelectedAdded = false;

    feeders.forEach(function (feeder) {
      const selected = feeder.id === selectedFeederId || (!selectedFeederId && selectedName && App.getFeederLabel(feeder) === selectedName);
      options.push(
        '<option value="' + App.escapeHtml(feeder.id) + '"' + (selected ? " selected" : "") + ">" + App.escapeHtml(App.getFeederLabel(feeder)) + "</option>"
      );
    });

    if (selectedName && !selectedFeederId) {
      fallbackSelectedAdded = feeders.some(function (feeder) {
        return App.getFeederLabel(feeder) === selectedName;
      });

      if (!fallbackSelectedAdded) {
        options.push('<option value="" selected>' + App.escapeHtml(selectedName) + "</option>");
      }
    }

    return options.join("");
  }

  function renderFaultTypeOptions(selectedValue) {
    return ['<option value="">Select type</option>'].concat(FAULT_TYPES.map(function (faultType) {
      return '<option value="' + App.escapeHtml(faultType) + '"' + (faultType === selectedValue ? " selected" : "") + ">" + App.escapeHtml(faultType) + "</option>";
    })).join("");
  }

  function getDateLabel(dateValue) {
    return dateValue ? App.formatDate(dateValue) : "Not selected";
  }

  function getMonthLabel(monthValue) {
    if (!monthValue || !/^\d{4}-\d{2}$/.test(monthValue)) {
      return "Not selected";
    }

    const parts = monthValue.split("-");
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(date);
  }

  function getDailyReportMeta(substationId, dateValue) {
    return {
      title: "Fault Report",
      substationLabel: substationId ? getSubstationName(substationId, "") : "All substations",
      dateLabel: getDateLabel(dateValue)
    };
  }

  function getMonthlyReportMeta(substationId, monthValue, summary) {
    return {
      title: "Monthly Fault Report",
      substationLabel: substationId ? getSubstationName(substationId, "") : "All substations",
      monthLabel: getMonthLabel(monthValue),
      totalCount: summary.totalQty,
      totalDuration: formatDurationClock(summary.totalMinutes),
      mostAffectedFeeder: summary.mostAffectedFeeder || "-"
    };
  }

  function isBlankKwh(value) {
    return value === "" || value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  }

  function getKwhEntryMode(reading) {
    const meta = reading && reading.meta && reading.meta.kwh ? reading.meta.kwh : {
      entryMode: reading && reading.kwhEntryMode,
      source: reading && reading.kwhSource
    };
    const normalized = String(meta && meta.entryMode || "").trim().toLowerCase();
    const hasNumericValue = Boolean(reading && !isBlankKwh(reading.kwh) && Number.isFinite(Number(reading.kwh)));

    if (normalized === "actual" || normalized === "estimated") {
      return hasNumericValue ? normalized : "missing";
    }

    if (normalized === "ls_blocked") {
      return hasNumericValue ? "actual" : "ls_blocked";
    }

    if (normalized === "missing") {
      return hasNumericValue ? "actual" : "missing";
    }

    return hasNumericValue ? "actual" : "missing";
  }

  function isActualKwhReading(reading) {
    return Boolean(reading && !isBlankKwh(reading.kwh) && Number.isFinite(Number(reading.kwh)) && getKwhEntryMode(reading) === "actual");
  }

  function isAutoLsGapReading(reading) {
    const entryMode = getKwhEntryMode(reading);
    return isBlankKwh(reading && reading.kwh) && (entryMode === "missing" || entryMode === "ls_blocked");
  }

  function buildAutoFaultFromRange(record, feeder, startIndex, endIndex) {
    if (!record || !feeder || !Array.isArray(record.rows) || startIndex < 0 || endIndex <= startIndex || !record.rows[startIndex] || !record.rows[endIndex]) {
      return null;
    }

    const startTime = record.rows[startIndex].hour;
    const endTime = record.rows[endIndex].hour;
    const durationMinutes = (endIndex - startIndex) * 60;

    if (durationMinutes <= 0) {
      return null;
    }

    return {
      id: "",
      date: record.date,
      substationId: record.substationId,
      substationName: (record.substationSnapshot && record.substationSnapshot.name) || getSubstationName(record.substationId, ""),
      feederId: feeder.id,
      feederName: App.getFeederLabel(feeder),
      startTime: startTime,
      endTime: endTime,
      durationMinutes: durationMinutes,
      faultType: "LS",
      source: "AUTO_GAP",
      autoRule: "MISSING_KWH",
      autoKey: buildAutoFaultKey(record.substationId, record.date, feeder.id, App.getFeederLabel(feeder), startTime, endTime, "AUTO_GAP"),
      remark: "Auto-detected"
    };
  }

  function buildAutoLsFaultsForRecord(record) {
    if (!record || !Array.isArray(record.rows) || !record.rows.length) {
      return [];
    }

    const feeders = App.sortFeeders(record.feederSnapshot || []).filter(function (feeder) {
      return !App.isTotalFeeder(feeder) && feeder.isVisible !== false;
    });

    const autoFaults = [];

    feeders.forEach(function (feeder) {
      let lastActualIndex = -1;
      let missingStartIndex = -1;
      let hasEstimatedSinceLastActual = false;

      record.rows.forEach(function (row, rowIndex) {
        const reading = row && row.feederReadings ? row.feederReadings[feeder.id] : null;
        const isActual = isActualKwhReading(reading);

        if (isActual) {
          if (missingStartIndex !== -1 && lastActualIndex !== -1) {
            const autoFault = buildAutoFaultFromRange(record, feeder, lastActualIndex, rowIndex - 1);
            if (autoFault) {
              autoFaults.push(autoFault);
            }
          }

          lastActualIndex = rowIndex;
          missingStartIndex = -1;
          hasEstimatedSinceLastActual = false;
          return;
        }

        if (isAutoLsGapReading(reading)) {
          if (lastActualIndex !== -1 && !hasEstimatedSinceLastActual && missingStartIndex === -1) {
            missingStartIndex = rowIndex;
          }
          return;
        }

        if (lastActualIndex !== -1) {
          hasEstimatedSinceLastActual = true;
        }

        if (missingStartIndex !== -1) {
          missingStartIndex = -1;
        }
      });

      if (missingStartIndex !== -1 && lastActualIndex !== -1 && !hasEstimatedSinceLastActual) {
        const autoFault = buildAutoFaultFromRange(record, feeder, lastActualIndex, record.rows.length - 1);
        if (autoFault) {
          autoFaults.push(autoFault);
        }
      }
    });

    return autoFaults;
  }

  function getAutoSuppressionMap() {
    return App.storage.getCollection("faultAutoSuppressions").reduce(function (accumulator, item) {
      if (item.autoKey) {
        accumulator[item.autoKey] = true;
      }
      return accumulator;
    }, {});
  }

  function getDerivedFaultsFromDailyLog(record) {
    const dailylogModule = App.modules.dailylog || {};
    const derived = [];

    if (typeof dailylogModule.buildAutoGapFaults === "function") {
      derived.push.apply(derived, dailylogModule.buildAutoGapFaults(record));
    } else {
      derived.push.apply(derived, buildAutoLsFaultsForRecord(record));
    }

    if (typeof dailylogModule.buildEventDerivedFaults === "function") {
      derived.push.apply(derived, dailylogModule.buildEventDerivedFaults(record));
    }

    return derived.map(function (item) {
      return Object.assign({}, item, {
        source: normalizeSource(item.source)
      });
    });
  }

  function syncGeneratedFaults() {
    const faults = App.storage.getCollection("faults");
    const dailyLogs = App.storage.getCollection("dailyLogs");
    const suppressionMap = getAutoSuppressionMap();
    const desiredAutoFaults = dailyLogs.reduce(function (accumulator, record) {
      return accumulator.concat(getDerivedFaultsFromDailyLog(record));
    }, []);
    const manualOverlapMap = faults.filter(function (item) {
      return !isManagedAutoSource(item.source);
    }).reduce(function (accumulator, item) {
      accumulator[getFaultIdentityKey(item)] = true;
      return accumulator;
    }, {});
    const currentManagedAutoFaults = faults.filter(function (item) {
      return isManagedAutoSource(item.source);
    });
    const unmanagedFaults = faults.filter(function (item) {
      return !isManagedAutoSource(item.source);
    });
    const currentByAutoKey = currentManagedAutoFaults.reduce(function (accumulator, item) {
      accumulator[item.autoKey] = item;
      return accumulator;
    }, {});

    const nextManagedAutoFaults = desiredAutoFaults.reduce(function (accumulator, item) {
      if (!item.autoKey || suppressionMap[item.autoKey] || manualOverlapMap[getFaultIdentityKey(item)]) {
        return accumulator;
      }

      const existing = currentByAutoKey[item.autoKey];
      accumulator.push(Object.assign({}, existing || {}, item, {
        id: existing ? existing.id : "",
        createdAt: existing ? existing.createdAt : ""
      }));
      return accumulator;
    }, []);

    const currentSignature = JSON.stringify(currentManagedAutoFaults.map(function (item) {
      return [item.autoKey, item.feederId, item.faultType, item.startTime, item.endTime, normalizeSource(item.source), item.remark];
    }).sort());
    const nextSignature = JSON.stringify(nextManagedAutoFaults.map(function (item) {
      return [item.autoKey, item.feederId, item.faultType, item.startTime, item.endTime, normalizeSource(item.source), item.remark];
    }).sort());

    if (currentSignature !== nextSignature) {
      App.storage.setCollection("faults", unmanagedFaults.concat(nextManagedAutoFaults));
    }
  }

  function buildFaultSourceBadge(source) {
    const normalized = normalizeSource(source);
    return '<span class="tag fault-source-badge ' + App.escapeHtml(normalized.toLowerCase().replace(/_/g, "-")) + '">' + App.escapeHtml(normalized.replace(/_/g, " ")) + "</span>";
  }

  function buildDailyFaultRows(faults) {
    if (!faults.length) {
      return '<tr><td colspan="8" class="muted-text">No fault records found for the selected day.</td></tr>';
    }

    return faults.map(function (item) {
      return [
        '<tr data-fault-row data-id="' + App.escapeHtml(item.id) + '">',
        "  <td>" + App.escapeHtml(item.feederName || "-") + "</td>",
        "  <td>" + App.escapeHtml(item.startTime || "-") + "</td>",
        "  <td>" + App.escapeHtml(item.endTime || "-") + "</td>",
        "  <td>" + App.escapeHtml(formatDurationClock(item.durationMinutes || 0)) + "</td>",
        "  <td>" + App.escapeHtml(item.faultType || "-") + "</td>",
        "  <td>" + buildFaultSourceBadge(item.source) + "</td>",
        "  <td>" + App.escapeHtml(item.remark || "-") + "</td>",
        '  <td><div class="table-actions">' +
        '    <button type="button" class="secondary-button" data-action="edit-fault" data-id="' + App.escapeHtml(item.id) + '">Edit</button>' +
        '    <button type="button" class="danger-button" data-action="delete-fault" data-id="' + App.escapeHtml(item.id) + '">Delete</button>' +
        "  </div></td>",
        "</tr>"
      ].join("");
    }).join("");
  }

  function getDailyFilteredFaults(substationId, dateValue) {
    return sortFaultRecords(App.storage.getCollection("faults").filter(function (item) {
      if (substationId && item.substationId !== substationId) {
        return false;
      }
      if (dateValue && item.date !== dateValue) {
        return false;
      }
      return true;
    }));
  }

  function getMonthlyFilteredFaults(substationId, monthValue) {
    return sortFaultRecords(App.storage.getCollection("faults").filter(function (item) {
      if (substationId && item.substationId !== substationId) {
        return false;
      }
      if (monthValue && String(item.date || "").slice(0, 7) !== monthValue) {
        return false;
      }
      return true;
    }));
  }

  function initializeFaultAggregate() {
    return MONTHLY_FAULT_TYPES.reduce(function (accumulator, type) {
      accumulator[type] = { qty: 0, minutes: 0 };
      return accumulator;
    }, {
      totalQty: 0,
      totalMinutes: 0
    });
  }

  function buildMonthlySummary(records) {
    const feederMap = {};
    const totals = initializeFaultAggregate();

    records.forEach(function (item) {
      const faultType = String(item.faultType || "").toUpperCase();
      if (MONTHLY_FAULT_TYPES.indexOf(faultType) === -1) {
        return;
      }

      const feederName = item.feederName || "Unknown Feeder";
      if (!feederMap[feederName]) {
        feederMap[feederName] = Object.assign({ feederName: feederName }, initializeFaultAggregate());
      }

      feederMap[feederName][faultType].qty += 1;
      feederMap[feederName][faultType].minutes += Number(item.durationMinutes || 0);
      feederMap[feederName].totalQty += 1;
      feederMap[feederName].totalMinutes += Number(item.durationMinutes || 0);

      totals[faultType].qty += 1;
      totals[faultType].minutes += Number(item.durationMinutes || 0);
      totals.totalQty += 1;
      totals.totalMinutes += Number(item.durationMinutes || 0);
    });

    const rows = Object.keys(feederMap).sort(function (left, right) {
      return left.localeCompare(right);
    }).map(function (feederName) {
      return feederMap[feederName];
    });

    const mostAffectedFeeder = rows.length ? rows.slice().sort(function (left, right) {
      return right.totalMinutes - left.totalMinutes;
    })[0].feederName : "";

    return {
      rows: rows,
      totals: totals,
      totalQty: totals.totalQty,
      totalMinutes: totals.totalMinutes,
      mostAffectedFeeder: mostAffectedFeeder
    };
  }

  function buildMonthlyMatrixTable(summary) {
    if (!summary.rows.length) {
      return '<div class="empty-state">No fault records are available for the selected month.</div>';
    }

    return [
      '<div class="table-shell">',
      '  <table class="compact-table fault-matrix-table">',
      "    <thead>",
      "      <tr>",
      '        <th rowspan="2">Feeder</th>',
      MONTHLY_FAULT_TYPES.map(function (type) {
        return '<th colspan="2">' + App.escapeHtml(type) + "</th>";
      }).join(""),
      '        <th colspan="2">Total</th>',
      "      </tr>",
      "      <tr>",
      MONTHLY_FAULT_TYPES.map(function () {
        return "<th>Qty</th><th>Time</th>";
      }).join(""),
      "        <th>Qty</th><th>Time</th>",
      "      </tr>",
      "    </thead>",
      "    <tbody>",
      summary.rows.map(function (row) {
        return "<tr>" +
          "<td>" + App.escapeHtml(row.feederName) + "</td>" +
          MONTHLY_FAULT_TYPES.map(function (type) {
            return "<td>" + row[type].qty + "</td><td>" + App.escapeHtml(formatDurationClock(row[type].minutes)) + "</td>";
          }).join("") +
          "<td>" + row.totalQty + "</td><td>" + App.escapeHtml(formatDurationClock(row.totalMinutes)) + "</td>" +
        "</tr>";
      }).join(""),
      '      <tr class="fault-grand-total-row"><th>Grand Total</th>' +
      MONTHLY_FAULT_TYPES.map(function (type) {
        return "<th>" + summary.totals[type].qty + "</th><th>" + App.escapeHtml(formatDurationClock(summary.totals[type].minutes)) + "</th>";
      }).join("") +
      "<th>" + summary.totals.totalQty + "</th><th>" + App.escapeHtml(formatDurationClock(summary.totals.totalMinutes)) + "</th></tr>",
      "    </tbody>",
      "  </table>",
      "</div>"
    ].join("");
  }

  function buildDailyPrintHtml(records, meta) {
    return [
      '<section class="module-shell">',
      '  <div class="report-section">',
      '    <div class="report-header">',
      "      <div>",
      "        <h2>" + App.escapeHtml(meta.title || "Fault Report") + "</h2>",
      '        <p class="report-meta">Substation: ' + App.escapeHtml(meta.substationLabel || "-") + "</p>",
      '        <p class="report-meta">Date: ' + App.escapeHtml(meta.dateLabel || "-") + "</p>",
      "      </div>",
      '      <div class="tag">Records: ' + records.length + "</div>",
      "    </div>",
      records.length ? (
        '    <div class="table-shell">' +
        '      <table class="compact-table">' +
        "        <thead><tr><th>Feeder</th><th>From</th><th>To</th><th>Duration</th><th>Type</th><th>Source</th><th>Remark</th></tr></thead>" +
        "        <tbody>" +
        records.map(function (item) {
          return "<tr>" +
            "<td>" + App.escapeHtml(item.feederName || "-") + "</td>" +
            "<td>" + App.escapeHtml(item.startTime || "-") + "</td>" +
            "<td>" + App.escapeHtml(item.endTime || "-") + "</td>" +
            "<td>" + App.escapeHtml(formatDurationClock(item.durationMinutes || 0)) + "</td>" +
            "<td>" + App.escapeHtml(item.faultType || "-") + "</td>" +
            "<td>" + App.escapeHtml(normalizeSource(item.source)) + "</td>" +
            "<td>" + App.escapeHtml(item.remark || "-") + "</td>" +
          "</tr>";
        }).join("") +
        "        </tbody>" +
        "      </table>" +
        "    </div>"
      ) : '<div class="empty-state">No fault records found for the selected day.</div>',
      "  </div>",
      "</section>"
    ].join("");
  }

  function buildMonthlyPrintHtml(summary, meta) {
    return [
      '<section class="module-shell">',
      '  <div class="report-section">',
      '    <div class="report-header">',
      "      <div>",
      "        <h2>" + App.escapeHtml(meta.title || "Monthly Fault Report") + "</h2>",
      '        <p class="report-meta">Substation: ' + App.escapeHtml(meta.substationLabel || "-") + "</p>",
      '        <p class="report-meta">Month: ' + App.escapeHtml(meta.monthLabel || "-") + "</p>",
      "      </div>",
      '      <div class="tag">Total Faults: ' + summary.totalQty + " | Total Duration: " + App.escapeHtml(formatDurationClock(summary.totalMinutes)) + "</div>",
      "    </div>",
      '    <div class="filter-row">',
      '      <div class="tag">Most Affected Feeder: ' + App.escapeHtml(meta.mostAffectedFeeder || "-") + "</div>",
      "    </div>",
      buildMonthlyMatrixTable(summary),
      "  </div>",
      "</section>"
    ].join("");
  }

  function buildPrintHtml(records, filters) {
    const first = records[0] || {};
    const substationId = (filters && filters.substationId) || first.substationId || "";
    const meta = {
      title: "Fault Report",
      substationLabel: substationId ? getSubstationName(substationId, first.substationName || "") : "All substations",
      dateLabel: getDateLabel((filters && filters.date) || first.date || "")
    };

    return buildDailyPrintHtml(sortFaultRecords(records), meta);
  }

  function applyTimeInputBehavior(input) {
    if (!input) {
      return;
    }
    App.attach24HourTimeInput(input, {
      invalidMessage: "Use 24-hour HH:MM format such as 08:15, 14:30, or 24:00."
    });
  }

  function ensureDefaultFilterState() {
    const state = getModuleState();
    const substations = App.getSubstations();
    const firstSubstationId = substations[0] ? substations[0].id : "";

    if (!state.dailySubstationId && firstSubstationId) {
      state.dailySubstationId = firstSubstationId;
    }

    if (!state.monthlySubstationId && firstSubstationId) {
      state.monthlySubstationId = firstSubstationId;
    }

    return state;
  }

  App.registerModule("faults", {
    title: "Fault Register",
    subtitle: "Manual faults plus Daily Log driven AUTO_GAP, AUTO_EVENT, and propagated feeder-wise interruption reporting.",

    buildPrintHtml: buildPrintHtml,
    buildMonthlyPrintHtml: buildMonthlyPrintHtml,
    syncGeneratedFaults: syncGeneratedFaults,

    render: function () {
      syncGeneratedFaults();
      const state = ensureDefaultFilterState();
      const substations = App.getSubstations();
      const editingRecord = getEditingRecord();
      const selectedSubstationId = editingRecord && editingRecord.substationId ? editingRecord.substationId : (state.dailySubstationId || (substations[0] ? substations[0].id : ""));
      const durationValue = editingRecord ? formatDurationClock(editingRecord.durationMinutes || 0) : formatDurationClock(0);
      const dailyFaults = getDailyFilteredFaults(state.dailySubstationId, state.dailyDate);
      const dailyMeta = getDailyReportMeta(state.dailySubstationId, state.dailyDate);
      const monthlyFaults = getMonthlyFilteredFaults(state.monthlySubstationId, state.monthlyMonth);
      const monthlySummary = buildMonthlySummary(monthlyFaults);
      const monthlyMeta = getMonthlyReportMeta(state.monthlySubstationId, state.monthlyMonth, monthlySummary);

      return [
        '<section class="module-shell">',
        '  <div class="module-grid two-col">',
        '    <div class="card">',
        '      <div class="card-header">',
        "        <div>",
        "          <h3>" + App.escapeHtml(state.editingId ? "Edit Fault Entry" : "Add Fault Entry") + "</h3>",
        "          <p>Manual entries are saved directly. Daily Log also generates AUTO_GAP, AUTO_EVENT, and PROPAGATED_EVENT fault rows as needed.</p>",
        "        </div>",
        "      </div>",
        substations.length ? (
          '      <form id="fault-form" class="stack">' +
          '        <input type="hidden" name="id" value="' + App.escapeHtml(editingRecord ? editingRecord.id : "") + '">' +
          '        <div class="form-grid">' +
          '          <div class="field-group"><label for="fault-date">Date</label><input id="fault-date" name="date" type="date" required value="' + App.escapeHtml(editingRecord ? editingRecord.date : state.dailyDate) + '"></div>' +
          '          <div class="field-group"><label for="fault-substation">Substation</label><select id="fault-substation" name="substationId" required>' + App.buildSubstationOptions(selectedSubstationId, false) + "</select></div>" +
          '          <div class="field-group"><label for="fault-operator">Operator Name</label><input id="fault-operator" name="operatorName" type="text" value="' + App.escapeHtml(editingRecord ? editingRecord.operatorName : (App.auth.getSuggestedOperatorName() || "")) + '" placeholder="Your name"></div>' +
          '          <div class="field-group"><label for="fault-feeder">Feeder</label><select id="fault-feeder" name="feederId" required>' + renderFeederOptions(selectedSubstationId, editingRecord ? editingRecord.feederId : "", editingRecord ? editingRecord.feederName : "") + "</select></div>" +
          '          <div class="field-group"><label for="fault-type">Fault Type</label><select id="fault-type" name="faultType" required>' + renderFaultTypeOptions(editingRecord ? editingRecord.faultType : "") + '</select></div>' +
          '          <div class="field-group"><label for="fault-start">Start Time</label><input id="fault-start" name="startTime" type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" required value="' + App.escapeHtml(editingRecord ? editingRecord.startTime : "") + '"><p class="field-note">24-hour format only. Example: 08:15</p></div>' +
          '          <div class="field-group"><label for="fault-end">End Time</label><input id="fault-end" name="endTime" type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" required value="' + App.escapeHtml(editingRecord ? editingRecord.endTime : "") + '"><p class="field-note">Use 24:00 for end-of-day if required.</p></div>' +
          '          <div class="field-group"><label>Duration</label><input id="fault-duration-display" type="text" disabled value="' + App.escapeHtml(durationValue) + '"></div>' +
          '          <div class="field-group"><label>Source</label><input type="text" disabled value="' + App.escapeHtml(editingRecord ? (isManagedAutoSource(editingRecord.source) ? normalizeSource(editingRecord.source).replace(/_/g, " ") + " will become MANUAL after edit" : normalizeSource(editingRecord.source)) : "MANUAL") + '"></div>' +
          '          <div class="field-group full-width"><label for="fault-remark">Remark</label><textarea id="fault-remark" name="remark">' + App.escapeHtml(editingRecord ? editingRecord.remark : "") + "</textarea></div>" +
          "        </div>" +
          '        <div class="form-actions">' +
          '          <button type="submit" class="primary-button">' + App.escapeHtml(state.editingId ? "Update Fault Entry" : "Save Fault Entry") + "</button>" +
          (state.editingId ? '<button type="button" class="secondary-button" id="cancel-fault-edit">Cancel Edit</button>' : "") +
          "        </div>" +
          "      </form>"
        ) : '<div class="empty-state">Add a substation first to start entering fault records.</div>',
        "    </div>",

        '    <div class="stack">',
        '      <div class="card">',
        '        <div class="card-header">',
        "          <div>",
        "            <h3>Daily Fault Report</h3>",
        "            <p>Daily view combines manual entries, auto gap LS, and propagated DLR event-based feeder impacts.</p>",
        "          </div>",
        "        </div>",
        '        <div class="filter-row">',
        '          <div class="field-group"><label for="fault-daily-substation">Substation</label><select id="fault-daily-substation">' + App.buildSubstationOptions(state.dailySubstationId, false) + "</select></div>",
        '          <div class="field-group"><label for="fault-daily-date">Date</label><input id="fault-daily-date" type="date" value="' + App.escapeHtml(state.dailyDate) + '"></div>',
        '          <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="fault-daily-print-button">Print Daily</button></div>',
        "        </div>",
        '        <div class="section-block">',
        '          <div class="section-title-row">',
        "            <div>",
        "              <h4>Fault Report</h4>",
        '              <p class="small-status">Substation and date stay above the chart for screen and print.</p>',
        "            </div>",
        '            <div class="tag">Records: ' + dailyFaults.length + "</div>",
        "          </div>",
        '          <div class="filter-row">',
        '            <div class="tag">Substation: ' + App.escapeHtml(dailyMeta.substationLabel || "All substations") + "</div>",
        '            <div class="tag">Date: ' + App.escapeHtml(dailyMeta.dateLabel) + "</div>",
        "          </div>",
        "        </div>",
        '        <div class="table-shell">',
        '          <table class="compact-table">',
        "            <thead><tr><th>Feeder</th><th>From</th><th>To</th><th>Duration</th><th>Type</th><th>Source</th><th>Remark</th><th>Actions</th></tr></thead>",
        '            <tbody id="fault-daily-table-body">' + buildDailyFaultRows(dailyFaults) + "</tbody>",
        "          </table>",
        "        </div>",
        "      </div>",

        '      <div class="card">',
        '        <div class="card-header">',
        "          <div>",
        "            <h3>Monthly Fault Report</h3>",
        "            <p>Automatic feeder-wise interruption summary from saved manual, auto gap, and propagated event fault records.</p>",
        "          </div>",
        "        </div>",
        '        <div class="filter-row">',
        '          <div class="field-group"><label for="fault-monthly-substation">Substation</label><select id="fault-monthly-substation">' + App.buildSubstationOptions(state.monthlySubstationId, false) + "</select></div>",
        '          <div class="field-group"><label for="fault-monthly-month">Month</label><input id="fault-monthly-month" type="month" value="' + App.escapeHtml(state.monthlyMonth) + '"></div>',
        '          <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="fault-monthly-print-button">Print Monthly</button></div>',
        "        </div>",
        '        <div class="filter-row">',
        '          <div class="tag">Month: ' + App.escapeHtml(monthlyMeta.monthLabel) + "</div>",
        '          <div class="tag">Substation: ' + App.escapeHtml(monthlyMeta.substationLabel) + "</div>",
        '          <div class="tag">Total Fault Count: ' + monthlySummary.totalQty + "</div>",
        '          <div class="tag">Total Fault Duration: ' + App.escapeHtml(formatDurationClock(monthlySummary.totalMinutes)) + "</div>",
        '          <div class="tag">Most Affected Feeder: ' + App.escapeHtml(monthlyMeta.mostAffectedFeeder) + "</div>",
        "        </div>",
        buildMonthlyMatrixTable(monthlySummary),
        "      </div>",
        "    </div>",
        "  </div>",
        "</section>"
      ].join("");
    },

    afterRender: function (container) {
      const state = ensureDefaultFilterState();
      const form = container.querySelector("#fault-form");
      const faultSubstation = container.querySelector("#fault-substation");
      const feederSelect = container.querySelector("#fault-feeder");
      const startTime = container.querySelector("#fault-start");
      const endTime = container.querySelector("#fault-end");
      const durationDisplay = container.querySelector("#fault-duration-display");
      const cancelButton = container.querySelector("#cancel-fault-edit");
      const dailySubstationFilter = container.querySelector("#fault-daily-substation");
      const dailyDateFilter = container.querySelector("#fault-daily-date");
      const dailyPrintButton = container.querySelector("#fault-daily-print-button");
      const monthlySubstationFilter = container.querySelector("#fault-monthly-substation");
      const monthlyMonthFilter = container.querySelector("#fault-monthly-month");
      const monthlyPrintButton = container.querySelector("#fault-monthly-print-button");

      function refreshDuration() {
        if (!durationDisplay) {
          return 0;
        }

        const minutes = calculateFaultDurationMinutes(startTime ? startTime.value : "", endTime ? endTime.value : "");
        durationDisplay.value = formatDurationClock(minutes);
        return minutes;
      }

      if (faultSubstation && feederSelect) {
        faultSubstation.addEventListener("change", function () {
          feederSelect.innerHTML = renderFeederOptions(faultSubstation.value, "", "");
        });
      }

      [startTime, endTime].forEach(function (input) {
        applyTimeInputBehavior(input);
        if (input) {
          input.value = normalizeFaultTime(input.value);
          input.addEventListener("input", refreshDuration);
          input.addEventListener("blur", refreshDuration);
        }
      });

      if (form) {
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          const formData = new FormData(form);
          const date = String(formData.get("date") || "");
          const substationId = String(formData.get("substationId") || "");
          const feederId = String(formData.get("feederId") || "");
          const start = normalizeFaultTime(formData.get("startTime"));
          const end = normalizeFaultTime(formData.get("endTime"));
          const faultType = String(formData.get("faultType") || "");

          if (!date || !substationId || !feederId || !start || !end || !faultType) {
            App.toast("Date, substation, feeder, times, and fault type are required.", "error");
            return;
          }

          if (!parseFaultTime(start) || !parseFaultTime(end)) {
            App.toast("Use 24-hour HH:MM format for start and end time.", "error");
            return;
          }

          const editingRecord = getEditingRecord();
          const feeder = getSubstationFeederOptions(substationId).find(function (item) {
            return item.id === feederId;
          });
          const substation = App.findSubstation(substationId);

          if (!feeder) {
            App.toast("Select a valid feeder.", "error");
            return;
          }

          if (editingRecord && isManagedAutoSource(editingRecord.source) && editingRecord.autoKey) {
            App.storage.upsert("faultAutoSuppressions", {
              autoKey: editingRecord.autoKey,
              substationId: editingRecord.substationId,
              feederId: editingRecord.feederId,
              date: editingRecord.date,
              startTime: editingRecord.startTime,
              endTime: editingRecord.endTime,
              faultType: editingRecord.faultType
            }, "faultsuppress");
          }

          App.storage.upsert("faults", {
            id: String(formData.get("id") || ""),
            date: date,
            substationId: substationId,
            substationName: substation ? substation.name : "",
            feederId: feeder.id,
            feederName: App.getFeederLabel(feeder),
            startTime: start,
            endTime: end,
            durationMinutes: calculateFaultDurationMinutes(start, end),
            faultType: faultType,
            source: "MANUAL",
            autoKey: "",
            autoRule: "",
            operatorName: String(formData.get("operatorName") || "").trim() || App.auth.getSuggestedOperatorName(),
            remark: String(formData.get("remark") || "").trim()
          }, "fault");

          state.editingId = null;
          state.dailySubstationId = substationId;
          state.dailyDate = date;
          App.toast("Fault entry saved locally.");
          App.renderCurrentRoute();
        });
      }

      if (cancelButton) {
        cancelButton.addEventListener("click", function () {
          state.editingId = null;
          App.renderCurrentRoute();
        });
      }

      if (dailySubstationFilter) {
        dailySubstationFilter.addEventListener("change", function () {
          state.dailySubstationId = dailySubstationFilter.value;
          App.renderCurrentRoute();
        });
      }

      if (dailyDateFilter) {
        dailyDateFilter.addEventListener("change", function () {
          state.dailyDate = dailyDateFilter.value || App.getTodayValue();
          App.renderCurrentRoute();
        });
      }

      if (monthlySubstationFilter) {
        monthlySubstationFilter.addEventListener("change", function () {
          state.monthlySubstationId = monthlySubstationFilter.value;
          App.renderCurrentRoute();
        });
      }

      if (monthlyMonthFilter) {
        monthlyMonthFilter.addEventListener("change", function () {
          state.monthlyMonth = monthlyMonthFilter.value || App.getTodayValue().slice(0, 7);
          App.renderCurrentRoute();
        });
      }

      if (dailyPrintButton) {
        dailyPrintButton.addEventListener("click", function () {
          const records = getDailyFilteredFaults(state.dailySubstationId, state.dailyDate);
          App.openPrintWindow("Fault Report", buildDailyPrintHtml(records, getDailyReportMeta(state.dailySubstationId, state.dailyDate)), { orientation: "landscape" });
        });
      }

      if (monthlyPrintButton) {
        monthlyPrintButton.addEventListener("click", function () {
          const records = getMonthlyFilteredFaults(state.monthlySubstationId, state.monthlyMonth);
          const summary = buildMonthlySummary(records);
          App.openPrintWindow("Monthly Fault Report", buildMonthlyPrintHtml(summary, getMonthlyReportMeta(state.monthlySubstationId, state.monthlyMonth, summary)), { orientation: "landscape" });
        });
      }

      container.addEventListener("click", function (event) {
        const editButton = event.target.closest('[data-action="edit-fault"]');
        if (editButton) {
          state.editingId = editButton.getAttribute("data-id");
          App.renderCurrentRoute();
          return;
        }

        const deleteButton = event.target.closest('[data-action="delete-fault"]');
        if (deleteButton) {
          const faultId = deleteButton.getAttribute("data-id");
          const record = App.storage.findById("faults", faultId);
          if (!record) {
            return;
          }

          if (!global.confirm("Delete this fault entry from local storage?")) {
            return;
          }

          if (isManagedAutoSource(record.source) && record.autoKey) {
            App.storage.upsert("faultAutoSuppressions", {
              autoKey: record.autoKey,
              substationId: record.substationId,
              feederId: record.feederId,
              date: record.date,
              startTime: record.startTime,
              endTime: record.endTime,
              faultType: record.faultType
            }, "faultsuppress");
          }

          App.storage.remove("faults", faultId);
          App.toast("Fault entry deleted.", "warning");
          App.renderCurrentRoute();
        }
      });
    }
  });
})(window);
