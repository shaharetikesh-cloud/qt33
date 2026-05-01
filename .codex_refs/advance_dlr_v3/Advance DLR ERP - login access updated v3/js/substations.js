(function (global) {
  const App = global.SubstationRegisterApp;

  function getModuleState() {
    return App.getModuleState("substations", {
      editingId: null
    });
  }

  function getEditingRecord() {
    const state = getModuleState();
    return state.editingId ? App.storage.findById("substations", state.editingId) : null;
  }

  function createBlankFeeder(overrides) {
    return App.storage.createFeederTemplate(Object.assign({
      sortOrder: 1
    }, overrides || {}));
  }

  const FEEDER_TYPE_LABELS = {
    INCOMING_11KV: "11 KV Main INC",
    OUTGOING_11KV: "11 KV Outgoing",
    INCOMING_33KV: "33 KV INC",
    EXPRESS_33KV: "33 KV Express",
    OTHER: "Other",
    TOTAL: "TOTAL"
  };

  function normalizeCtRatioValue(value) {
    return String(value || "").trim().replace(/\s+/g, "");
  }

  function isValidCtRatio(value) {
    return /^\d+\/\d+$/.test(normalizeCtRatioValue(value));
  }

  function getTemplateFeeders(record) {
    if (record && Array.isArray(record.feeders) && record.feeders.length) {
      return App.sortFeeders(record.feeders).filter(function (feeder) {
        return !App.isTotalFeeder(feeder);
      });
    }

    return [createBlankFeeder({ sortOrder: 1, feederType: "OUTGOING_11KV" })];
  }

  function suggestMfFromCtRatio(value) {
    const normalized = normalizeCtRatioValue(value);
    if (!isValidCtRatio(normalized)) {
      return "";
    }

    const parts = normalized.split("/");
    const primary = Number(parts[0]);
    const secondary = Number(parts[1]);
    if (!Number.isFinite(primary) || !Number.isFinite(secondary) || secondary === 0) {
      return "";
    }

    const suggestion = Number((primary / secondary).toFixed(2));
    return Number.isInteger(suggestion) ? String(suggestion) : String(suggestion);
  }

  function buildParentOptions(feeders, currentFeederId, selectedParentId) {
    const options = ['<option value="">No parent INC</option>'];
    const mainParents = App.getMainIncParents(feeders, currentFeederId);

    mainParents.forEach(function (feeder) {
      const selected = feeder.id === selectedParentId ? " selected" : "";
      options.push('<option value="' + App.escapeHtml(feeder.id) + '"' + selected + ">" + App.escapeHtml(App.getFeederLabel(feeder)) + "</option>");
    });

    return options.join("");
  }

  function buildFeederTypeOptions(selectedType) {
    return App.constants.feederTypes.filter(function (type) {
      return type !== "TOTAL";
    }).map(function (type) {
      const selected = type === selectedType ? " selected" : "";
      return '<option value="' + type + '"' + selected + ">" + FEEDER_TYPE_LABELS[type] + "</option>";
    }).join("");
  }

  function renderFeederRows(feeders) {
    const rows = getTemplateFeeders({ feeders: feeders });
    return rows.map(function (feeder, index) {
      const suggestedMf = suggestMfFromCtRatio(feeder.ctRatio);
      const mfValue = String(feeder.mf || "").trim() || suggestedMf;
      const autoMf = !String(feeder.mf || "").trim() || String(feeder.mf || "").trim() === suggestedMf;
      return [
        '<tr data-feeder-row data-feeder-id="' + App.escapeHtml(feeder.id) + '">',
        '  <td><input type="number" min="1" name="sortOrder" value="' + App.escapeHtml(String(feeder.sortOrder || (index + 1))) + '"></td>',
        '  <td class="feeder-name-cell"><input type="text" name="feederName" value="' + App.escapeHtml(App.getFeederLabel(feeder)) + '" placeholder="Feeder name"></td>',
        '  <td><select name="feederType">' + buildFeederTypeOptions(feeder.feederType || "OUTGOING_11KV") + "</select></td>",
        '  <td><select name="parentFeederId">' + buildParentOptions(rows, feeder.id, feeder.parentFeederId || "") + "</select></td>",
        '  <td><input type="text" name="ctRatio" value="' + App.escapeHtml(feeder.ctRatio || "") + '" placeholder="300/5"></td>',
        '  <td><input type="number" step="0.01" min="0" name="mf" value="' + App.escapeHtml(mfValue) + '" placeholder="MF" data-suggested-mf="' + App.escapeHtml(suggestedMf) + '" data-auto-mf="' + (autoMf ? "true" : "false") + '"></td>',
        '  <td class="checkbox-cell"><input type="checkbox" name="isMainInc"' + (feeder.isMainInc ? " checked" : "") + "></td>",
        '  <td class="checkbox-cell"><input type="checkbox" name="isVisible"' + (feeder.isVisible !== false ? " checked" : "") + "></td>",
        '  <td><button type="button" class="danger-button" data-action="remove-feeder-row">Remove</button></td>',
        "</tr>"
      ].join("");
    }).join("");
  }

  function readFeederRows(container) {
    return Array.from(container.querySelectorAll("[data-feeder-row]")).map(function (row, index) {
      const feederType = String(row.querySelector('select[name="feederType"]').value || "").trim().toUpperCase();
      const feederName = String(row.querySelector('input[name="feederName"]').value || "").trim();
      const isMainInc = row.querySelector('input[name="isMainInc"]').checked;
      const isVisible = row.querySelector('input[name="isVisible"]').checked;
      const parentFeederId = String(row.querySelector('select[name="parentFeederId"]').value || "").trim();
      const ctRatio = normalizeCtRatioValue(row.querySelector('input[name="ctRatio"]').value || "");
      const mf = String(row.querySelector('input[name="mf"]').value || "").trim();
      const sortOrder = String(row.querySelector('input[name="sortOrder"]').value || "").trim();

      return {
        id: row.getAttribute("data-feeder-id") || App.storage.createId("feeder"),
        feederName: feederName,
        name: feederName,
        feederType: feederType,
        ctRatio: ctRatio,
        mf: mf,
        parentFeederId: parentFeederId,
        isMainInc: feederType === "INCOMING_11KV" && isMainInc,
        is33kvFeeder: feederType === "INCOMING_33KV" || feederType === "EXPRESS_33KV",
        is33kvExpress: feederType === "EXPRESS_33KV",
        isVisible: isVisible,
        sortOrder: App.toNumber(sortOrder, index + 1)
      };
    });
  }

  function ensureSystemTotal(feederRows) {
    const rows = Array.isArray(feederRows) ? feederRows.slice() : [];
    const totalRows = rows.filter(function (feeder) {
      return feeder.feederType === "TOTAL";
    });

    if (!totalRows.length) {
      rows.push(createBlankFeeder({
        feederName: "TOTAL",
        name: "TOTAL",
        feederType: "TOTAL",
        ctRatio: "1/1",
        mf: "1",
        isVisible: true,
        sortOrder: (rows.length || 0) + 1
      }));
    }

    return rows;
  }

  function validateFeeders(feederRows) {
    const errors = [];
    const rows = ensureSystemTotal(feederRows).map(function (row, index) {
      return Object.assign({}, row, {
        sortOrder: App.toNumber(row.sortOrder, index + 1)
      });
    });

    const names = {};
    const totalRows = rows.filter(function (feeder) {
      return feeder.feederType === "TOTAL";
    });

    if (totalRows.length > 1) {
      errors.push("Only one TOTAL feeder is allowed per substation.");
    }

    rows.forEach(function (feeder, index) {
      const label = feeder.feederType === "TOTAL" ? "TOTAL feeder" : ("Feeder row " + (index + 1));
      const feederName = App.getFeederLabel(feeder);

      if (!feederName) {
        errors.push(label + ": feeder name is required.");
      }

      if (!feeder.feederType) {
        errors.push(label + ": feeder type is required.");
      }

      if (!isValidCtRatio(feeder.ctRatio)) {
        errors.push(label + ": CT ratio is required in ratio format like 300/5 or 100/1.");
      }

      if (feeder.mf === "" || Number.isNaN(Number(feeder.mf))) {
        errors.push(label + ": MF is required and must be numeric.");
      }

      if (feeder.isMainInc && feeder.feederType !== "INCOMING_11KV") {
        errors.push(feederName + ": Main INC can only be used with 11 KV incoming feeder type.");
      }

      if (feeder.parentFeederId && feeder.parentFeederId === feeder.id) {
        errors.push(feederName + ": feeder cannot be parent of itself.");
      }

      const duplicateKey = feederName.toLowerCase();
      if (duplicateKey) {
        if (names[duplicateKey]) {
          errors.push(feederName + ": duplicate feeder names are not allowed in one substation.");
        }
        names[duplicateKey] = true;
      }
    });

    const mainIncomingIds = rows.reduce(function (accumulator, feeder) {
      if (App.isMainIncFeeder(feeder)) {
        accumulator[feeder.id] = true;
      }
      return accumulator;
    }, {});

    rows.forEach(function (feeder) {
      if (feeder.parentFeederId && !mainIncomingIds[feeder.parentFeederId]) {
        errors.push(App.getFeederLabel(feeder) + ": parent feeder must be selected only from Main INC feeders.");
      }
    });

    return {
      isValid: !errors.length,
      errors: errors,
      feeders: App.sortFeeders(rows)
    };
  }

  function updateFeederRowState(row, allFeeders) {
    const typeSelect = row.querySelector('select[name="feederType"]');
    const parentSelect = row.querySelector('select[name="parentFeederId"]');
    const isMainIncCheckbox = row.querySelector('input[name="isMainInc"]');
    const isVisibleCheckbox = row.querySelector('input[name="isVisible"]');
    const feederNameInput = row.querySelector('input[name="feederName"]');
    const ctRatioInput = row.querySelector('input[name="ctRatio"]');
    const mfInput = row.querySelector('input[name="mf"]');
    const feederId = row.getAttribute("data-feeder-id");
    const currentType = String(typeSelect.value || "").trim().toUpperCase();
    const currentParent = parentSelect.value;

    parentSelect.innerHTML = buildParentOptions(allFeeders, feederId, currentParent);

    feederNameInput.readOnly = false;
    isVisibleCheckbox.disabled = false;
    row.classList.remove("total-config-row");

    if (currentType !== "INCOMING_11KV") {
      isMainIncCheckbox.checked = false;
      isMainIncCheckbox.disabled = true;
    } else {
      isMainIncCheckbox.disabled = false;
    }

    if (isMainIncCheckbox.checked || currentType === "INCOMING_33KV" || currentType === "EXPRESS_33KV") {
      parentSelect.value = "";
      parentSelect.disabled = true;
    } else {
      parentSelect.disabled = false;
    }

    if (ctRatioInput && mfInput) {
      const suggestedMf = suggestMfFromCtRatio(ctRatioInput.value);
      const previousSuggested = mfInput.dataset.suggestedMf || "";
      const currentMf = String(mfInput.value || "").trim();
      const shouldAutofill = mfInput.dataset.autoMf === "true" || !currentMf || currentMf === previousSuggested;

      mfInput.dataset.suggestedMf = suggestedMf;
      if (suggestedMf && shouldAutofill) {
        mfInput.value = suggestedMf;
        mfInput.dataset.autoMf = "true";
      } else if (!currentMf) {
        mfInput.dataset.autoMf = "true";
      }
    }
  }

  function refreshFeederUi(container) {
    const draftRows = readFeederRows(container);
    const normalizedDraft = App.sortFeeders(draftRows.map(function (row, index) {
      return Object.assign({}, row, {
        sortOrder: App.toNumber(row.sortOrder, index + 1)
      });
    }));

    Array.from(container.querySelectorAll("[data-feeder-row]")).forEach(function (row) {
      updateFeederRowState(row, normalizedDraft);
    });
  }

  function createFeederSummary(feeders) {
    return App.sortFeeders(feeders).filter(function (feeder) {
      return !App.isTotalFeeder(feeder);
    }).map(function (feeder) {
      const parts = [App.getFeederLabel(feeder), FEEDER_TYPE_LABELS[feeder.feederType] || feeder.feederType];
      if (App.isMainIncFeeder(feeder)) {
        parts.push("Main INC");
      }
      if (feeder.parentFeederId) {
        const parent = App.getFeederMap(feeders)[feeder.parentFeederId];
        parts.push("Parent: " + App.getFeederLabel(parent));
      }
      parts.push("CT " + feeder.ctRatio);
      parts.push("MF " + feeder.mf);
      return '<span class="tag">' + App.escapeHtml(parts.join(" | ")) + "</span>";
    }).join(" ");
  }

  function createSubstationTableRows(substations) {
    return substations.map(function (item, index) {
      const feeders = (Array.isArray(item.feeders) ? item.feeders : []).filter(function (feeder) {
        return !App.isTotalFeeder(feeder);
      });
      const mainIncCount = feeders.filter(App.isMainIncFeeder).length;
      return [
        '<tr data-substation-row>',
        "  <td>" + (index + 1) + "</td>",
        "  <td><strong>" + App.escapeHtml(item.name) + "</strong><br><span class=\"muted-text\">" + App.escapeHtml(item.location || "-") + "</span></td>",
        "  <td>" + App.escapeHtml(item.voltageLevel || "-") + "</td>",
        "  <td>" + App.escapeHtml(item.division || "-") + "</td>",
        "  <td>" + App.escapeHtml(item.circle || "-") + "</td>",
        "  <td>" + feeders.length + "</td>",
        "  <td>" + mainIncCount + "</td>",
        "  <td>" + (createFeederSummary(feeders) || '<span class="muted-text">No feeders</span>') + '<div class="small-status">Battery Sets: ' + App.escapeHtml(String(item.batterySetCount || 1)) + " | Tap Columns: " + App.escapeHtml(String(item.transformerCount || 1)) + "</div></td>",
        '  <td><div class="table-actions">' +
        '    <button type="button" class="secondary-button" data-action="edit-substation" data-id="' + App.escapeHtml(item.id) + '">Edit</button>' +
        '    <button type="button" class="danger-button" data-action="delete-substation" data-id="' + App.escapeHtml(item.id) + '">Delete</button>' +
        "  </div></td>",
        "</tr>"
      ].join("");
    }).join("");
  }

  function cascadeDeleteSubstation(substationId) {
    ["dailyLogs", "faults", "maintenanceLogs", "batteryRecords"].forEach(function (collectionName) {
      const filtered = App.storage.getCollection(collectionName).filter(function (item) {
        return item.substationId !== substationId;
      });
      App.storage.setCollection(collectionName, filtered);
    });
  }

  function filterTableRows(container) {
    const query = container.querySelector("#substation-search").value.trim().toLowerCase();
    const rows = container.querySelectorAll("[data-substation-row]");

    rows.forEach(function (row) {
      const text = row.textContent.toLowerCase();
      row.style.display = !query || text.indexOf(query) >= 0 ? "" : "none";
    });
  }

  App.registerModule("substations", {
    title: "Substation Management",
    subtitle: "Substation master plus feeder-wise CT ratio, MF, parent INC mapping, visibility, and ordering.",

    render: function () {
      const substations = App.getSubstations();
      const editingRecord = getEditingRecord();
      const feeders = getTemplateFeeders(editingRecord);

      return [
        '<section class="module-shell">',
        '  <div class="card">',
        '    <div class="card-header">',
        "      <div>",
        "        <h3>" + App.escapeHtml(editingRecord ? "Edit Substation Master" : "Add Substation Master") + "</h3>",
        "        <p>Feeder CT ratio and MF are managed feeder-wise. Main INC feeders can act as parent feeders for child circuits.</p>",
        "      </div>",
        "    </div>",
        '    <form id="substation-form" class="stack">',
        '      <input type="hidden" name="id" value="' + App.escapeHtml(editingRecord ? editingRecord.id : "") + '">',
        '      <div class="section-block">',
        "        <div class=\"section-title-row\"><h4>Substation Master</h4><p class=\"muted-text\">Basic identity plus battery set count and transformer tap column configuration.</p></div>",
        '        <div class="form-grid">',
        '          <div class="field-group"><label for="substation-name">Substation Name</label><input id="substation-name" name="name" type="text" required value="' + App.escapeHtml(editingRecord ? editingRecord.name : "") + '"></div>',
        '          <div class="field-group"><label for="substation-voltage">Voltage Level</label><input id="substation-voltage" name="voltageLevel" type="text" required placeholder="33/11 KV" value="' + App.escapeHtml(editingRecord ? editingRecord.voltageLevel : "") + '"></div>',
        '          <div class="field-group"><label for="substation-division">Division</label><input id="substation-division" name="division" type="text" required value="' + App.escapeHtml(editingRecord ? editingRecord.division : "") + '"></div>',
        '          <div class="field-group"><label for="substation-circle">Circle</label><input id="substation-circle" name="circle" type="text" value="' + App.escapeHtml(editingRecord ? editingRecord.circle : "") + '"></div>',
        '          <div class="field-group"><label for="substation-battery-count">Battery Sets</label><input id="substation-battery-count" name="batterySetCount" type="number" min="1" max="3" value="' + App.escapeHtml(String(editingRecord ? (editingRecord.batterySetCount || 1) : 1)) + '"></div>',
        '          <div class="field-group"><label for="substation-transformer-count">Tap Position Columns</label><input id="substation-transformer-count" name="transformerCount" type="number" min="1" max="3" value="' + App.escapeHtml(String(editingRecord ? (editingRecord.transformerCount || 1) : 1)) + '"></div>',
        '          <div class="field-group full-width"><label for="substation-location">Location</label><input id="substation-location" name="location" type="text" value="' + App.escapeHtml(editingRecord ? editingRecord.location : "") + '"></div>',
        "        </div>",
        "      </div>",
        '      <div class="section-block">',
        "        <div class=\"section-title-row\"><h4>Feeder Master</h4><p class=\"muted-text\">Total remains system-generated only. Configure 11 KV main INC groups, child feeders, and 33 KV feeders in display order.</p></div>",
        '        <div class="button-row"><button type="button" class="secondary-button" id="add-feeder-button">Add Feeder Row</button></div>',
        '        <div class="table-shell">',
        '          <table class="compact-table feeder-config-table">',
        '            <thead><tr><th>Order</th><th>Name</th><th>Type</th><th>Parent INC</th><th>CT Ratio</th><th>MF</th><th>Main INC</th><th>Visible</th><th>Actions</th></tr></thead>',
        '            <tbody id="feeder-table-body">' + renderFeederRows(feeders) + "</tbody>",
        "          </table>",
        "        </div>",
        '        <p class="field-note">CT Ratio must be stored in practical ratio format like 300/5 or 100/1. MF is auto-suggested from CT ratio but remains editable. TOTAL AMP is system-generated from only 11 KV Main INC feeders and excludes all 33 KV feeders.</p>',
        "      </div>",
        '      <div class="form-actions">',
        '        <button type="submit" class="primary-button">' + App.escapeHtml(editingRecord ? "Update Substation" : "Save Substation") + "</button>",
        editingRecord ? '        <button type="button" class="secondary-button" id="cancel-substation-edit">Cancel Edit</button>' : "",
        "      </div>",
        "    </form>",
        "  </div>",

        '  <div class="card">',
        '    <div class="card-header">',
        "      <div>",
        "        <h3>Saved Substations</h3>",
        "        <p>Search existing substations and review feeder mapping, Main INC count, and configuration.</p>",
        "      </div>",
        '      <div class="tag">' + substations.length + " saved</div>",
        "    </div>",
        '    <div class="search-row">',
        '      <input type="search" id="substation-search" placeholder="Search by substation, division, circle, feeder, or location">',
        "    </div>",
        substations.length ? (
          '    <div class="table-shell">' +
          '      <table class="compact-table">' +
          "        <thead><tr><th>SR</th><th>Substation</th><th>Voltage</th><th>Division</th><th>Circle</th><th>Feeders</th><th>Main INC</th><th>Feeder Summary</th><th>Actions</th></tr></thead>" +
          '        <tbody id="substation-table-body">' + createSubstationTableRows(substations) + "</tbody>" +
          "      </table>" +
          "    </div>"
        ) : '<div class="empty-state">No substations configured yet. Add the first substation and feeder master above.</div>',
        "  </div>",
        "</section>"
      ].join("");
    },

    afterRender: function (container) {
      const state = getModuleState();
      const form = container.querySelector("#substation-form");
      const feederTableBody = container.querySelector("#feeder-table-body");
      const addFeederButton = container.querySelector("#add-feeder-button");
      const cancelEditButton = container.querySelector("#cancel-substation-edit");
      const searchInput = container.querySelector("#substation-search");

      refreshFeederUi(container);

      addFeederButton.addEventListener("click", function () {
        const currentCount = feederTableBody.querySelectorAll("[data-feeder-row]").length;
        feederTableBody.insertAdjacentHTML("beforeend", renderFeederRows([createBlankFeeder({ sortOrder: currentCount + 1 })]));
        refreshFeederUi(container);
      });

      searchInput.addEventListener("input", function () {
        filterTableRows(container);
      });

      feederTableBody.addEventListener("click", function (event) {
        const removeButton = event.target.closest('[data-action="remove-feeder-row"]');
        if (!removeButton) {
          return;
        }

        const row = removeButton.closest("[data-feeder-row]");
        if (feederTableBody.querySelectorAll("[data-feeder-row]").length === 1) {
          const inputs = row.querySelectorAll("input, select");
          inputs.forEach(function (input) {
            if (input.type === "checkbox") {
              input.checked = input.name === "isVisible";
            } else if (input.name === "feederType") {
              input.value = "OUTGOING_11KV";
            } else {
              input.value = "";
            }
          });
          refreshFeederUi(container);
          return;
        }

        row.remove();
        refreshFeederUi(container);
      });

      feederTableBody.addEventListener("input", function (event) {
        const target = event.target;
        if (target && target.name === "mf") {
          const currentValue = String(target.value || "").trim();
          target.dataset.autoMf = !currentValue || currentValue === String(target.dataset.suggestedMf || "") ? "true" : "false";
        }
        refreshFeederUi(container);
      });

      feederTableBody.addEventListener("change", function (event) {
        const target = event.target;
        if (target && target.name === "mf") {
          const currentValue = String(target.value || "").trim();
          target.dataset.autoMf = !currentValue || currentValue === String(target.dataset.suggestedMf || "") ? "true" : "false";
        }
        refreshFeederUi(container);
      });

      form.addEventListener("submit", function (event) {
        event.preventDefault();

        const formData = new FormData(form);
        const name = String(formData.get("name") || "").trim();
        const voltageLevel = String(formData.get("voltageLevel") || "").trim();
        const division = String(formData.get("division") || "").trim();
        const batterySetCount = Math.max(1, Math.min(3, App.toNumber(formData.get("batterySetCount"), 1)));
        const transformerCount = Math.max(1, Math.min(3, App.toNumber(formData.get("transformerCount"), 1)));

        if (!name || !voltageLevel || !division) {
          App.toast("Substation name, voltage level, and division are required.", "error");
          return;
        }

        const feederValidation = validateFeeders(readFeederRows(container));
        if (!feederValidation.isValid) {
          App.toast(feederValidation.errors[0], "error");
          return;
        }

        App.storage.upsert("substations", {
          id: String(formData.get("id") || ""),
          name: name,
          voltageLevel: voltageLevel,
          division: division,
          circle: String(formData.get("circle") || "").trim(),
          location: String(formData.get("location") || "").trim(),
          batterySetCount: batterySetCount,
          transformerCount: transformerCount,
          feeders: feederValidation.feeders
        }, "substation");

        state.editingId = null;
        App.toast("Substation and feeder master saved successfully.");
        App.renderCurrentRoute();
      });

      if (cancelEditButton) {
        cancelEditButton.addEventListener("click", function () {
          state.editingId = null;
          App.renderCurrentRoute();
        });
      }

      container.addEventListener("click", function (event) {
        const editButton = event.target.closest('[data-action="edit-substation"]');
        if (editButton) {
          state.editingId = editButton.getAttribute("data-id");
          App.renderCurrentRoute();
          return;
        }

        const deleteButton = event.target.closest('[data-action="delete-substation"]');
        if (!deleteButton) {
          return;
        }

        const substationId = deleteButton.getAttribute("data-id");
        const substation = App.storage.findById("substations", substationId);
        const confirmDelete = global.confirm("Delete substation \"" + (substation ? substation.name : "") + "\" and all related local records?");
        if (!confirmDelete) {
          return;
        }

        cascadeDeleteSubstation(substationId);
        App.storage.remove("substations", substationId);
        if (state.editingId === substationId) {
          state.editingId = null;
        }
        App.toast("Substation and related local records deleted.", "warning");
        App.renderCurrentRoute();
      });
    }
  });
})(window);
