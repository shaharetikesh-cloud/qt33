(function (global) {
  const App = global.SubstationRegisterApp;
  const DUTY_TYPES = ["General", "Shift Duty", "24 Hours"];
  const SHIFT_TYPES = ["General", "Shift 1", "Shift 2", "Shift 3", "24 Hours"];
  const YES_NO_OPTIONS = ["Yes", "No"];

  function getModuleState() {
    return App.getModuleState("chargehandover", {
      editingId: null,
      filters: {
        substationId: "",
        dutyType: "",
        shiftType: "",
        startDate: "",
        endDate: "",
        search: ""
      }
    });
  }

  function getEditingRecord() {
    const state = getModuleState();
    return state.editingId ? App.storage.findById("chargeHandoverRecords", state.editingId) : null;
  }

  function buildOptions(options, selectedValue, blankLabel) {
    let html = typeof blankLabel === "string" ? '<option value="">' + App.escapeHtml(blankLabel) + "</option>" : "";
    html += (Array.isArray(options) ? options : []).map(function (item) {
      const value = item && item.value !== undefined ? String(item.value) : String(item);
      const label = item && item.label !== undefined ? String(item.label) : value;
      return '<option value="' + App.escapeHtml(value) + '"' + (value === String(selectedValue || "") ? " selected" : "") + ">" + App.escapeHtml(label) + "</option>";
    }).join("");
    return html;
  }

  function buildSubstationOptions(selectedValue, blankLabel) {
    return buildOptions(App.getSubstations().map(function (item) {
      return { value: item.id, label: item.name };
    }), selectedValue, blankLabel);
  }

  function parseTime(value) {
    return App.parse24HourTime(value);
  }

  function normalizeTime(value) {
    return App.normalizeTimeInput(value);
  }

  function getSubstationName(substationId, fallbackName) {
    const substation = App.findSubstation(substationId);
    return substation ? substation.name : (fallbackName || "");
  }

  function getSortStamp(item) {
    const datePart = String(item.date || "1970-01-01");
    const timePart = normalizeTime(item.chargeTakenTime || item.chargeGivenTime || item.dutyStartTime || "00:00");
    const safeTime = timePart === "24:00" ? "23:59" : timePart;
    const stamp = new Date(datePart + "T" + safeTime).getTime();
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function applyDutyDefaults(form, forceReset) {
    const dutyTypeField = form.querySelector("#charge-handover-duty-type");
    const shiftTypeField = form.querySelector("#charge-handover-shift-type");
    if (!dutyTypeField || !shiftTypeField) {
      return;
    }

    const dutyType = dutyTypeField.value;
    if (dutyType === "General") {
      if (forceReset || !shiftTypeField.value || shiftTypeField.value !== "General") {
        shiftTypeField.value = "General";
      }
      return;
    }

    if (dutyType === "24 Hours") {
      if (forceReset || !shiftTypeField.value || shiftTypeField.value !== "24 Hours") {
        shiftTypeField.value = "24 Hours";
      }
      return;
    }

    if (dutyType === "Shift Duty" && (forceReset || !/^Shift [123]$/.test(shiftTypeField.value))) {
      shiftTypeField.value = "Shift 1";
    }
  }

  function applyTimeValidation(input) {
    if (!input) {
      return;
    }
    App.attach24HourTimeInput(input, {
      invalidMessage: "Use 24-hour HH:MM format such as 06:00, 14:30, or 24:00."
    });
  }

  function getActiveFilters(container) {
    const state = getModuleState();
    if (!container) {
      return Object.assign({}, state.filters);
    }
    return {
      substationId: container.querySelector("#charge-filter-substation").value,
      dutyType: container.querySelector("#charge-filter-duty-type").value,
      shiftType: container.querySelector("#charge-filter-shift-type").value,
      startDate: container.querySelector("#charge-filter-start").value,
      endDate: container.querySelector("#charge-filter-end").value,
      search: container.querySelector("#charge-filter-search").value.trim()
    };
  }

  function collectFilteredRecords(filters) {
    const activeFilters = filters || getActiveFilters();
    const search = String(activeFilters.search || "").trim().toLowerCase();
    return App.storage.getCollection("chargeHandoverRecords").filter(function (item) {
      if (activeFilters.substationId && item.substationId !== activeFilters.substationId) {
        return false;
      }
      if (activeFilters.dutyType && item.dutyType !== activeFilters.dutyType) {
        return false;
      }
      if (activeFilters.shiftType && item.shiftType !== activeFilters.shiftType) {
        return false;
      }
      if (activeFilters.startDate && item.date && item.date < activeFilters.startDate) {
        return false;
      }
      if (activeFilters.endDate && item.date && item.date > activeFilters.endDate) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [
        item.chargeGivenBy,
        item.chargeTakenBy,
        item.remark,
        item.importantInstructions,
        item.pendingWork
      ].some(function (value) {
        return String(value || "").toLowerCase().indexOf(search) !== -1;
      });
    }).sort(function (left, right) {
      return getSortStamp(right) - getSortStamp(left);
    });
  }

  function buildFilterContext(filters) {
    const tags = [];
    if (filters.substationId) {
      tags.push("Substation: " + getSubstationName(filters.substationId, ""));
    }
    if (filters.dutyType) {
      tags.push("Duty Type: " + filters.dutyType);
    }
    if (filters.shiftType) {
      tags.push("Shift Type: " + filters.shiftType);
    }
    if (filters.startDate || filters.endDate) {
      tags.push("Date Range: " + (filters.startDate ? App.formatDate(filters.startDate) : "Start") + " to " + (filters.endDate ? App.formatDate(filters.endDate) : "End"));
    }
    if (filters.search) {
      tags.push('Search: "' + filters.search + '"');
    }
    if (!tags.length) {
      tags.push("Showing all saved handover records");
    }

    return '<div class="filter-row history-filter-tags">' + tags.map(function (item) {
      return '<div class="tag">' + App.escapeHtml(item) + "</div>";
    }).join("") + "</div>";
  }

  function buildRows(records) {
    if (!records.length) {
      return '<tr><td colspan="10" class="muted-text">No charge handover records match the current filters.</td></tr>';
    }

    return records.map(function (item, index) {
      return "<tr>" +
        "<td>" + (index + 1) + "</td>" +
        "<td>" + App.escapeHtml(item.date ? App.formatDate(item.date) : "-") + "</td>" +
        "<td>" + App.escapeHtml(getSubstationName(item.substationId, item.substationName) || "-") + "</td>" +
        "<td>" + App.escapeHtml(item.dutyType || "-") + "</td>" +
        "<td>" + App.escapeHtml(item.shiftType || "-") + "</td>" +
        "<td>" + App.escapeHtml(item.chargeGivenBy || "-") + "</td>" +
        "<td>" + App.escapeHtml(item.chargeTakenBy || "-") + "</td>" +
        "<td>" + App.escapeHtml(item.chargeGivenTime || "-") + "</td>" +
        "<td>" + App.escapeHtml(item.chargeTakenTime || "-") + "</td>" +
        "<td>" + App.escapeHtml(item.remark || "-") + "</td>" +
        '<td><div class="table-actions"><button type="button" class="secondary-button" data-action="edit-charge-handover" data-id="' + App.escapeHtml(item.id) + '">Edit</button><button type="button" class="danger-button" data-action="delete-charge-handover" data-id="' + App.escapeHtml(item.id) + '">Delete</button></div></td>' +
      "</tr>";
    }).join("");
  }

  function buildPrintHtml(records, filters) {
    return [
      '<section class="module-shell">',
      '  <div class="report-section">',
      '    <div class="report-header">',
      "      <div>",
      "        <h2>Charge Handover Register</h2>",
      '        <p class="report-meta">Filtered local charge handover records</p>',
      "      </div>",
      '      <div class="tag">Records: ' + records.length + "</div>",
      "    </div>",
      buildFilterContext(filters),
      '    <div class="table-shell"><table class="compact-table"><thead><tr><th>SR</th><th>Date</th><th>Substation</th><th>Duty Type / Shift</th><th>Given By</th><th>Taken By</th><th>Given Time</th><th>Taken Time</th><th>Remark</th></tr></thead><tbody>' +
      (records.length ? records.map(function (item, index) {
        return "<tr>" +
          "<td>" + (index + 1) + "</td>" +
          "<td>" + App.escapeHtml(item.date ? App.formatDate(item.date) : "-") + "</td>" +
          "<td>" + App.escapeHtml(getSubstationName(item.substationId, item.substationName) || "-") + "</td>" +
          "<td>" + App.escapeHtml((item.dutyType || "-") + " / " + (item.shiftType || "-")) + "</td>" +
          "<td>" + App.escapeHtml(item.chargeGivenBy || "-") + "</td>" +
          "<td>" + App.escapeHtml(item.chargeTakenBy || "-") + "</td>" +
          "<td>" + App.escapeHtml(item.chargeGivenTime || "-") + "</td>" +
          "<td>" + App.escapeHtml(item.chargeTakenTime || "-") + "</td>" +
          "<td>" + App.escapeHtml(item.remark || "-") + "</td>" +
        "</tr>";
      }).join("") : '<tr><td colspan="9" class="muted-text">No charge handover records match the selected filters.</td></tr>') +
      "</tbody></table></div>",
      "  </div>",
      "</section>"
    ].join("");
  }

  function applyFilters(container) {
    const state = getModuleState();
    const filters = getActiveFilters(container);
    state.filters = Object.assign({}, filters);
    const records = collectFilteredRecords(filters);
    container.querySelector("#charge-filter-count").textContent = String(records.length);
    container.querySelector("#charge-register-context").innerHTML = buildFilterContext(filters);
    container.querySelector("#charge-table-body").innerHTML = buildRows(records);
  }

  App.registerModule("chargehandover", {
    title: "Charge Handover Register",
    subtitle: "Offline register for shift duty, general duty, and 24-hour reliever handover with practical status notes.",

    render: function () {
      const state = getModuleState();
      const editingRecord = getEditingRecord();
      const filters = state.filters;
      const records = collectFilteredRecords(filters);
      const dutyTypeValue = editingRecord ? (editingRecord.dutyType || "General") : "General";
      const shiftTypeValue = editingRecord ? (editingRecord.shiftType || (dutyTypeValue === "24 Hours" ? "24 Hours" : "General")) : "General";

      return [
        '<section class="module-shell">',
        '  <div class="module-grid two-col">',
        '    <div class="card">',
        '      <div class="card-header"><div><h3>' + App.escapeHtml(state.editingId ? "Edit Charge Handover" : "Add Charge Handover") + '</h3><p>Record who handed over charge, who took charge, duty/shift type, and pending instructions. Most fields are optional.</p></div></div>',
        '      <form id="charge-handover-form" class="stack">',
        '        <input type="hidden" name="id" value="' + App.escapeHtml(editingRecord ? editingRecord.id : "") + '">',
        '        <div class="form-grid three-col">',
        '          <div class="field-group"><label for="charge-handover-date">Date</label><input id="charge-handover-date" name="date" type="date" value="' + App.escapeHtml(editingRecord ? editingRecord.date : App.getTodayValue()) + '"></div>',
        '          <div class="field-group"><label for="charge-handover-substation">Substation</label><select id="charge-handover-substation" name="substationId">' + buildSubstationOptions(editingRecord ? editingRecord.substationId : "", "Select substation (optional)") + '</select></div>',
        '          <div class="field-group"><label for="charge-handover-duty-type">Duty Type</label><select id="charge-handover-duty-type" name="dutyType">' + buildOptions(DUTY_TYPES, dutyTypeValue, null) + '</select></div>',
        '          <div class="field-group"><label for="charge-handover-shift-type">Shift Type</label><select id="charge-handover-shift-type" name="shiftType">' + buildOptions(SHIFT_TYPES, shiftTypeValue, null) + '</select></div>',
        '          <div class="field-group"><label for="charge-handover-given-by">Charge Given By</label><input id="charge-handover-given-by" name="chargeGivenBy" type="text" value="' + App.escapeHtml(editingRecord ? editingRecord.chargeGivenBy : "") + '"></div>',
        '          <div class="field-group"><label for="charge-handover-taken-by">Charge Taken By</label><input id="charge-handover-taken-by" name="chargeTakenBy" type="text" value="' + App.escapeHtml(editingRecord ? editingRecord.chargeTakenBy : "") + '"></div>',
        '          <div class="field-group"><label for="charge-handover-given-time">Charge Given Time</label><input id="charge-handover-given-time" name="chargeGivenTime" type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" value="' + App.escapeHtml(editingRecord ? editingRecord.chargeGivenTime : "") + '"></div>',
        '          <div class="field-group"><label for="charge-handover-taken-time">Charge Taken Time</label><input id="charge-handover-taken-time" name="chargeTakenTime" type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" value="' + App.escapeHtml(editingRecord ? editingRecord.chargeTakenTime : "") + '"></div>',
        '          <div class="field-group"><label for="charge-handover-duty-start">Duty Start Time</label><input id="charge-handover-duty-start" name="dutyStartTime" type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" value="' + App.escapeHtml(editingRecord ? editingRecord.dutyStartTime : "") + '"></div>',
        '          <div class="field-group"><label for="charge-handover-duty-end">Duty End Time</label><input id="charge-handover-duty-end" name="dutyEndTime" type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" value="' + App.escapeHtml(editingRecord ? editingRecord.dutyEndTime : "") + '"></div>',
        '          <div class="field-group"><label for="charge-handover-status">General Status</label><input id="charge-handover-status" name="generalStatus" type="text" value="' + App.escapeHtml(editingRecord ? editingRecord.generalStatus : "") + '"></div>',
        '          <div class="field-group"><label for="charge-handover-logbook">Logbook Updated</label><select id="charge-handover-logbook" name="logbookUpdated">' + buildOptions(YES_NO_OPTIONS, editingRecord ? editingRecord.logbookUpdated : "", "Select if available") + '</select></div>',
        '          <div class="field-group full-width"><label for="charge-handover-pending-work">Pending Work</label><textarea id="charge-handover-pending-work" name="pendingWork">' + App.escapeHtml(editingRecord ? editingRecord.pendingWork : "") + '</textarea></div>',
        '          <div class="field-group full-width"><label for="charge-handover-fault-pending">Fault / Outage Pending</label><textarea id="charge-handover-fault-pending" name="faultPending">' + App.escapeHtml(editingRecord ? editingRecord.faultPending : "") + '</textarea></div>',
        '          <div class="field-group full-width"><label for="charge-handover-shutdown-pending">Shutdown / Permit Pending</label><textarea id="charge-handover-shutdown-pending" name="shutdownPending">' + App.escapeHtml(editingRecord ? editingRecord.shutdownPending : "") + '</textarea></div>',
        '          <div class="field-group full-width"><label for="charge-handover-instructions">Important Instructions</label><textarea id="charge-handover-instructions" name="importantInstructions">' + App.escapeHtml(editingRecord ? editingRecord.importantInstructions : "") + '</textarea></div>',
        '          <div class="field-group full-width"><label for="charge-handover-remark">Remark</label><textarea id="charge-handover-remark" name="remark">' + App.escapeHtml(editingRecord ? editingRecord.remark : "") + '</textarea></div>',
        "        </div>",
        '        <div class="form-actions"><button type="submit" class="primary-button">' + App.escapeHtml(state.editingId ? "Update Charge Handover" : "Save Charge Handover") + '</button>' + (state.editingId ? '<button type="button" class="secondary-button" id="charge-handover-cancel">Cancel Edit</button>' : "") + "</div>",
        "      </form>",
        "    </div>",

        '    <div class="card">',
        '      <div class="card-header"><div><h3>Charge Handover History</h3><p>Filter by date range, substation, duty type, shift type, and operator name search. Print the filtered register when required.</p></div></div>',
        '      <div class="filter-row">',
        '        <div class="field-group"><label for="charge-filter-search">Operator Search</label><input id="charge-filter-search" type="text" value="' + App.escapeHtml(filters.search) + '" placeholder="Given by, taken by, remark, instructions"></div>',
        '        <div class="field-group"><label for="charge-filter-substation">Substation</label><select id="charge-filter-substation"><option value="">All substations</option>' + buildSubstationOptions(filters.substationId, null) + '</select></div>',
        '        <div class="field-group"><label for="charge-filter-duty-type">Duty Type</label><select id="charge-filter-duty-type">' + buildOptions(DUTY_TYPES, filters.dutyType, "All duty types") + '</select></div>',
        '        <div class="field-group"><label for="charge-filter-shift-type">Shift Type</label><select id="charge-filter-shift-type">' + buildOptions(SHIFT_TYPES, filters.shiftType, "All shift types") + '</select></div>',
        '        <div class="field-group"><label for="charge-filter-start">From Date</label><input id="charge-filter-start" type="date" value="' + App.escapeHtml(filters.startDate) + '"></div>',
        '        <div class="field-group"><label for="charge-filter-end">To Date</label><input id="charge-filter-end" type="date" value="' + App.escapeHtml(filters.endDate) + '"></div>',
        '        <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="charge-filter-print">Print Filtered</button></div>',
        "      </div>",
        '      <div id="charge-register-context">' + buildFilterContext(filters) + '</div>',
        '      <div class="list-summary"><span class="muted-text">Visible records</span><strong id="charge-filter-count">' + records.length + '</strong></div>',
        '      <div class="table-shell"><table class="compact-table"><thead><tr><th>SR</th><th>Date</th><th>Substation</th><th>Duty Type</th><th>Shift Type</th><th>Given By</th><th>Taken By</th><th>Given Time</th><th>Taken Time</th><th>Remark</th><th>Actions</th></tr></thead><tbody id="charge-table-body">' + buildRows(records) + '</tbody></table></div>',
        "    </div>",
        "  </div>",
        "</section>"
      ].join("");
    },

    afterRender: function (container) {
      const state = getModuleState();
      const form = container.querySelector("#charge-handover-form");
      const cancelButton = container.querySelector("#charge-handover-cancel");
      const printButton = container.querySelector("#charge-filter-print");

      ["#charge-handover-given-time", "#charge-handover-taken-time", "#charge-handover-duty-start", "#charge-handover-duty-end"].forEach(function (selector) {
        const input = container.querySelector(selector);
        applyTimeValidation(input);
        if (input) {
          input.value = normalizeTime(input.value);
        }
      });

      if (form) {
        App.enableEnterAsTab(form, "input, select, textarea, button");
        applyDutyDefaults(form, false);

        const dutyTypeField = form.querySelector("#charge-handover-duty-type");
        if (dutyTypeField) {
          dutyTypeField.addEventListener("change", function () {
            applyDutyDefaults(form, true);
          });
        }

        form.addEventListener("submit", function (event) {
          event.preventDefault();
          const formData = new FormData(form);
          const timeFields = ["chargeGivenTime", "chargeTakenTime", "dutyStartTime", "dutyEndTime"];
          const normalizedTimes = {};

          for (let index = 0; index < timeFields.length; index += 1) {
            const key = timeFields[index];
            const normalized = normalizeTime(formData.get(key));
            if (normalized && !parseTime(normalized)) {
              App.toast("Use 24-hour HH:MM format in time fields.", "error");
              return;
            }
            normalizedTimes[key] = normalized;
          }

          let dutyType = String(formData.get("dutyType") || "").trim();
          let shiftType = String(formData.get("shiftType") || "").trim();
          if (dutyType === "General" && !shiftType) {
            shiftType = "General";
          } else if (dutyType === "24 Hours" && !shiftType) {
            shiftType = "24 Hours";
          } else if (dutyType === "Shift Duty" && !shiftType) {
            shiftType = "Shift 1";
          }

          const substationId = String(formData.get("substationId") || "").trim();
          const payload = {
            id: String(formData.get("id") || "").trim(),
            date: String(formData.get("date") || "").trim(),
            substationId: substationId,
            substationName: getSubstationName(substationId, ""),
            dutyType: dutyType,
            shiftType: shiftType,
            chargeGivenBy: String(formData.get("chargeGivenBy") || "").trim(),
            chargeTakenBy: String(formData.get("chargeTakenBy") || "").trim(),
            chargeGivenTime: normalizedTimes.chargeGivenTime,
            chargeTakenTime: normalizedTimes.chargeTakenTime,
            dutyStartTime: normalizedTimes.dutyStartTime,
            dutyEndTime: normalizedTimes.dutyEndTime,
            generalStatus: String(formData.get("generalStatus") || "").trim(),
            pendingWork: String(formData.get("pendingWork") || "").trim(),
            faultPending: String(formData.get("faultPending") || "").trim(),
            shutdownPending: String(formData.get("shutdownPending") || "").trim(),
            importantInstructions: String(formData.get("importantInstructions") || "").trim(),
            logbookUpdated: String(formData.get("logbookUpdated") || "").trim(),
            remark: String(formData.get("remark") || "").trim()
          };

          if (!hasAnyValue([
            payload.substationId,
            payload.chargeGivenBy,
            payload.chargeTakenBy,
            payload.chargeGivenTime,
            payload.chargeTakenTime,
            payload.dutyStartTime,
            payload.dutyEndTime,
            payload.generalStatus,
            payload.pendingWork,
            payload.faultPending,
            payload.shutdownPending,
            payload.importantInstructions,
            payload.logbookUpdated,
            payload.remark
          ])) {
            App.toast("Enter at least one practical handover detail before saving.", "error");
            return;
          }

          App.storage.upsert("chargeHandoverRecords", payload, "chargehandover");
          state.editingId = null;
          App.toast("Charge handover record saved locally.");
          App.renderCurrentRoute();
        });
      }

      if (cancelButton) {
        cancelButton.addEventListener("click", function () {
          state.editingId = null;
          App.renderCurrentRoute();
        });
      }

      ["#charge-filter-substation", "#charge-filter-duty-type", "#charge-filter-shift-type", "#charge-filter-start", "#charge-filter-end"].forEach(function (selector) {
        const input = container.querySelector(selector);
        if (input) {
          input.addEventListener("change", function () {
            applyFilters(container);
          });
        }
      });

      const searchInput = container.querySelector("#charge-filter-search");
      if (searchInput) {
        searchInput.addEventListener("input", function () {
          applyFilters(container);
        });
      }

      if (printButton) {
        printButton.addEventListener("click", function () {
          const filters = getActiveFilters(container);
          App.openPrintWindow("Charge Handover Register", buildPrintHtml(collectFilteredRecords(filters), filters), { orientation: "landscape" });
        });
      }

      container.addEventListener("click", function (event) {
        const editButton = event.target.closest('[data-action="edit-charge-handover"]');
        if (editButton) {
          state.editingId = editButton.getAttribute("data-id");
          App.renderCurrentRoute();
          return;
        }

        const deleteButton = event.target.closest('[data-action="delete-charge-handover"]');
        if (deleteButton) {
          if (!global.confirm("Delete this charge handover entry from local storage?")) {
            return;
          }
          App.storage.remove("chargeHandoverRecords", deleteButton.getAttribute("data-id"));
          App.toast("Charge handover entry deleted.", "warning");
          App.renderCurrentRoute();
        }
      });
    }
  });

  function hasAnyValue(values) {
    return values.some(function (value) {
      return String(value === null || value === undefined ? "" : value).trim();
    });
  }
})(window);
