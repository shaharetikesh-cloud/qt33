(function (global) {
  const App = global.SubstationRegisterApp;

  const STATUS_OPTIONS = ["Active", "Replaced", "Removed", "Under Maintenance"];
  const OLTC_OPTIONS = ["OLTC", "Non-OLTC"];
  const EQUIPMENT_TYPES = ["CT", "PT", "Panel", "Battery", "VCB", "Transformer", "Relay", "Cable", "Other"];
  const MODIFICATION_CATEGORIES = [
    "Transformer Added",
    "Transformer Replaced",
    "VCB Changed",
    "CT Changed",
    "PT Changed",
    "Panel Modified",
    "Battery Replaced",
    "Relay Changed",
    "Feeder Renamed",
    "Capacity Upgraded",
    "Civil Work",
    "Other"
  ];
  const TAB_DETAILS = {
    transformer: {
      key: "transformer",
      label: "Transformer History",
      collection: "transformerHistory",
      prefix: "transformerhistory",
      printTitle: "Transformer History Register"
    },
    vcb: {
      key: "vcb",
      label: "VCB / Feeder History",
      collection: "vcbHistory",
      prefix: "vcbhistory",
      printTitle: "VCB / Feeder History Register"
    },
    change: {
      key: "change",
      label: "CT/PT/Panel Change",
      collection: "equipmentChangeHistory",
      prefix: "equipmentchange",
      printTitle: "CT / PT / Panel Change Register"
    },
    modification: {
      key: "modification",
      label: "Modification Log",
      collection: "modificationHistory",
      prefix: "modificationhistory",
      printTitle: "General Modification Log"
    }
  };

  function getModuleState() {
    return App.getModuleState("historyregister", {
      activeTab: "transformer",
      editingIds: {
        transformer: "",
        vcb: "",
        change: "",
        modification: ""
      },
      filters: {
        transformer: {
          search: "",
          substationId: "",
          status: ""
        },
        vcb: {
          search: "",
          substationId: "",
          feederName: "",
          status: ""
        },
        change: {
          search: "",
          substationId: "",
          feederName: "",
          equipmentType: "",
          startDate: "",
          endDate: ""
        },
        modification: {
          search: "",
          substationId: "",
          category: "",
          startDate: "",
          endDate: ""
        }
      }
    });
  }

  function getTabConfig(tabKey) {
    return TAB_DETAILS[tabKey] || TAB_DETAILS.transformer;
  }

  function escape(value) {
    return App.escapeHtml(value);
  }

  function fallback(value) {
    const text = value === null || value === undefined ? "" : String(value).trim();
    return text ? escape(text) : "-";
  }

  function getSubstationName(substationId, fallbackName) {
    const substation = App.findSubstation(substationId);
    return substation ? substation.name : (fallbackName || "");
  }

  function buildOptions(options, selectedValue, blankLabel) {
    let html = typeof blankLabel === "string" ? '<option value="">' + escape(blankLabel) + "</option>" : "";
    html += (Array.isArray(options) ? options : []).map(function (item) {
      const value = item && item.value !== undefined ? String(item.value) : "";
      const label = item && item.label !== undefined ? String(item.label) : value;
      return '<option value="' + escape(value) + '"' + (value === String(selectedValue || "") ? " selected" : "") + ">" + escape(label) + "</option>";
    }).join("");
    return html;
  }

  function buildSubstationOptions(selectedValue, blankLabel) {
    return buildOptions(App.getSubstations().map(function (item) {
      return { value: item.id, label: item.name };
    }), selectedValue, blankLabel);
  }

  function getSubstationFeeders(substationId) {
    const substation = App.findSubstation(substationId);
    if (!substation || !Array.isArray(substation.feeders)) {
      return [];
    }

    return App.sortFeeders(substation.feeders).filter(function (feeder) {
      return !App.isTotalFeeder(feeder);
    });
  }

  function getFeederById(substationId, feederId) {
    return getSubstationFeeders(substationId).find(function (feeder) {
      return feeder.id === feederId;
    }) || null;
  }

  function buildFeederOptions(substationId, selectedValue, blankLabel) {
    return buildOptions(getSubstationFeeders(substationId).map(function (feeder) {
      return { value: feeder.id, label: App.getFeederLabel(feeder) };
    }), selectedValue, blankLabel);
  }

  function getFeederFilterOptions(tabKey, substationId) {
    const config = getTabConfig(tabKey);
    const seen = {};
    const options = [];

    getSubstationFeeders(substationId).forEach(function (feeder) {
      const label = App.getFeederLabel(feeder);
      const key = label.toLowerCase();
      if (label && !seen[key]) {
        seen[key] = true;
        options.push({ value: label, label: label });
      }
    });

    App.storage.getCollection(config.collection).forEach(function (item) {
      if (substationId && item.substationId !== substationId) {
        return;
      }
      const name = String(item.feederName || "").trim();
      const key = name.toLowerCase();
      if (name && !seen[key]) {
        seen[key] = true;
        options.push({ value: name, label: name });
      }
    });

    return options.sort(function (left, right) {
      return left.label.localeCompare(right.label);
    });
  }

  function getEditingRecord(tabKey) {
    const state = getModuleState();
    const config = getTabConfig(tabKey);
    return state.editingIds[tabKey] ? App.storage.findById(config.collection, state.editingIds[tabKey]) : null;
  }

  function hasAnyValue(values) {
    return values.some(function (value) {
      return String(value === null || value === undefined ? "" : value).trim();
    });
  }

  function getTimestamp(record, fields) {
    for (let index = 0; index < fields.length; index += 1) {
      const stamp = new Date(record[fields[index]] || "").getTime();
      if (Number.isFinite(stamp)) {
        return stamp;
      }
    }
    const fallbackStamp = new Date(record.updatedAt || record.createdAt || 0).getTime();
    return Number.isFinite(fallbackStamp) ? fallbackStamp : 0;
  }

  function matchesSearch(record, fields, term) {
    const search = String(term || "").trim().toLowerCase();
    if (!search) {
      return true;
    }

    return fields.some(function (fieldName) {
      return String(record[fieldName] || "").toLowerCase().indexOf(search) !== -1;
    });
  }

  function collectFilteredRecords(tabKey, filters) {
    const records = App.storage.getCollection(getTabConfig(tabKey).collection);

    if (tabKey === "transformer") {
      return records.filter(function (item) {
        return (!filters.substationId || item.substationId === filters.substationId) &&
          (!filters.status || item.status === filters.status) &&
          matchesSearch(item, ["transformerName", "serialNumber", "manufacturerCompany", "mvaCapacity", "voltageRatio", "remark"], filters.search);
      }).sort(function (left, right) {
        return getTimestamp(right, ["installedDate", "manufacturingDate"]) - getTimestamp(left, ["installedDate", "manufacturingDate"]);
      });
    }

    if (tabKey === "vcb") {
      return records.filter(function (item) {
        return (!filters.substationId || item.substationId === filters.substationId) &&
          (!filters.feederName || item.feederName === filters.feederName) &&
          (!filters.status || item.status === filters.status) &&
          matchesSearch(item, ["feederName", "vcbName", "vcbType", "panelName", "serialNumber", "remark"], filters.search);
      }).sort(function (left, right) {
        return getTimestamp(right, ["installedDate", "manufacturingDate"]) - getTimestamp(left, ["installedDate", "manufacturingDate"]);
      });
    }

    if (tabKey === "change") {
      return records.filter(function (item) {
        return (!filters.substationId || item.substationId === filters.substationId) &&
          (!filters.feederName || item.feederName === filters.feederName) &&
          (!filters.equipmentType || item.equipmentType === filters.equipmentType) &&
          (!filters.startDate || !item.date || item.date >= filters.startDate) &&
          (!filters.endDate || !item.date || item.date <= filters.endDate) &&
          matchesSearch(item, ["equipmentName", "feederName", "oldDetails", "newDetails", "reasonForChange", "agency", "approvedBy", "remark"], filters.search);
      }).sort(function (left, right) {
        return getTimestamp(right, ["date"]) - getTimestamp(left, ["date"]);
      });
    }

    return records.filter(function (item) {
      return (!filters.substationId || item.substationId === filters.substationId) &&
        (!filters.category || item.category === filters.category) &&
        (!filters.startDate || !item.date || item.date >= filters.startDate) &&
        (!filters.endDate || !item.date || item.date <= filters.endDate) &&
        matchesSearch(item, ["category", "relatedEquipment", "oldDetails", "newDetails", "workDoneBy", "agency", "remark"], filters.search);
    }).sort(function (left, right) {
      return getTimestamp(right, ["date"]) - getTimestamp(left, ["date"]);
    });
  }

  function buildTabButtons(activeTab) {
    return Object.keys(TAB_DETAILS).map(function (tabKey) {
      const config = getTabConfig(tabKey);
      return '<button type="button" class="history-tab-button' + (tabKey === activeTab ? " active" : "") + '" data-history-tab="' + escape(tabKey) + '">' + escape(config.label) + "</button>";
    }).join("");
  }

  function buildStatusOptions(selectedValue, blankLabel) {
    return buildOptions(STATUS_OPTIONS.map(function (value) {
      return { value: value, label: value };
    }), selectedValue, blankLabel);
  }

  function buildOltcOptions(selectedValue, blankLabel) {
    return buildOptions(OLTC_OPTIONS.map(function (value) {
      return { value: value, label: value };
    }), selectedValue, blankLabel);
  }

  function buildEquipmentTypeOptions(selectedValue, blankLabel) {
    return buildOptions(EQUIPMENT_TYPES.map(function (value) {
      return { value: value, label: value };
    }), selectedValue, blankLabel);
  }

  function buildCategoryOptions(selectedValue, blankLabel) {
    return buildOptions(MODIFICATION_CATEGORIES.map(function (value) {
      return { value: value, label: value };
    }), selectedValue, blankLabel);
  }

  function buildTransformerForm(record) {
    return [
      '<form id="history-entry-form" class="stack" data-history-form="transformer">',
      '  <input type="hidden" name="id" value="' + escape(record ? record.id : "") + '">',
      '  <div class="form-grid three-col">',
      '    <div class="field-group"><label for="history-transformer-substation">Substation</label><select id="history-transformer-substation" name="substationId">' + buildSubstationOptions(record ? record.substationId : "", "Select substation (optional)") + '</select></div>',
      '    <div class="field-group"><label for="history-transformer-name">Transformer Name / Code</label><input id="history-transformer-name" name="transformerName" type="text" value="' + escape(record ? record.transformerName : "") + '"></div>',
      '    <div class="field-group"><label for="history-transformer-mva">MVA Capacity</label><input id="history-transformer-mva" name="mvaCapacity" type="text" value="' + escape(record ? record.mvaCapacity : "") + '"></div>',
      '    <div class="field-group"><label for="history-transformer-voltage">Voltage Ratio</label><input id="history-transformer-voltage" name="voltageRatio" type="text" value="' + escape(record ? record.voltageRatio : "") + '"></div>',
      '    <div class="field-group"><label for="history-transformer-serial">Serial Number</label><input id="history-transformer-serial" name="serialNumber" type="text" value="' + escape(record ? record.serialNumber : "") + '"></div>',
      '    <div class="field-group"><label for="history-transformer-manufacturer">Manufacturer Company</label><input id="history-transformer-manufacturer" name="manufacturerCompany" type="text" value="' + escape(record ? record.manufacturerCompany : "") + '"></div>',
      '    <div class="field-group"><label for="history-transformer-manufacturing-date">Manufacturing Date</label><input id="history-transformer-manufacturing-date" name="manufacturingDate" type="date" value="' + escape(record ? record.manufacturingDate : "") + '"></div>',
      '    <div class="field-group"><label for="history-transformer-installed-date">Installed / Commissioned Date</label><input id="history-transformer-installed-date" name="installedDate" type="date" value="' + escape(record ? record.installedDate : "") + '"></div>',
      '    <div class="field-group"><label for="history-transformer-agency">Installed By / Agency</label><input id="history-transformer-agency" name="installedByAgency" type="text" value="' + escape(record ? record.installedByAgency : "") + '"></div>',
      '    <div class="field-group"><label for="history-transformer-cooling">Cooling Type</label><input id="history-transformer-cooling" name="coolingType" type="text" value="' + escape(record ? record.coolingType : "") + '"></div>',
      '    <div class="field-group"><label for="history-transformer-oltc">OLTC / Non-OLTC</label><select id="history-transformer-oltc" name="oltcType">' + buildOltcOptions(record ? record.oltcType : "", "Select if available") + '</select></div>',
      '    <div class="field-group"><label for="history-transformer-status">Status</label><select id="history-transformer-status" name="status">' + buildStatusOptions(record ? record.status : "", "Select status (optional)") + '</select></div>',
      '    <div class="field-group full-width"><label for="history-transformer-remark">Remark</label><textarea id="history-transformer-remark" name="remark">' + escape(record ? record.remark : "") + '</textarea></div>',
      "  </div>",
      '  <div class="form-actions">',
      '    <button type="submit" class="primary-button">' + escape(record ? "Update Transformer Record" : "Save Transformer Record") + "</button>",
      record ? '<button type="button" class="secondary-button" data-history-action="cancel-edit">Cancel Edit</button>' : "",
      "  </div>",
      "</form>"
    ].join("");
  }

  function buildVcbForm(record) {
    const substationId = record ? record.substationId : "";
    return [
      '<form id="history-entry-form" class="stack" data-history-form="vcb">',
      '  <input type="hidden" name="id" value="' + escape(record ? record.id : "") + '">',
      '  <div class="form-grid three-col">',
      '    <div class="field-group"><label for="history-vcb-substation">Substation</label><select id="history-vcb-substation" name="substationId" data-history-substation-select="vcb">' + buildSubstationOptions(substationId, "Select substation (optional)") + '</select></div>',
      '    <div class="field-group"><label for="history-vcb-feeder-id">Feeder From Master</label><select id="history-vcb-feeder-id" name="feederId">' + buildFeederOptions(substationId, record ? record.feederId : "", "Select feeder if available") + '</select></div>',
      '    <div class="field-group"><label for="history-vcb-feeder-name">Feeder Name (Manual)</label><input id="history-vcb-feeder-name" name="feederNameManual" type="text" value="' + escape(record ? record.feederName : "") + '"><p class="field-note">Use this if feeder is not in master.</p></div>',
      '    <div class="field-group"><label for="history-vcb-name">VCB Name / ID</label><input id="history-vcb-name" name="vcbName" type="text" value="' + escape(record ? record.vcbName : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-type">VCB Type</label><input id="history-vcb-type" name="vcbType" type="text" value="' + escape(record ? record.vcbType : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-manufacturer">Manufacturer Company</label><input id="history-vcb-manufacturer" name="manufacturerCompany" type="text" value="' + escape(record ? record.manufacturerCompany : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-serial">Serial Number</label><input id="history-vcb-serial" name="serialNumber" type="text" value="' + escape(record ? record.serialNumber : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-manufacturing-date">Manufacturing Date</label><input id="history-vcb-manufacturing-date" name="manufacturingDate" type="date" value="' + escape(record ? record.manufacturingDate : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-installed-date">Installed Date</label><input id="history-vcb-installed-date" name="installedDate" type="date" value="' + escape(record ? record.installedDate : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-agency">Installed By / Agency</label><input id="history-vcb-agency" name="installedByAgency" type="text" value="' + escape(record ? record.installedByAgency : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-panel">Panel Name / Number</label><input id="history-vcb-panel" name="panelName" type="text" value="' + escape(record ? record.panelName : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-ct">CT Ratio</label><input id="history-vcb-ct" name="ctRatio" type="text" value="' + escape(record ? record.ctRatio : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-pt">PT Ratio</label><input id="history-vcb-pt" name="ptRatio" type="text" value="' + escape(record ? record.ptRatio : "") + '"></div>',
      '    <div class="field-group"><label for="history-vcb-status">Status</label><select id="history-vcb-status" name="status">' + buildStatusOptions(record ? record.status : "", "Select status (optional)") + '</select></div>',
      '    <div class="field-group full-width"><label for="history-vcb-remark">Remark</label><textarea id="history-vcb-remark" name="remark">' + escape(record ? record.remark : "") + '</textarea></div>',
      "  </div>",
      '  <div class="form-actions">',
      '    <button type="submit" class="primary-button">' + escape(record ? "Update VCB Record" : "Save VCB Record") + "</button>",
      record ? '<button type="button" class="secondary-button" data-history-action="cancel-edit">Cancel Edit</button>' : "",
      "  </div>",
      "</form>"
    ].join("");
  }

  function buildChangeForm(record) {
    const substationId = record ? record.substationId : "";
    return [
      '<form id="history-entry-form" class="stack" data-history-form="change">',
      '  <input type="hidden" name="id" value="' + escape(record ? record.id : "") + '">',
      '  <div class="form-grid three-col">',
      '    <div class="field-group"><label for="history-change-date">Date</label><input id="history-change-date" name="date" type="date" value="' + escape(record ? record.date : App.getTodayValue()) + '"></div>',
      '    <div class="field-group"><label for="history-change-substation">Substation</label><select id="history-change-substation" name="substationId" data-history-substation-select="change">' + buildSubstationOptions(substationId, "Select substation (optional)") + '</select></div>',
      '    <div class="field-group"><label for="history-change-type">Equipment Type</label><select id="history-change-type" name="equipmentType">' + buildEquipmentTypeOptions(record ? record.equipmentType : "", "Select type (optional)") + '</select></div>',
      '    <div class="field-group"><label for="history-change-feeder-id">Related Feeder</label><select id="history-change-feeder-id" name="feederId">' + buildFeederOptions(substationId, record ? record.feederId : "", "Select feeder if available") + '</select></div>',
      '    <div class="field-group"><label for="history-change-feeder-name">Related Feeder (Manual)</label><input id="history-change-feeder-name" name="feederNameManual" type="text" value="' + escape(record ? record.feederName : "") + '"></div>',
      '    <div class="field-group"><label for="history-change-equipment-name">Equipment Name</label><input id="history-change-equipment-name" name="equipmentName" type="text" value="' + escape(record ? record.equipmentName : "") + '"></div>',
      '    <div class="field-group full-width"><label for="history-change-old">Old Details</label><textarea id="history-change-old" name="oldDetails">' + escape(record ? record.oldDetails : "") + '</textarea></div>',
      '    <div class="field-group full-width"><label for="history-change-new">New Details</label><textarea id="history-change-new" name="newDetails">' + escape(record ? record.newDetails : "") + '</textarea></div>',
      '    <div class="field-group"><label for="history-change-reason">Reason for Change</label><input id="history-change-reason" name="reasonForChange" type="text" value="' + escape(record ? record.reasonForChange : "") + '"></div>',
      '    <div class="field-group"><label for="history-change-agency">Agency / Contractor</label><input id="history-change-agency" name="agency" type="text" value="' + escape(record ? record.agency : "") + '"></div>',
      '    <div class="field-group"><label for="history-change-approved">Approved By</label><input id="history-change-approved" name="approvedBy" type="text" value="' + escape(record ? record.approvedBy : "") + '"></div>',
      '    <div class="field-group full-width"><label for="history-change-remark">Remark</label><textarea id="history-change-remark" name="remark">' + escape(record ? record.remark : "") + '</textarea></div>',
      "  </div>",
      '  <div class="form-actions">',
      '    <button type="submit" class="primary-button">' + escape(record ? "Update Change Record" : "Save Change Record") + "</button>",
      record ? '<button type="button" class="secondary-button" data-history-action="cancel-edit">Cancel Edit</button>' : "",
      "  </div>",
      "</form>"
    ].join("");
  }

  function buildModificationForm(record) {
    return [
      '<form id="history-entry-form" class="stack" data-history-form="modification">',
      '  <input type="hidden" name="id" value="' + escape(record ? record.id : "") + '">',
      '  <div class="form-grid three-col">',
      '    <div class="field-group"><label for="history-mod-date">Date</label><input id="history-mod-date" name="date" type="date" value="' + escape(record ? record.date : App.getTodayValue()) + '"></div>',
      '    <div class="field-group"><label for="history-mod-substation">Substation</label><select id="history-mod-substation" name="substationId">' + buildSubstationOptions(record ? record.substationId : "", "Select substation (optional)") + '</select></div>',
      '    <div class="field-group"><label for="history-mod-category">Category</label><select id="history-mod-category" name="category">' + buildCategoryOptions(record ? record.category : "", "Select category (optional)") + '</select></div>',
      '    <div class="field-group full-width"><label for="history-mod-equipment">Related Equipment / Feeder</label><input id="history-mod-equipment" name="relatedEquipment" type="text" value="' + escape(record ? record.relatedEquipment : "") + '"></div>',
      '    <div class="field-group full-width"><label for="history-mod-old">Old Value / Old Details</label><textarea id="history-mod-old" name="oldDetails">' + escape(record ? record.oldDetails : "") + '</textarea></div>',
      '    <div class="field-group full-width"><label for="history-mod-new">New Value / New Details</label><textarea id="history-mod-new" name="newDetails">' + escape(record ? record.newDetails : "") + '</textarea></div>',
      '    <div class="field-group"><label for="history-mod-work">Work Done By</label><input id="history-mod-work" name="workDoneBy" type="text" value="' + escape(record ? record.workDoneBy : "") + '"></div>',
      '    <div class="field-group"><label for="history-mod-agency">Agency</label><input id="history-mod-agency" name="agency" type="text" value="' + escape(record ? record.agency : "") + '"></div>',
      '    <div class="field-group full-width"><label for="history-mod-remark">Remark</label><textarea id="history-mod-remark" name="remark">' + escape(record ? record.remark : "") + '</textarea></div>',
      "  </div>",
      '  <div class="form-actions">',
      '    <button type="submit" class="primary-button">' + escape(record ? "Update Modification Record" : "Save Modification Record") + "</button>",
      record ? '<button type="button" class="secondary-button" data-history-action="cancel-edit">Cancel Edit</button>' : "",
      "  </div>",
      "</form>"
    ].join("");
  }

  function buildFormPanelHtml() {
    const state = getModuleState();
    const activeTab = state.activeTab;
    const record = getEditingRecord(activeTab);
    let description = "";
    let formHtml = "";

    if (activeTab === "transformer") {
      description = "Store transformer installation details, asset identity, and replacement status. Blank non-essential fields are allowed.";
      formHtml = buildTransformerForm(record);
    } else if (activeTab === "vcb") {
      description = "Capture feeder-wise VCB history with panel and ratio details. Use feeder master selection when available, or manual feeder name as fallback.";
      formHtml = buildVcbForm(record);
    } else if (activeTab === "change") {
      description = "Log change events for CT, PT, panels, relays, batteries, breakers, and similar equipment with optional feeder linkage.";
      formHtml = buildChangeForm(record);
    } else {
      description = "Maintain a general-purpose substation modification history for upgrades, replacements, civil work, and related updates.";
      formHtml = buildModificationForm(record);
    }

    return [
      '<div class="card">',
      '  <div class="card-header">',
      "    <div>",
      "      <h3>" + escape(record ? ("Edit " + getTabConfig(activeTab).label) : ("Add " + getTabConfig(activeTab).label)) + "</h3>",
      "      <p>" + escape(description) + "</p>",
      "    </div>",
      "  </div>",
      formHtml,
      "</div>"
    ].join("");
  }

  function buildFilterSummary(filters, tabKey) {
    const tags = [];
    const substationName = filters.substationId ? getSubstationName(filters.substationId, "") : "";

    if (substationName) {
      tags.push("Substation: " + substationName);
    }
    if (filters.search) {
      tags.push('Search: "' + filters.search + '"');
    }

    if (tabKey === "transformer" && filters.status) {
      tags.push("Status: " + filters.status);
    }

    if (tabKey === "vcb") {
      if (filters.feederName) {
        tags.push("Feeder: " + filters.feederName);
      }
      if (filters.status) {
        tags.push("Status: " + filters.status);
      }
    }

    if (tabKey === "change") {
      if (filters.feederName) {
        tags.push("Feeder: " + filters.feederName);
      }
      if (filters.equipmentType) {
        tags.push("Type: " + filters.equipmentType);
      }
      if (filters.startDate || filters.endDate) {
        tags.push("Date Range: " + (filters.startDate ? App.formatDate(filters.startDate) : "Start") + " to " + (filters.endDate ? App.formatDate(filters.endDate) : "End"));
      }
    }

    if (tabKey === "modification") {
      if (filters.category) {
        tags.push("Category: " + filters.category);
      }
      if (filters.startDate || filters.endDate) {
        tags.push("Date Range: " + (filters.startDate ? App.formatDate(filters.startDate) : "Start") + " to " + (filters.endDate ? App.formatDate(filters.endDate) : "End"));
      }
    }

    if (!tags.length) {
      tags.push("Showing all saved records");
    }

    return tags.map(function (item) {
      return '<div class="tag">' + escape(item) + "</div>";
    }).join("");
  }

  function buildTransformerRows(records) {
    if (!records.length) {
      return '<tr><td colspan="9" class="muted-text">No transformer history records match the current filters.</td></tr>';
    }

    return records.map(function (item, index) {
      return "<tr>" +
        "<td>" + (index + 1) + "</td>" +
        "<td>" + fallback(item.transformerName) + "</td>" +
        "<td>" + fallback(getSubstationName(item.substationId, item.substationName)) + "</td>" +
        "<td>" + fallback(item.mvaCapacity) + "</td>" +
        "<td>" + fallback(item.voltageRatio) + "</td>" +
        "<td>" + fallback(item.installedDate ? App.formatDate(item.installedDate) : "") + "</td>" +
        "<td>" + fallback(item.status) + "</td>" +
        "<td>" + fallback(item.remark) + "</td>" +
        '<td><div class="table-actions"><button type="button" class="secondary-button" data-history-action="edit" data-id="' + escape(item.id) + '">Edit</button><button type="button" class="danger-button" data-history-action="delete" data-id="' + escape(item.id) + '">Delete</button></div></td>' +
      "</tr>";
    }).join("");
  }

  function buildVcbRows(records) {
    if (!records.length) {
      return '<tr><td colspan="9" class="muted-text">No VCB history records match the current filters.</td></tr>';
    }

    return records.map(function (item, index) {
      return "<tr>" +
        "<td>" + (index + 1) + "</td>" +
        "<td>" + fallback(item.vcbName) + "</td>" +
        "<td>" + fallback(item.feederName) + "</td>" +
        "<td>" + fallback(getSubstationName(item.substationId, item.substationName)) + "</td>" +
        "<td>" + fallback(item.panelName) + "</td>" +
        "<td>" + fallback(item.ctRatio) + "</td>" +
        "<td>" + fallback(item.ptRatio) + "</td>" +
        "<td>" + fallback(item.status) + "</td>" +
        '<td><div class="table-actions"><button type="button" class="secondary-button" data-history-action="edit" data-id="' + escape(item.id) + '">Edit</button><button type="button" class="danger-button" data-history-action="delete" data-id="' + escape(item.id) + '">Delete</button></div></td>' +
      "</tr>";
    }).join("");
  }

  function buildChangeRows(records) {
    if (!records.length) {
      return '<tr><td colspan="9" class="muted-text">No equipment change records match the current filters.</td></tr>';
    }

    return records.map(function (item, index) {
      return "<tr>" +
        "<td>" + (index + 1) + "</td>" +
        "<td>" + fallback(item.date ? App.formatDate(item.date) : "") + "</td>" +
        "<td>" + fallback(item.equipmentType) + "</td>" +
        "<td>" + fallback(item.equipmentName) + "</td>" +
        "<td>" + fallback(item.feederName) + "</td>" +
        "<td>" + fallback(getSubstationName(item.substationId, item.substationName)) + "</td>" +
        "<td>" + fallback(item.reasonForChange) + "</td>" +
        "<td>" + fallback(item.agency) + "</td>" +
        '<td><div class="table-actions"><button type="button" class="secondary-button" data-history-action="edit" data-id="' + escape(item.id) + '">Edit</button><button type="button" class="danger-button" data-history-action="delete" data-id="' + escape(item.id) + '">Delete</button></div></td>' +
      "</tr>";
    }).join("");
  }

  function buildModificationRows(records) {
    if (!records.length) {
      return '<tr><td colspan="8" class="muted-text">No modification records match the current filters.</td></tr>';
    }

    return records.map(function (item, index) {
      return "<tr>" +
        "<td>" + (index + 1) + "</td>" +
        "<td>" + fallback(item.date ? App.formatDate(item.date) : "") + "</td>" +
        "<td>" + fallback(item.category) + "</td>" +
        "<td>" + fallback(item.relatedEquipment) + "</td>" +
        "<td>" + fallback(getSubstationName(item.substationId, item.substationName)) + "</td>" +
        "<td>" + fallback(item.workDoneBy) + "</td>" +
        "<td>" + fallback(item.agency) + "</td>" +
        '<td><div class="table-actions"><button type="button" class="secondary-button" data-history-action="edit" data-id="' + escape(item.id) + '">Edit</button><button type="button" class="danger-button" data-history-action="delete" data-id="' + escape(item.id) + '">Delete</button></div></td>' +
      "</tr>";
    }).join("");
  }

  function buildListTable(tabKey, records) {
    if (tabKey === "transformer") {
      return '<div class="table-shell"><table class="compact-table history-register-table"><thead><tr><th>SR</th><th>Transformer</th><th>Substation</th><th>MVA</th><th>Voltage Ratio</th><th>Installed</th><th>Status</th><th>Remark</th><th>Actions</th></tr></thead><tbody>' + buildTransformerRows(records) + "</tbody></table></div>";
    }
    if (tabKey === "vcb") {
      return '<div class="table-shell"><table class="compact-table history-register-table"><thead><tr><th>SR</th><th>VCB</th><th>Feeder</th><th>Substation</th><th>Panel</th><th>CT Ratio</th><th>PT Ratio</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + buildVcbRows(records) + "</tbody></table></div>";
    }
    if (tabKey === "change") {
      return '<div class="table-shell"><table class="compact-table history-register-table"><thead><tr><th>SR</th><th>Date</th><th>Type</th><th>Equipment</th><th>Feeder</th><th>Substation</th><th>Reason</th><th>Agency</th><th>Actions</th></tr></thead><tbody>' + buildChangeRows(records) + "</tbody></table></div>";
    }
    return '<div class="table-shell"><table class="compact-table history-register-table"><thead><tr><th>SR</th><th>Date</th><th>Category</th><th>Related Equipment</th><th>Substation</th><th>Work Done By</th><th>Agency</th><th>Actions</th></tr></thead><tbody>' + buildModificationRows(records) + "</tbody></table></div>";
  }

  function buildTransformerFilters(filters) {
    return '<div class="filter-row"><div class="field-group"><label for="history-filter-search">Search</label><input id="history-filter-search" type="text" data-history-filter="search" placeholder="Search transformer name or serial" value="' + escape(filters.search) + '"></div><div class="field-group"><label for="history-filter-substation">Substation</label><select id="history-filter-substation" data-history-filter="substationId">' + buildSubstationOptions(filters.substationId, "All substations") + '</select></div><div class="field-group"><label for="history-filter-status">Status</label><select id="history-filter-status" data-history-filter="status">' + buildStatusOptions(filters.status, "All status") + '</select></div><div class="field-group"><label>&nbsp;</label><div class="button-row"><button type="button" class="secondary-button" data-history-action="print">Print</button><button type="button" class="secondary-button" data-history-action="export">Export JSON</button><button type="button" class="secondary-button" data-history-action="clear-filters">Clear</button></div></div></div>';
  }

  function buildVcbFilters(filters) {
    return '<div class="filter-row"><div class="field-group"><label for="history-filter-search">Search</label><input id="history-filter-search" type="text" data-history-filter="search" placeholder="Search feeder or VCB name" value="' + escape(filters.search) + '"></div><div class="field-group"><label for="history-filter-substation">Substation</label><select id="history-filter-substation" data-history-filter="substationId">' + buildSubstationOptions(filters.substationId, "All substations") + '</select></div><div class="field-group"><label for="history-filter-feeder">Feeder</label><select id="history-filter-feeder" data-history-filter="feederName">' + buildOptions(getFeederFilterOptions("vcb", filters.substationId), filters.feederName, "All feeders") + '</select></div><div class="field-group"><label for="history-filter-status">Status</label><select id="history-filter-status" data-history-filter="status">' + buildStatusOptions(filters.status, "All status") + '</select></div><div class="field-group"><label>&nbsp;</label><div class="button-row"><button type="button" class="secondary-button" data-history-action="print">Print</button><button type="button" class="secondary-button" data-history-action="export">Export JSON</button><button type="button" class="secondary-button" data-history-action="clear-filters">Clear</button></div></div></div>';
  }

  function buildChangeFilters(filters) {
    return '<div class="filter-row"><div class="field-group"><label for="history-filter-search">Search</label><input id="history-filter-search" type="text" data-history-filter="search" placeholder="Search equipment, reason, or feeder" value="' + escape(filters.search) + '"></div><div class="field-group"><label for="history-filter-substation">Substation</label><select id="history-filter-substation" data-history-filter="substationId">' + buildSubstationOptions(filters.substationId, "All substations") + '</select></div><div class="field-group"><label for="history-filter-feeder">Feeder</label><select id="history-filter-feeder" data-history-filter="feederName">' + buildOptions(getFeederFilterOptions("change", filters.substationId), filters.feederName, "All feeders") + '</select></div><div class="field-group"><label for="history-filter-type">Equipment Type</label><select id="history-filter-type" data-history-filter="equipmentType">' + buildEquipmentTypeOptions(filters.equipmentType, "All types") + '</select></div><div class="field-group"><label for="history-filter-start">From Date</label><input id="history-filter-start" type="date" data-history-filter="startDate" value="' + escape(filters.startDate) + '"></div><div class="field-group"><label for="history-filter-end">To Date</label><input id="history-filter-end" type="date" data-history-filter="endDate" value="' + escape(filters.endDate) + '"></div><div class="field-group"><label>&nbsp;</label><div class="button-row"><button type="button" class="secondary-button" data-history-action="print">Print</button><button type="button" class="secondary-button" data-history-action="export">Export JSON</button><button type="button" class="secondary-button" data-history-action="clear-filters">Clear</button></div></div></div>';
  }

  function buildModificationFilters(filters) {
    return '<div class="filter-row"><div class="field-group"><label for="history-filter-search">Search</label><input id="history-filter-search" type="text" data-history-filter="search" placeholder="Search category or equipment" value="' + escape(filters.search) + '"></div><div class="field-group"><label for="history-filter-substation">Substation</label><select id="history-filter-substation" data-history-filter="substationId">' + buildSubstationOptions(filters.substationId, "All substations") + '</select></div><div class="field-group"><label for="history-filter-category">Category</label><select id="history-filter-category" data-history-filter="category">' + buildCategoryOptions(filters.category, "All categories") + '</select></div><div class="field-group"><label for="history-filter-start">From Date</label><input id="history-filter-start" type="date" data-history-filter="startDate" value="' + escape(filters.startDate) + '"></div><div class="field-group"><label for="history-filter-end">To Date</label><input id="history-filter-end" type="date" data-history-filter="endDate" value="' + escape(filters.endDate) + '"></div><div class="field-group"><label>&nbsp;</label><div class="button-row"><button type="button" class="secondary-button" data-history-action="print">Print</button><button type="button" class="secondary-button" data-history-action="export">Export JSON</button><button type="button" class="secondary-button" data-history-action="clear-filters">Clear</button></div></div></div>';
  }

  function buildListPanelHtml() {
    const state = getModuleState();
    const activeTab = state.activeTab;
    const filters = state.filters[activeTab];
    const records = collectFilteredRecords(activeTab, filters);
    let description = "";
    let filterHtml = "";

    if (activeTab === "transformer") {
      description = "Search by transformer name and filter by substation or current status.";
      filterHtml = buildTransformerFilters(filters);
    } else if (activeTab === "vcb") {
      description = "Filter feeder-wise VCB records and print the current filtered grid.";
      filterHtml = buildVcbFilters(filters);
    } else if (activeTab === "change") {
      description = "Review CT/PT/panel and related change events with type, feeder, and date filters.";
      filterHtml = buildChangeFilters(filters);
    } else {
      description = "Track general modification entries by category, substation, and date range.";
      filterHtml = buildModificationFilters(filters);
    }

    return [
      '<div class="card">',
      '  <div class="card-header">',
      "    <div>",
      "      <h3>" + escape(getTabConfig(activeTab).label + " Records") + "</h3>",
      "      <p>" + escape(description) + "</p>",
      "    </div>",
      "  </div>",
      filterHtml,
      '  <div class="filter-row history-filter-tags">' + buildFilterSummary(filters, activeTab) + "</div>",
      '  <div class="list-summary"><span class="muted-text">Visible records</span><strong>' + records.length + "</strong></div>",
      buildListTable(activeTab, records),
      "</div>"
    ].join("");
  }

  function buildPrintTable(tabKey, records) {
    if (tabKey === "transformer") {
      return '<div class="table-shell"><table class="compact-table history-register-table"><thead><tr><th>SR</th><th>Transformer</th><th>Substation</th><th>MVA</th><th>Voltage Ratio</th><th>Serial Number</th><th>Installed</th><th>Status</th><th>Remark</th></tr></thead><tbody>' + (records.length ? records.map(function (item, index) {
        return "<tr><td>" + (index + 1) + "</td><td>" + fallback(item.transformerName) + "</td><td>" + fallback(getSubstationName(item.substationId, item.substationName)) + "</td><td>" + fallback(item.mvaCapacity) + "</td><td>" + fallback(item.voltageRatio) + "</td><td>" + fallback(item.serialNumber) + "</td><td>" + fallback(item.installedDate ? App.formatDate(item.installedDate) : "") + "</td><td>" + fallback(item.status) + "</td><td>" + fallback(item.remark) + "</td></tr>";
      }).join("") : '<tr><td colspan="9" class="muted-text">No records match the selected filters.</td></tr>') + "</tbody></table></div>";
    }
    if (tabKey === "vcb") {
      return '<div class="table-shell"><table class="compact-table history-register-table"><thead><tr><th>SR</th><th>VCB</th><th>Feeder</th><th>Substation</th><th>Type</th><th>Panel</th><th>CT Ratio</th><th>PT Ratio</th><th>Status</th></tr></thead><tbody>' + (records.length ? records.map(function (item, index) {
        return "<tr><td>" + (index + 1) + "</td><td>" + fallback(item.vcbName) + "</td><td>" + fallback(item.feederName) + "</td><td>" + fallback(getSubstationName(item.substationId, item.substationName)) + "</td><td>" + fallback(item.vcbType) + "</td><td>" + fallback(item.panelName) + "</td><td>" + fallback(item.ctRatio) + "</td><td>" + fallback(item.ptRatio) + "</td><td>" + fallback(item.status) + "</td></tr>";
      }).join("") : '<tr><td colspan="9" class="muted-text">No records match the selected filters.</td></tr>') + "</tbody></table></div>";
    }
    if (tabKey === "change") {
      return '<div class="table-shell"><table class="compact-table history-register-table"><thead><tr><th>SR</th><th>Date</th><th>Type</th><th>Equipment</th><th>Feeder</th><th>Substation</th><th>Reason</th><th>Agency</th><th>Approved By</th></tr></thead><tbody>' + (records.length ? records.map(function (item, index) {
        return "<tr><td>" + (index + 1) + "</td><td>" + fallback(item.date ? App.formatDate(item.date) : "") + "</td><td>" + fallback(item.equipmentType) + "</td><td>" + fallback(item.equipmentName) + "</td><td>" + fallback(item.feederName) + "</td><td>" + fallback(getSubstationName(item.substationId, item.substationName)) + "</td><td>" + fallback(item.reasonForChange) + "</td><td>" + fallback(item.agency) + "</td><td>" + fallback(item.approvedBy) + "</td></tr>";
      }).join("") : '<tr><td colspan="9" class="muted-text">No records match the selected filters.</td></tr>') + "</tbody></table></div>";
    }
    return '<div class="table-shell"><table class="compact-table history-register-table"><thead><tr><th>SR</th><th>Date</th><th>Category</th><th>Related Equipment</th><th>Substation</th><th>Work Done By</th><th>Agency</th><th>Remark</th></tr></thead><tbody>' + (records.length ? records.map(function (item, index) {
      return "<tr><td>" + (index + 1) + "</td><td>" + fallback(item.date ? App.formatDate(item.date) : "") + "</td><td>" + fallback(item.category) + "</td><td>" + fallback(item.relatedEquipment) + "</td><td>" + fallback(getSubstationName(item.substationId, item.substationName)) + "</td><td>" + fallback(item.workDoneBy) + "</td><td>" + fallback(item.agency) + "</td><td>" + fallback(item.remark) + "</td></tr>";
    }).join("") : '<tr><td colspan="8" class="muted-text">No records match the selected filters.</td></tr>') + "</tbody></table></div>";
  }

  function buildPrintHtml(tabKey, records, filters) {
    return [
      '<section class="module-shell">',
      '  <div class="report-section">',
      '    <div class="report-header">',
      "      <div>",
      "        <h2>" + escape(getTabConfig(tabKey).printTitle) + "</h2>",
      '        <p class="report-meta">Filtered local History Register records</p>',
      "      </div>",
      '      <div class="tag">Records: ' + records.length + "</div>",
      "    </div>",
      '    <div class="filter-row history-filter-tags">' + buildFilterSummary(filters, tabKey) + "</div>",
      buildPrintTable(tabKey, records),
      "  </div>",
      "</section>"
    ].join("");
  }

  function buildExportPayload(tabKey, records, filters) {
    return {
      module: "History Register",
      section: getTabConfig(tabKey).label,
      generatedAt: new Date().toISOString(),
      filters: Object.assign({}, filters),
      records: records
    };
  }

  function renderListPanel(container) {
    const panel = container.querySelector("#history-list-panel");
    if (panel) {
      panel.innerHTML = buildListPanelHtml();
    }
  }

  function updateFilterValue(container, fieldName, value) {
    const state = getModuleState();
    const filters = state.filters[state.activeTab];
    filters[fieldName] = value;
    if (fieldName === "substationId" && (state.activeTab === "vcb" || state.activeTab === "change")) {
      filters.feederName = "";
    }
    renderListPanel(container);
  }

  function resolveFeederSelection(substationId, feederId, manualFeederName) {
    const feeder = feederId ? getFeederById(substationId, feederId) : null;
    const manualName = String(manualFeederName || "").trim();
    if (manualName) {
      return {
        feederId: feeder && App.getFeederLabel(feeder).toLowerCase() === manualName.toLowerCase() ? feeder.id : "",
        feederName: manualName
      };
    }
    return {
      feederId: feeder ? feeder.id : "",
      feederName: feeder ? App.getFeederLabel(feeder) : ""
    };
  }

  function syncFeederFormOptions(container, mode) {
    const substationSelect = container.querySelector('[data-history-substation-select="' + mode + '"]');
    const feederSelect = container.querySelector(mode === "vcb" ? "#history-vcb-feeder-id" : "#history-change-feeder-id");
    if (!substationSelect || !feederSelect) {
      return;
    }
    feederSelect.innerHTML = buildFeederOptions(substationSelect.value, feederSelect.value, "Select feeder if available");
  }

  function handleTransformerSubmit(form) {
    const state = getModuleState();
    const formData = new FormData(form);
    const substationId = String(formData.get("substationId") || "").trim();
    const payload = {
      id: String(formData.get("id") || "").trim(),
      substationId: substationId,
      substationName: getSubstationName(substationId, ""),
      transformerName: String(formData.get("transformerName") || "").trim(),
      mvaCapacity: String(formData.get("mvaCapacity") || "").trim(),
      voltageRatio: String(formData.get("voltageRatio") || "").trim(),
      serialNumber: String(formData.get("serialNumber") || "").trim(),
      manufacturerCompany: String(formData.get("manufacturerCompany") || "").trim(),
      manufacturingDate: String(formData.get("manufacturingDate") || "").trim(),
      installedDate: String(formData.get("installedDate") || "").trim(),
      installedByAgency: String(formData.get("installedByAgency") || "").trim(),
      coolingType: String(formData.get("coolingType") || "").trim(),
      oltcType: String(formData.get("oltcType") || "").trim(),
      status: String(formData.get("status") || "").trim(),
      remark: String(formData.get("remark") || "").trim()
    };

    if (!hasAnyValue([payload.substationId, payload.transformerName, payload.serialNumber, payload.mvaCapacity, payload.remark])) {
      App.toast("Enter at least transformer name, substation, serial number, capacity, or remark before saving.", "error");
      return;
    }

    App.storage.upsert("transformerHistory", payload, "transformerhistory");
    state.editingIds.transformer = "";
    App.toast("Transformer history saved locally.");
    App.renderCurrentRoute();
  }

  function handleVcbSubmit(form) {
    const state = getModuleState();
    const formData = new FormData(form);
    const substationId = String(formData.get("substationId") || "").trim();
    const feeder = resolveFeederSelection(substationId, String(formData.get("feederId") || "").trim(), formData.get("feederNameManual"));
    const payload = {
      id: String(formData.get("id") || "").trim(),
      substationId: substationId,
      substationName: getSubstationName(substationId, ""),
      feederId: feeder.feederId,
      feederName: feeder.feederName,
      vcbName: String(formData.get("vcbName") || "").trim(),
      vcbType: String(formData.get("vcbType") || "").trim(),
      manufacturerCompany: String(formData.get("manufacturerCompany") || "").trim(),
      serialNumber: String(formData.get("serialNumber") || "").trim(),
      manufacturingDate: String(formData.get("manufacturingDate") || "").trim(),
      installedDate: String(formData.get("installedDate") || "").trim(),
      installedByAgency: String(formData.get("installedByAgency") || "").trim(),
      panelName: String(formData.get("panelName") || "").trim(),
      ctRatio: String(formData.get("ctRatio") || "").trim(),
      ptRatio: String(formData.get("ptRatio") || "").trim(),
      status: String(formData.get("status") || "").trim(),
      remark: String(formData.get("remark") || "").trim()
    };

    if (!hasAnyValue([payload.substationId, payload.feederName, payload.vcbName, payload.serialNumber, payload.remark])) {
      App.toast("Enter at least substation, feeder, VCB name, serial number, or remark before saving.", "error");
      return;
    }

    App.storage.upsert("vcbHistory", payload, "vcbhistory");
    state.editingIds.vcb = "";
    App.toast("VCB / feeder history saved locally.");
    App.renderCurrentRoute();
  }

  function handleChangeSubmit(form) {
    const state = getModuleState();
    const formData = new FormData(form);
    const substationId = String(formData.get("substationId") || "").trim();
    const feeder = resolveFeederSelection(substationId, String(formData.get("feederId") || "").trim(), formData.get("feederNameManual"));
    const payload = {
      id: String(formData.get("id") || "").trim(),
      date: String(formData.get("date") || "").trim(),
      substationId: substationId,
      substationName: getSubstationName(substationId, ""),
      equipmentType: String(formData.get("equipmentType") || "").trim(),
      feederId: feeder.feederId,
      feederName: feeder.feederName,
      equipmentName: String(formData.get("equipmentName") || "").trim(),
      oldDetails: String(formData.get("oldDetails") || "").trim(),
      newDetails: String(formData.get("newDetails") || "").trim(),
      reasonForChange: String(formData.get("reasonForChange") || "").trim(),
      agency: String(formData.get("agency") || "").trim(),
      approvedBy: String(formData.get("approvedBy") || "").trim(),
      remark: String(formData.get("remark") || "").trim()
    };

    if (!hasAnyValue([payload.date, payload.equipmentType, payload.equipmentName, payload.oldDetails, payload.newDetails, payload.reasonForChange, payload.remark])) {
      App.toast("Enter at least date, equipment type, equipment name, details, reason, or remark before saving.", "error");
      return;
    }

    App.storage.upsert("equipmentChangeHistory", payload, "equipmentchange");
    state.editingIds.change = "";
    App.toast("Equipment change record saved locally.");
    App.renderCurrentRoute();
  }

  function handleModificationSubmit(form) {
    const state = getModuleState();
    const formData = new FormData(form);
    const substationId = String(formData.get("substationId") || "").trim();
    const payload = {
      id: String(formData.get("id") || "").trim(),
      date: String(formData.get("date") || "").trim(),
      substationId: substationId,
      substationName: getSubstationName(substationId, ""),
      category: String(formData.get("category") || "").trim(),
      relatedEquipment: String(formData.get("relatedEquipment") || "").trim(),
      oldDetails: String(formData.get("oldDetails") || "").trim(),
      newDetails: String(formData.get("newDetails") || "").trim(),
      workDoneBy: String(formData.get("workDoneBy") || "").trim(),
      agency: String(formData.get("agency") || "").trim(),
      remark: String(formData.get("remark") || "").trim()
    };

    if (!hasAnyValue([payload.date, payload.category, payload.relatedEquipment, payload.oldDetails, payload.newDetails, payload.workDoneBy, payload.remark])) {
      App.toast("Enter at least date, category, related equipment, details, work done by, or remark before saving.", "error");
      return;
    }

    App.storage.upsert("modificationHistory", payload, "modificationhistory");
    state.editingIds.modification = "";
    App.toast("Modification record saved locally.");
    App.renderCurrentRoute();
  }

  App.registerModule("historyregister", {
    title: "History Register",
    subtitle: "Offline equipment, installation, replacement, and modification history for practical substation office use.",

    render: function () {
      const state = getModuleState();
      return [
        '<section class="module-shell">',
        '  <div class="card">',
        '    <div class="card-header">',
        "      <div>",
        "        <h3>History Register</h3>",
        "        <p>Store transformer, VCB, change register, and general modification history in separate clean sections. Most fields are optional and blank values are allowed.</p>",
        "      </div>",
        '      <div class="tag">Offline Local Storage</div>',
        "    </div>",
        '    <div class="history-tab-row">' + buildTabButtons(state.activeTab) + "</div>",
        "  </div>",
        '  <div class="module-grid two-col">',
        '    <div id="history-form-panel">' + buildFormPanelHtml() + "</div>",
        '    <div id="history-list-panel">' + buildListPanelHtml() + "</div>",
        "  </div>",
        "</section>"
      ].join("");
    },

    afterRender: function (container) {
      const form = container.querySelector("#history-entry-form");

      if (form) {
        App.enableEnterAsTab(form, "input, select, textarea, button");
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          const formType = form.getAttribute("data-history-form");
          if (formType === "transformer") {
            handleTransformerSubmit(form);
            return;
          }
          if (formType === "vcb") {
            handleVcbSubmit(form);
            return;
          }
          if (formType === "change") {
            handleChangeSubmit(form);
            return;
          }
          handleModificationSubmit(form);
        });
      }

      container.addEventListener("click", function (event) {
        const state = getModuleState();
        const actionButton = event.target.closest("[data-history-action]");
        const tabButton = event.target.closest("[data-history-tab]");

        if (tabButton) {
          state.activeTab = tabButton.getAttribute("data-history-tab");
          App.renderCurrentRoute();
          return;
        }

        if (!actionButton) {
          return;
        }

        const action = actionButton.getAttribute("data-history-action");
        const activeTab = state.activeTab;
        if (action === "cancel-edit") {
          state.editingIds[activeTab] = "";
          App.renderCurrentRoute();
          return;
        }
        if (action === "clear-filters") {
          if (activeTab === "transformer") {
            state.filters.transformer = { search: "", substationId: "", status: "" };
          } else if (activeTab === "vcb") {
            state.filters.vcb = { search: "", substationId: "", feederName: "", status: "" };
          } else if (activeTab === "change") {
            state.filters.change = { search: "", substationId: "", feederName: "", equipmentType: "", startDate: "", endDate: "" };
          } else {
            state.filters.modification = { search: "", substationId: "", category: "", startDate: "", endDate: "" };
          }
          renderListPanel(container);
          return;
        }
        if (action === "print") {
          const records = collectFilteredRecords(activeTab, state.filters[activeTab]);
          App.openPrintWindow(getTabConfig(activeTab).printTitle, buildPrintHtml(activeTab, records, state.filters[activeTab]), { orientation: "landscape" });
          return;
        }
        if (action === "export") {
          const records = collectFilteredRecords(activeTab, state.filters[activeTab]);
          const filename = "history-register-" + activeTab + "-" + App.getTodayValue() + ".json";
          App.downloadTextFile(filename, JSON.stringify(buildExportPayload(activeTab, records, state.filters[activeTab]), null, 2), "application/json;charset=utf-8");
          App.toast("Filtered history data exported as JSON.");
          return;
        }
        if (action === "edit") {
          state.editingIds[activeTab] = actionButton.getAttribute("data-id");
          App.renderCurrentRoute();
          return;
        }
        if (action === "delete") {
          if (!global.confirm("Delete this history record from local storage?")) {
            return;
          }
          App.storage.remove(getTabConfig(activeTab).collection, actionButton.getAttribute("data-id"));
          if (state.editingIds[activeTab] === actionButton.getAttribute("data-id")) {
            state.editingIds[activeTab] = "";
          }
          App.toast("History record deleted.", "warning");
          App.renderCurrentRoute();
        }
      });

      container.addEventListener("change", function (event) {
        const filterField = event.target.getAttribute("data-history-filter");
        if (filterField) {
          updateFilterValue(container, filterField, event.target.value);
          return;
        }

        const mode = event.target.getAttribute("data-history-substation-select");
        if (mode === "vcb" || mode === "change") {
          syncFeederFormOptions(container, mode);
          return;
        }

        if (event.target.id === "history-vcb-feeder-id") {
          const feederNameInput = container.querySelector("#history-vcb-feeder-name");
          const option = event.target.options[event.target.selectedIndex];
          if (feederNameInput && option && option.value && !feederNameInput.value.trim()) {
            feederNameInput.value = option.text;
          }
          return;
        }

        if (event.target.id === "history-change-feeder-id") {
          const feederNameInput = container.querySelector("#history-change-feeder-name");
          const option = event.target.options[event.target.selectedIndex];
          if (feederNameInput && option && option.value && !feederNameInput.value.trim()) {
            feederNameInput.value = option.text;
          }
        }
      });

      container.addEventListener("input", function (event) {
        const filterField = event.target.getAttribute("data-history-filter");
        if (filterField === "search") {
          const state = getModuleState();
          state.filters[state.activeTab].search = event.target.value;
        }
      });
    }
  });
})(window);
