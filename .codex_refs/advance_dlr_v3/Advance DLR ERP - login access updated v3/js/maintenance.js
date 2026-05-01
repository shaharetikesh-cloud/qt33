(function (global) {
  const App = global.SubstationRegisterApp;

  function getModuleState() {
    const assignedSubstationId = App.auth && App.auth.isSubstationUser && App.auth.isSubstationUser() ? App.auth.getAssignedSubstationId() : "";
    const state = App.getModuleState("maintenance", {
      editingId: null,
      filterSubstationId: assignedSubstationId
    });
    if (assignedSubstationId) {
      state.filterSubstationId = assignedSubstationId;
    }
    return state;
  }

  function getEditingRecord() {
    const state = getModuleState();
    return state.editingId ? App.storage.findById("maintenanceLogs", state.editingId) : null;
  }

  function normalizeMaintenanceTime(value) {
    return App.normalizeTimeInput(value);
  }

  function isValidMaintenanceTime(value) {
    return App.isValid24HourTime(value);
  }

  function getMaintenanceSortStamp(item) {
    const baseDate = new Date(String(item.date || "1970-01-01") + "T00:00");
    const minutes = App.timeToMinutesAllowing2400(item.time || "00:00");

    if (Number.isNaN(baseDate.getTime())) {
      return 0;
    }

    return baseDate.getTime() + (Number.isFinite(minutes) ? minutes : 0) * 60000;
  }

  function buildRows(records) {
    return records.map(function (item, index) {
      const substation = App.findSubstation(item.substationId);
      return [
        "<tr>",
        "  <td>" + (index + 1) + "</td>",
        "  <td>" + App.escapeHtml(App.formatDate(item.date)) + "</td>",
        "  <td>" + App.escapeHtml(substation ? substation.name : (item.substationName || "Unknown Substation")) + "</td>",
        "  <td>" + App.escapeHtml(item.time || "-") + "</td>",
        "  <td>" + App.escapeHtml(item.workDetail || "-") + "</td>",
        "  <td>" + App.escapeHtml(item.remark || "-") + "</td>",
        '  <td><div class="table-actions">' +
        '    <button type="button" class="secondary-button" data-action="edit-maintenance" data-id="' + App.escapeHtml(item.id) + '">Edit</button>' +
        '    <button type="button" class="danger-button" data-action="delete-maintenance" data-id="' + App.escapeHtml(item.id) + '">Delete</button>' +
        "  </div></td>",
        "</tr>"
      ].join("");
    }).join("");
  }

  function buildPrintHtml(records) {
    return [
      '<section class="module-shell">',
      '  <div class="report-section">',
      '    <div class="report-header">',
      "      <div>",
      "        <h2>Maintenance Log Report</h2>",
      '        <p class="report-meta">Filtered local maintenance records</p>',
      "      </div>",
      '      <div class="tag">Records: ' + records.length + "</div>",
      "    </div>",
      records.length ? (
        '    <div class="table-shell">' +
        '      <table class="compact-table">' +
        "        <thead><tr><th>SR</th><th>Date</th><th>Substation</th><th>Time</th><th>Work Detail</th><th>Remark</th></tr></thead>" +
        "        <tbody>" +
        records.map(function (item, index) {
          const substation = App.findSubstation(item.substationId);
          return "<tr>" +
            "<td>" + (index + 1) + "</td>" +
            "<td>" + App.escapeHtml(App.formatDate(item.date)) + "</td>" +
            "<td>" + App.escapeHtml(substation ? substation.name : (item.substationName || "Unknown Substation")) + "</td>" +
            "<td>" + App.escapeHtml(item.time || "-") + "</td>" +
            "<td>" + App.escapeHtml(item.workDetail || "-") + "</td>" +
            "<td>" + App.escapeHtml(item.remark || "-") + "</td>" +
          "</tr>";
        }).join("") +
        "        </tbody>" +
        "      </table>" +
        "    </div>"
      ) : '<div class="empty-state">No maintenance records match the selected filters.</div>',
      "  </div>",
      "</section>"
    ].join("");
  }

  function collectFilteredRecords(container) {
    const substationId = container.querySelector("#maintenance-filter-substation").value;
    const startDate = container.querySelector("#maintenance-filter-start").value;
    const endDate = container.querySelector("#maintenance-filter-end").value;

    return App.storage.getCollection("maintenanceLogs").filter(function (item) {
      if (substationId && item.substationId !== substationId) {
        return false;
      }
      if (startDate && item.date < startDate) {
        return false;
      }
      if (endDate && item.date > endDate) {
        return false;
      }
      return true;
    }).sort(function (left, right) {
      return getMaintenanceSortStamp(right) - getMaintenanceSortStamp(left);
    });
  }

  function applyFilters(container) {
    const records = collectFilteredRecords(container);
    container.querySelector("#maintenance-count").textContent = String(records.length);
    container.querySelector("#maintenance-table-body").innerHTML = buildRows(records);
  }

  App.registerModule("maintenance", {
    title: "Maintenance Log",
    subtitle: "Daily maintenance entries with local save, filters, and printable office-ready record view.",

    buildPrintHtml: buildPrintHtml,

    render: function () {
      const state = getModuleState();
      const records = App.storage.getCollection("maintenanceLogs").sort(function (left, right) {
        return getMaintenanceSortStamp(right) - getMaintenanceSortStamp(left);
      });
      const substations = App.getSubstations();
      const editingRecord = getEditingRecord();
      const selectedSubstationId = editingRecord && editingRecord.substationId ? editingRecord.substationId : (substations[0] ? substations[0].id : "");

      return [
        '<section class="module-shell">',
        '  <div class="module-grid two-col">',
        '    <div class="card">',
        '      <div class="card-header">',
        "        <div>",
        "          <h3>" + App.escapeHtml(state.editingId ? "Edit Maintenance Entry" : "Add Maintenance Entry") + "</h3>",
        "          <p>Save practical maintenance work details for the selected substation and date.</p>",
        "        </div>",
        "      </div>",
        substations.length ? (
          '      <form id="maintenance-form" class="stack">' +
          '        <input type="hidden" name="id" value="' + App.escapeHtml(editingRecord ? editingRecord.id : "") + '">' +
          '        <div class="form-grid">' +
          '          <div class="field-group"><label for="maintenance-date">Date</label><input id="maintenance-date" name="date" type="date" required value="' + App.escapeHtml(editingRecord ? editingRecord.date : App.getTodayValue()) + '"></div>' +
          '          <div class="field-group"><label for="maintenance-substation">Substation</label><select id="maintenance-substation" name="substationId" required>' + App.buildSubstationOptions(selectedSubstationId, false) + "</select></div>" +
          '          <div class="field-group"><label for="maintenance-operator">Operator Name</label><input id="maintenance-operator" name="operatorName" type="text" value="' + App.escapeHtml(editingRecord ? editingRecord.operatorName : (App.auth.getSuggestedOperatorName() || "")) + '" placeholder="Your name"></div>' +
          '          <div class="field-group"><label for="maintenance-time">Time</label><input id="maintenance-time" name="time" type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" required value="' + App.escapeHtml(editingRecord ? editingRecord.time : "") + '"><p class="field-note">24-hour format only. Example: 10:00 or 24:00.</p></div>' +
          '          <div class="field-group full-width"><label for="maintenance-work">Work Detail</label><textarea id="maintenance-work" name="workDetail" required>' + App.escapeHtml(editingRecord ? editingRecord.workDetail : "") + "</textarea></div>" +
          '          <div class="field-group full-width"><label for="maintenance-remark">Remark</label><textarea id="maintenance-remark" name="remark">' + App.escapeHtml(editingRecord ? editingRecord.remark : "") + "</textarea></div>" +
          "        </div>" +
          '        <div class="form-actions">' +
          '          <button type="submit" class="primary-button">' + App.escapeHtml(state.editingId ? "Update Maintenance Entry" : "Save Maintenance Entry") + "</button>" +
          (state.editingId ? '<button type="button" class="secondary-button" id="cancel-maintenance-edit">Cancel Edit</button>' : "") +
          "        </div>" +
          "      </form>"
        ) : '<div class="empty-state">Add a substation first to start using the maintenance log.</div>',
        "    </div>",

        '    <div class="card">',
        '      <div class="card-header">',
        "        <div>",
        "          <h3>Maintenance History</h3>",
        "          <p>Filter by substation and date range, then print the visible maintenance records.</p>",
        "        </div>",
        "      </div>",
        '      <div class="filter-row">',
        '        <div class="field-group"><label for="maintenance-filter-substation">Substation</label><select id="maintenance-filter-substation">' + App.buildSubstationOptions("", false) + "</select></div>",
        '        <div class="field-group"><label for="maintenance-filter-start">From Date</label><input id="maintenance-filter-start" type="date"></div>',
        '        <div class="field-group"><label for="maintenance-filter-end">To Date</label><input id="maintenance-filter-end" type="date"></div>',
        '        <div class="field-group"><label>&nbsp;</label><button type="button" class="secondary-button" id="maintenance-print-button">Print Filtered</button></div>',
        "      </div>",
        '      <div class="list-summary"><span class="muted-text">Visible records</span><strong id="maintenance-count">' + records.length + "</strong></div>",
        records.length ? (
          '      <div class="table-shell">' +
          '        <table class="compact-table">' +
          "          <thead><tr><th>SR</th><th>Date</th><th>Substation</th><th>Time</th><th>Work Detail</th><th>Remark</th><th>Actions</th></tr></thead>" +
          '          <tbody id="maintenance-table-body">' + buildRows(records) + "</tbody>" +
          "        </table>" +
          "      </div>"
        ) : '<div class="empty-state">No maintenance entries saved yet.</div>',
        "    </div>",
        "  </div>",
        "</section>"
      ].join("");
    },

    afterRender: function (container) {
      const state = getModuleState();
      const assignedSubstationId = App.auth.isSubstationUser() ? App.auth.getAssignedSubstationId() : "";
      const form = container.querySelector("#maintenance-form");
      const timeInput = container.querySelector("#maintenance-time");
      const cancelButton = container.querySelector("#cancel-maintenance-edit");
      const printButton = container.querySelector("#maintenance-print-button");
      const formSubstationSelect = container.querySelector("#maintenance-substation");
      const filterSubstationSelect = container.querySelector("#maintenance-filter-substation");
      if (assignedSubstationId) {
        if (formSubstationSelect) { formSubstationSelect.value = assignedSubstationId; formSubstationSelect.disabled = true; }
        if (filterSubstationSelect) { filterSubstationSelect.value = assignedSubstationId; filterSubstationSelect.disabled = true; }
      }

      ["#maintenance-filter-substation", "#maintenance-filter-start", "#maintenance-filter-end"].forEach(function (selector) {
        const input = container.querySelector(selector);
        if (input) {
          input.addEventListener("change", function () {
            applyFilters(container);
          });
        }
      });

      if (timeInput) {
        App.attach24HourTimeInput(timeInput, {
          invalidMessage: "Use 24-hour HH:MM format such as 10:00 or 24:00."
        });
        timeInput.value = normalizeMaintenanceTime(timeInput.value);
      }

      if (form) {
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          const formData = new FormData(form);
          const date = String(formData.get("date") || "");
          const substationId = String(formData.get("substationId") || "");
          const time = normalizeMaintenanceTime(formData.get("time"));
          const workDetail = String(formData.get("workDetail") || "").trim();

          if (!date || !substationId || !time || !workDetail) {
            App.toast("Date, substation, time, and work detail are required.", "error");
            return;
          }

          if (!isValidMaintenanceTime(time)) {
            App.toast("Use 24-hour HH:MM format in the time field.", "error");
            if (timeInput) {
              App.focusAndSelectField(timeInput);
            }
            return;
          }

          const substation = App.findSubstation(substationId);
          App.storage.upsert("maintenanceLogs", {
            id: String(formData.get("id") || ""),
            date: date,
            substationId: substationId,
            substationName: substation ? substation.name : "",
            time: time,
            operatorName: String(formData.get("operatorName") || "").trim() || App.auth.getSuggestedOperatorName(),
            workDetail: workDetail,
            remark: String(formData.get("remark") || "").trim()
          }, "maintenance");

          state.editingId = null;
          App.toast("Maintenance entry saved locally.");
          App.renderCurrentRoute();
        });
      }

      if (cancelButton) {
        cancelButton.addEventListener("click", function () {
          state.editingId = null;
          App.renderCurrentRoute();
        });
      }

      if (printButton) {
        printButton.addEventListener("click", function () {
          App.openPrintWindow("Maintenance Log Report", buildPrintHtml(collectFilteredRecords(container)), { orientation: "landscape" });
        });
      }

      container.addEventListener("click", function (event) {
        const editButton = event.target.closest('[data-action="edit-maintenance"]');
        if (editButton) {
          state.editingId = editButton.getAttribute("data-id");
          App.renderCurrentRoute();
          return;
        }

        const deleteButton = event.target.closest('[data-action="delete-maintenance"]');
        if (deleteButton) {
          if (!global.confirm("Delete this maintenance entry from local storage?")) {
            return;
          }
          App.storage.remove("maintenanceLogs", deleteButton.getAttribute("data-id"));
          App.toast("Maintenance entry deleted.", "warning");
          App.renderCurrentRoute();
        }
      });
    }
  });
})(window);
