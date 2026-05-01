(function (global) {
  const App = global.SubstationRegisterApp = global.SubstationRegisterApp || {};

  App.modules = App.modules || {};
  App.state = App.state || {
    currentRoute: "dashboard",
    modules: {}
  };
  App.runtime = App.runtime || {
    renderToken: 0
  };

  App.dom = App.dom || {};

  const DEFAULT_ROUTE_COLLECTIONS = {
    dashboard: ["substations"],
    substations: ["substations", "dailyLogs", "meterChangeEvents", "faultAutoSuppressions", "faults", "maintenanceLogs", "batteryRecords", "transformerHistory", "vcbHistory", "equipmentChangeHistory", "modificationHistory", "chargeHandoverRecords"],
    historyregister: ["substations", "transformerHistory", "vcbHistory", "equipmentChangeHistory", "modificationHistory"],
    chargehandover: ["substations", "chargeHandoverRecords"],
    dailylog: ["substations", "dailyLogs", "meterChangeEvents", "faults"],
    faults: ["substations", "dailyLogs", "faultAutoSuppressions", "faults"],
    maintenance: ["substations", "maintenanceLogs"],
    battery: ["substations", "batteryRecords"],
    reports: ["substations", "dailyLogs", "meterChangeEvents", "faults", "maintenanceLogs", "batteryRecords"],
    datatools: ["substations"],
    settings: [],
    users: ["users"]
  };

  // AUDIT-FIX HIGH-11 / 3J: Null-guard for registerModule to surface load-order issues visibly.
  App.registerModule = function (route, definition) {
    if (!route || typeof route !== "string") {
      console.error("[App.registerModule] Called with invalid route:", route);
      return;
    }
    if (!definition || typeof definition.render !== "function") {
      console.warn("[App.registerModule] Module '" + route + "' is missing a render function and will not be usable.");
    }
    App.modules[route] = definition;
  };

  App.constants = Object.assign({}, App.constants || {}, {
    feederTypes: ["INCOMING_11KV", "OUTGOING_11KV", "INCOMING_33KV", "EXPRESS_33KV", "OTHER", "TOTAL"]
  });

  App.escapeHtml = function (value) {
    const text = value === null || value === undefined ? "" : String(value);
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  App.formatDate = function (value) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  };

  App.formatDateTime = function (value) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  };

  App.toNumber = function (value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback || 0);
  };

  App.formatNumber = function (value, digits) {
    if (value === "" || value === null || value === undefined || Number.isNaN(Number(value))) {
      return "";
    }

    return Number(value).toFixed(typeof digits === "number" ? digits : 2);
  };

  App.getTodayValue = function () {
    return new Date().toISOString().slice(0, 10);
  };

  App.getDayName = function (dateValue) {
    if (!dateValue) {
      return "";
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("en-IN", { weekday: "long" }).format(date);
  };

  App.parse24HourTime = function (value) {
    const text = String(value || "").trim().replace(/\s+/g, "");

    if (!text) {
      return null;
    }

    let hoursText = "";
    let minutesText = "";

    if (/^\d{3}$/.test(text)) {
      hoursText = text.slice(0, 1);
      minutesText = text.slice(1);
    } else if (/^\d{4}$/.test(text)) {
      hoursText = text.slice(0, 2);
      minutesText = text.slice(2);
    } else {
      const match = text.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) {
        return null;
      }
      hoursText = match[1];
      minutesText = match[2];
    }

    const hours = Number(hoursText);
    const minutes = Number(minutesText);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
      return null;
    }

    if (hours === 24 && minutes === 0) {
      return {
        normalized: "24:00",
        minutes: 24 * 60
      };
    }

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }

    return {
      normalized: String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0"),
      minutes: (hours * 60) + minutes
    };
  };

  App.format24HourTime = function (value) {
    const parsed = App.parse24HourTime(value);
    return parsed ? parsed.normalized : "";
  };

  App.normalizeTimeInput = function (value) {
    const text = String(value || "").trim().replace(/\s+/g, "");
    if (!text) {
      return "";
    }
    const formatted = App.format24HourTime(text);
    return formatted || text;
  };

  App.isValid24HourTime = function (value) {
    return Boolean(App.parse24HourTime(value));
  };

  App.timeToMinutesAllowing2400 = function (value) {
    const parsed = App.parse24HourTime(value);
    return parsed ? parsed.minutes : null;
  };

  App.calculateDurationMinutes = function (dateValue, startTime, endTime) {
    if (!dateValue || !startTime || !endTime) {
      return 0;
    }

    const startMinutes = App.timeToMinutesAllowing2400(startTime);
    const endMinutes = App.timeToMinutesAllowing2400(endTime);
    const baseDate = new Date(dateValue + "T00:00");

    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || Number.isNaN(baseDate.getTime())) {
      return 0;
    }

    let resolvedEndMinutes = endMinutes;
    if (resolvedEndMinutes < startMinutes) {
      resolvedEndMinutes += 24 * 60;
    }

    return Math.max(0, resolvedEndMinutes - startMinutes);
  };

  App.formatDuration = function (minutes) {
    const value = App.toNumber(minutes, 0);
    const hours = Math.floor(value / 60);
    const remainingMinutes = value % 60;
    return String(hours).padStart(2, "0") + " hr " + String(remainingMinutes).padStart(2, "0") + " min";
  };

  App.downloadTextFile = function (filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  App.getModuleState = function (route, initialState) {
    if (!App.state.modules[route]) {
      App.state.modules[route] = Object.assign({}, initialState || {});
    }

    return App.state.modules[route];
  };

  App.getSubstations = function () {
    if (App.repositories && App.repositories.substations) {
      return App.repositories.substations.listSorted();
    }
    return App.storage.getCollection("substations").sort(function (left, right) {
      return left.name.localeCompare(right.name);
    });
  };

  App.getFeederLabel = function (feeder) {
    if (!feeder) {
      return "";
    }
    return String(feeder.feederName || feeder.name || "").trim();
  };

  App.isTotalFeeder = function (feeder) {
    return Boolean(feeder && feeder.feederType === "TOTAL");
  };

  App.is11KvIncomingFeeder = function (feeder) {
    return Boolean(feeder && feeder.feederType === "INCOMING_11KV");
  };

  App.is11KvOutgoingFeeder = function (feeder) {
    return Boolean(feeder && feeder.feederType === "OUTGOING_11KV");
  };

  App.is33KvIncomingFeeder = function (feeder) {
    return Boolean(feeder && (feeder.feederType === "INCOMING_33KV" || feeder.is33kvFeeder));
  };

  App.is33KvExpressFeeder = function (feeder) {
    return Boolean(feeder && (feeder.feederType === "EXPRESS_33KV" || feeder.is33kvExpress));
  };

  App.is33KvFeeder = function (feeder) {
    return App.is33KvIncomingFeeder(feeder) || App.is33KvExpressFeeder(feeder);
  };

  App.isMainIncFeeder = function (feeder) {
    return Boolean(feeder && feeder.feederType === "INCOMING_11KV" && feeder.isMainInc);
  };

  App.sortFeeders = function (feeders) {
    return (Array.isArray(feeders) ? feeders.slice() : []).sort(function (left, right) {
      const leftOrder = App.toNumber(left && left.sortOrder, 0);
      const rightOrder = App.toNumber(right && right.sortOrder, 0);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (App.isTotalFeeder(left) && !App.isTotalFeeder(right)) {
        return 1;
      }
      if (!App.isTotalFeeder(left) && App.isTotalFeeder(right)) {
        return -1;
      }
      return App.getFeederLabel(left).localeCompare(App.getFeederLabel(right));
    });
  };

  App.getFeederMap = function (feeders) {
    return App.sortFeeders(feeders).reduce(function (accumulator, feeder) {
      accumulator[feeder.id] = feeder;
      return accumulator;
    }, {});
  };

  App.getMainIncParents = function (feeders, excludeFeederId) {
    return App.sortFeeders(feeders).filter(function (feeder) {
      return App.isMainIncFeeder(feeder) && feeder.id !== excludeFeederId;
    });
  };

  App.calculateConsumption = function (openingKwh, closingKwh, mfValue) {
    if (openingKwh === "" || openingKwh === null || openingKwh === undefined) {
      return "";
    }
    if (closingKwh === "" || closingKwh === null || closingKwh === undefined) {
      return "";
    }

    const opening = Number(openingKwh);
    const closing = Number(closingKwh);
    const mf = Number(mfValue);

    if (!Number.isFinite(opening) || !Number.isFinite(closing) || !Number.isFinite(mf)) {
      return "";
    }

    return Number(((closing - opening) * mf).toFixed(2));
  };

  App.findSubstation = function (substationId) {
    return App.getSubstations().find(function (item) {
      return item.id === substationId;
    }) || null;
  };

  App.buildSubstationOptions = function (selectedId, includeBlank) {
    const rows = App.getSubstations();
    const lockToAssigned = App.auth && App.auth.isSubstationUser && App.auth.isSubstationUser();
    const effectiveSelectedId = lockToAssigned && App.auth.getAssignedSubstationId ? App.auth.getAssignedSubstationId() : selectedId;
    let options = includeBlank && !lockToAssigned ? '<option value="">Select substation</option>' : "";

    options += rows.map(function (item) {
      const selected = item.id === effectiveSelectedId ? " selected" : "";
      return '<option value="' + App.escapeHtml(item.id) + '"' + selected + ">" + App.escapeHtml(item.name) + "</option>";
    }).join("");

    return options;
  };

  App.focusAndSelectField = function (element) {
    if (!element || typeof element.focus !== "function") {
      return;
    }

    element.focus();
    if (typeof element.select === "function" && !element.matches("button")) {
      try {
        element.select();
      } catch (error) {
      }
    }
  };

  App.commit24HourTimeInput = function (input, options) {
    if (!input) {
      return true;
    }

    const config = Object.assign({
      invalidMessage: "Use 24-hour HH:MM format such as 09:30 or 24:00."
    }, options || {});
    const rawValue = String(input.value || "").trim();

    if (!rawValue) {
      input.value = "";
      input.classList.remove("time-input-invalid");
      input.setCustomValidity("");
      return true;
    }

    const normalized = App.format24HourTime(rawValue);
    const valid = Boolean(normalized);

    input.value = valid ? normalized : App.normalizeTimeInput(rawValue);
    input.classList.toggle("time-input-invalid", !valid);
    input.setCustomValidity(valid ? "" : config.invalidMessage);
    return valid;
  };

  App.attach24HourTimeInput = function (input, options) {
    if (!input) {
      return;
    }

    const config = Object.assign({
      invalidMessage: "Use 24-hour HH:MM format such as 09:30 or 24:00.",
      selectOnFocus: true
    }, options || {});

    input.setAttribute("data-time-input", "24h");

    input.addEventListener("focus", function () {
      if (!config.selectOnFocus) {
        return;
      }
      global.setTimeout(function () {
        if (document.activeElement === input) {
          App.focusAndSelectField(input);
        }
      }, 0);
    });

    input.addEventListener("input", function () {
      const currentValue = String(input.value || "");
      let cleanedValue = currentValue.replace(/[^\d:]/g, "");

      if (cleanedValue.indexOf(":") !== -1) {
        const parts = cleanedValue.split(":");
        cleanedValue = parts.shift() + (parts.length ? ":" + parts.join("").replace(/:/g, "").slice(0, 2) : "");
      } else if (/^\d{4}$/.test(cleanedValue) && App.isValid24HourTime(cleanedValue)) {
        cleanedValue = App.format24HourTime(cleanedValue);
      } else if (cleanedValue.length > 4) {
        cleanedValue = cleanedValue.slice(0, 4);
      }

      if (cleanedValue !== currentValue) {
        input.value = cleanedValue;
      }

      const trimmedValue = String(input.value || "").trim();
      const isValidTime = App.isValid24HourTime(trimmedValue);
      const isDigitsOnly = /^\d{1,4}$/.test(trimmedValue);
      const isIncompleteDigits = /^\d{1,3}$/.test(trimmedValue);
      const shouldFlagInvalid = Boolean(trimmedValue) && !isValidTime && (!isDigitsOnly || !isIncompleteDigits);
      input.classList.toggle("time-input-invalid", shouldFlagInvalid);
      input.setCustomValidity(shouldFlagInvalid ? config.invalidMessage : "");
    });

    input.addEventListener("blur", function () {
      App.commit24HourTimeInput(input, config);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") {
        return;
      }
      if (!App.commit24HourTimeInput(input, config)) {
        event.preventDefault();
      }
    });
  };

  App.enableEnterAsTab = function (container, selector) {
    container.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.target.matches("textarea")) {
        return;
      }

      if (event.target.matches('[data-time-input="24h"]') && !App.commit24HourTimeInput(event.target)) {
        event.preventDefault();
        return;
      }

      const fields = Array.from(container.querySelectorAll(selector)).filter(function (element) {
        return !element.disabled && element.offsetParent !== null;
      });
      const currentIndex = fields.indexOf(event.target);
      if (currentIndex >= 0 && currentIndex < fields.length - 1) {
        event.preventDefault();
        App.focusAndSelectField(fields[currentIndex + 1]);
      }
    });
  };

  App.enableGridNavigation = function (container, selector, options) {
    if (!container) {
      return;
    }

    const config = Object.assign({
      rowSelector: "tbody tr",
      selectOnFocus: true
    }, options || {});
    const movementMap = {
      Enter: [1, 0],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1]
    };

    container.addEventListener("keydown", function (event) {
      const move = movementMap[event.key];
      const target = event.target.closest(selector);

      if (!move || !target || target.disabled || target.hasAttribute("readonly")) {
        return;
      }

      const grid = Array.from(container.querySelectorAll(config.rowSelector)).map(function (row) {
        return Array.from(row.querySelectorAll(selector)).filter(function (element) {
          return !element.disabled && !element.hasAttribute("readonly") && element.offsetParent !== null;
        });
      }).filter(function (row) {
        return row.length > 0;
      });

      let currentRowIndex = -1;
      let currentColumnIndex = -1;

      grid.some(function (cells, rowIndex) {
        const columnIndex = cells.indexOf(target);
        if (columnIndex === -1) {
          return false;
        }
        currentRowIndex = rowIndex;
        currentColumnIndex = columnIndex;
        return true;
      });

      if (currentRowIndex === -1 || currentColumnIndex === -1) {
        return;
      }

      const nextRowIndex = currentRowIndex + move[0];
      const nextColumnIndex = currentColumnIndex + move[1];

      if (nextRowIndex < 0 || nextRowIndex >= grid.length) {
        return;
      }

      if (nextColumnIndex < 0 || nextColumnIndex >= grid[nextRowIndex].length) {
        return;
      }

      const nextField = grid[nextRowIndex][nextColumnIndex];
      if (!nextField) {
        return;
      }

      if (target.matches('[data-time-input="24h"]') && !App.commit24HourTimeInput(target)) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      if (config.selectOnFocus) {
        App.focusAndSelectField(nextField);
        return;
      }
      nextField.focus();
    });
  };

  App.openPrintWindow = function (title, html, options) {
    const config = Object.assign({
      orientation: "portrait",
      pageSize: "A4",
      margin: "10mm",
      bodyClass: ""
    }, options || {});
    const styles = [
      '<link rel="stylesheet" href="css/style.css">',
      '<link rel="stylesheet" href="css/print.css">'
    ].join("");
    const popup = global.open("", "_blank", "width=1280,height=900");

    if (!popup) {
      App.toast("Pop-up blocked. Please allow pop-ups to print reports.", "error");
      return;
    }

    const printScript = "<scr" + "ipt>window.onload=function(){setTimeout(function(){window.print();},120);};</scr" + "ipt>";
    popup.document.open();
    popup.document.write(
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" +
      "<title>" + App.escapeHtml(title) + "</title>" +
      "<base href=\"" + App.escapeHtml(document.baseURI) + "\">" +
      styles +
      "<style>@page{size:" + App.escapeHtml(config.pageSize) + " " + App.escapeHtml(config.orientation) + ";margin:" + App.escapeHtml(config.margin) + ";}body{background:#fff;padding:0;margin:0;} .print-window{padding:0;}</style>" +
      "</head><body class=\"" + App.escapeHtml(config.bodyClass || "") + "\"><div class=\"print-window\">" + html + "</div>" + printScript + "</body></html>"
    );
    popup.document.close();
  };

  App.toast = function (message, type) {
    const region = App.dom.toastRegion;
    if (!region) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = "toast " + (type || "success");
    toast.textContent = message;
    region.appendChild(toast);

    global.setTimeout(function () {
      toast.remove();
    }, 3200);
  };

  App.setTheme = function (theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.body.setAttribute("data-theme", nextTheme);
  };

  App.refreshShellStatus = function () {
    const updatedAt = App.storage.getLastUpdated();
    if (App.dom.updatedStatus) {
      App.dom.updatedStatus.textContent = updatedAt ? App.formatDateTime(updatedAt) : "Not available";
    }
    if (App.dom.storageStatusValue) {
      const adapterInfo = App.storage.getAdapterInfo();
      App.dom.storageStatusValue.textContent = adapterInfo.cloudEnabled ? "Supabase Cloud + IndexedDB Cache" : "IndexedDB Offline Cache";
    }
  };

  App.setPageDetails = function (moduleDefinition) {
    if (!moduleDefinition) {
      return;
    }

    App.dom.pageTitle.textContent = moduleDefinition.title || "Dashboard";
    App.dom.pageSubtitle.textContent = moduleDefinition.subtitle || "Offline local register system";
  };

  App.renderCurrentRoute = async function () {
    try {
      const route = App.state.currentRoute;

      await App.auth.ensureReady();

      const user = App.auth.getCurrentUser();
      if (!user && route !== "login") {
        App.navigate("login", true);
        return;
      }

      if (user && user.mustChangePassword && route !== "account") {
        App.navigate("account", true);
        return;
      }

      if (!App.auth.canAccessRoute(route)) {
        App.navigate(App.auth.getHomeRoute(), true);
        return;
      }

      const moduleDefinition = App.modules[route] || App.modules.dashboard;
      const renderToken = ++App.runtime.renderToken;

      if (!moduleDefinition) {
        App.dom.content.innerHTML = '<div class="card"><p>Unable to load the selected module.</p></div>';
        return;
      }

      App.dom.content.innerHTML = '<div class="card"><p>Loading data...</p></div>';

      if (App.storage && typeof App.storage.initialize === "function") {
        await App.storage.initialize();
      }

      if (App.storage && typeof App.storage.ensureCollections === "function") {
        const requiredCollections = typeof moduleDefinition.getRequiredCollections === "function"
          ? moduleDefinition.getRequiredCollections(App)
          : (moduleDefinition.requiredCollections || DEFAULT_ROUTE_COLLECTIONS[route] || []);

        if (requiredCollections && requiredCollections.length) {
          await App.storage.ensureCollections(requiredCollections);
        }
      }

      if (renderToken !== App.runtime.renderToken) {
        return;
      }

      App.setPageDetails(moduleDefinition);
      App.dom.content.innerHTML = moduleDefinition.render(App);
      App.highlightActiveNav(route);

      if (typeof moduleDefinition.afterRender === "function") {
        moduleDefinition.afterRender(App.dom.content, App);
      }

      App.refreshShellStatus();
    } catch (error) {
      console.error(error);
      App.dom.content.innerHTML = '<div class="card"><p>Unable to load the selected module.</p></div>';
      App.toast("Unable to load data for this module.", "error");
    }
  };

  App.highlightActiveNav = function (route) {
    const buttons = document.querySelectorAll("[data-route]");
    buttons.forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-route") === route);
    });
  };

  // AUDIT-FIX MED-07 / 3I: Re-entrant navigate guard prevents infinite redirect loop.
  // Same-route guard prevents an already-active route from re-triggering a full render
  // while a redirect is mid-flight.
  App._navigating = false;

  App.navigate = function (route, skipHashUpdate) {
    // Re-entrant guard: if a navigate call is already in progress, queue this as a
    // one-step deferred navigation to break any recursion.
    if (App._navigating) {
      global.setTimeout(function () {
        App._navigating = false;
        App.navigate(route, skipHashUpdate);
      }, 0);
      return;
    }

    App._navigating = true;
    try {
      const requestedRoute = typeof route === "string" && route.trim() ? route.trim() : "dashboard";
      let nextRoute = App.modules[requestedRoute] ? requestedRoute : "dashboard";

      if (!App.modules[nextRoute] && App.modules.login) {
        nextRoute = "login";
      }

      if (!App.auth.canAccessRoute(nextRoute)) {
        const fallbackRoute = App.auth.getHomeRoute();
        // AUDIT-FIX MED-07: If fallback equals the blocked route, drop to login unconditionally
        // to prevent infinite redirect (e.g., default route is admin-only but user is restricted).
        const safeRoute = (fallbackRoute && fallbackRoute !== nextRoute) ? fallbackRoute : "login";
        App._navigating = false;
        App.navigate(safeRoute, skipHashUpdate);
        return;
      }

      App.state.currentRoute = nextRoute;
      if (!skipHashUpdate) {
        const currentHash = global.location.hash.replace("#", "");
        if (currentHash !== nextRoute) {
          global.location.hash = nextRoute;
          App._navigating = false;
          return;
        }
      }
      App._navigating = false;
      App.renderCurrentRoute();
    } catch (error) {
      App._navigating = false;
      console.error("[App.navigate] Unexpected error:", error);
      App.renderCurrentRoute();
    }
  };

  function bindGlobalEvents() {
    document.addEventListener("click", function (event) {
      const routeButton = event.target.closest("[data-route]");
      if (routeButton) {
        const targetRoute = routeButton.getAttribute("data-route");
        if (targetRoute) {
          App.navigate(targetRoute);
        }
      }
    });

    if (App.dom.mobileNavToggle) {
      App.dom.mobileNavToggle.addEventListener("click", function () {
        App.dom.sidebar.classList.toggle("open");
      });
    }

    const userMenuButton = document.getElementById("user-menu-button");
    if (userMenuButton) {
      userMenuButton.addEventListener("click", function () {
        const menu = document.getElementById("user-menu-dropdown");
        if (menu) {
          menu.style.display = menu.style.display === "block" ? "none" : "block";
        } else {
          const newMenu = document.createElement("div");
          newMenu.id = "user-menu-dropdown";
          newMenu.className = "dropdown-menu";
          newMenu.innerHTML = [
            '<button type="button" data-route="account" class="dropdown-item">My Account</button>',
            '<button type="button" id="logout-button" class="dropdown-item">Logout</button>'
          ].join("");
          userMenuButton.parentNode.insertBefore(newMenu, userMenuButton.nextSibling);

          newMenu.addEventListener("click", function (e) {
            const btn = e.target.closest("button");
            if (!btn) return;

            if (btn.id === "logout-button") {
              Promise.resolve(App.auth.logout()).finally(function () {
                App.navigate("login", true);
                newMenu.remove();
              });
            } else if (btn.hasAttribute("data-route")) {
              const route = btn.getAttribute("data-route");
              newMenu.remove();
              App.navigate(route);
            }
          });
        }
      });
    }

    global.addEventListener("hashchange", function () {
      const route = global.location.hash.replace("#", "") || "dashboard";
      App.navigate(route, true);
    });

    global.addEventListener("substation-register:data-changed", function () {
      App.refreshShellStatus();
    });

    global.addEventListener("substation-register:session-changed", function () {
      updateUserStatusDisplay();
      const isAuthenticated = App.auth.isAuthenticated();
      if (!isAuthenticated) {
        App.navigate("login", true);
      }
    });
  }

  function cacheDom() {
    App.dom.sidebar = document.getElementById("sidebar");
    App.dom.mobileNavToggle = document.getElementById("mobile-nav-toggle");
    App.dom.pageTitle = document.getElementById("page-title");
    App.dom.pageSubtitle = document.getElementById("page-subtitle");
    App.dom.updatedStatus = document.getElementById("updated-status");
    App.dom.content = document.getElementById("app-content");
    App.dom.toastRegion = document.getElementById("toast-region");
    App.dom.userStatusChip = document.getElementById("user-status-chip");
    App.dom.userMenuButton = document.getElementById("user-menu-button");
    App.dom.usersNavLink = document.getElementById("users-nav-link");
    App.dom.storageStatusValue = document.getElementById("storage-status-value");
  }

  function updateUserStatusDisplay() {
    const user = App.auth.getCurrentUser();

    if (!user) {
      if (App.dom.userStatusChip) App.dom.userStatusChip.style.display = "none";
      if (App.dom.userMenuButton) App.dom.userMenuButton.style.display = "none";
      if (App.dom.usersNavLink) App.dom.usersNavLink.style.display = "none";
      return;
    }

    if (App.dom.userStatusChip) {
      App.dom.userStatusChip.style.display = "flex";
      const statusLabel = document.getElementById("user-status-label");
      const statusValue = document.getElementById("user-status-value");
      if (statusLabel) statusLabel.textContent = "Logged in as";
      if (statusValue) statusValue.textContent = user.username;
    }

    if (App.dom.userMenuButton) {
      App.dom.userMenuButton.style.display = "inline-block";
      const menuLabel = document.getElementById("user-menu-label");
      if (menuLabel) menuLabel.textContent = user.username;
    }

    if (App.dom.usersNavLink) {
      App.dom.usersNavLink.style.display = App.auth.isAdmin() ? "block" : "none";
    }
  }

  function initializeTheme() {
    const settings = App.storage.getSettings();
    App.setTheme(settings.theme || "light");
    document.title = settings.appName || App.defaultSettings.appName;
  }

  App.init = function () {
    cacheDom();
    initializeTheme();
    bindGlobalEvents();
    App.refreshShellStatus();

    App.auth.ensureReady().then(function () {
      updateUserStatusDisplay();
      const routeFromHash = global.location.hash.replace("#", "") || App.auth.getHomeRoute();
      if (App.storage && typeof App.storage.initialize === "function") {
        return App.storage.initialize().then(function () {
          App.refreshShellStatus();
          App.navigate(routeFromHash, true);
        });
      }
      App.navigate(routeFromHash, true);
    }).catch(function (error) {
      console.error(error);
      App.toast("Initialization failed.", "error");
      App.navigate(App.auth.getHomeRoute(), true);
    });
  };

  // AUDIT-FIX 3K: Detect file:// protocol and show a visible startup banner.
  // Pop-ups (print windows), relative CSS links, and IndexedDB may behave unexpectedly
  // when the app is opened directly from the filesystem.
  function showFileProtocolBanner() {
    if (global.location && global.location.protocol === "file:") {
      global.addEventListener("DOMContentLoaded", function () {
        const banner = document.createElement("div");
        banner.id = "file-protocol-warning";
        banner.style.cssText = [
          "position:fixed;top:0;left:0;right:0;z-index:9999;",
          "background:#f59e0b;color:#1c1917;padding:8px 16px;",
          "font-size:13px;text-align:center;",
          "box-shadow:0 2px 6px rgba(0,0,0,0.2);"
        ].join("");
        banner.innerHTML = [
          "<strong>Offline file:// mode detected.</strong> ",
          "For full functionality (print, IndexedDB, pop-ups), ",
          "please open this app via a local HTTP server (e.g., ",
          "<code>npx serve .</code> or Live Server extension). ",
          '<button onclick="document.getElementById(\'file-protocol-warning\').remove()" ',
          'style="margin-left:12px;padding:2px 10px;cursor:pointer">Dismiss</button>'
        ].join("");
        document.body.insertBefore(banner, document.body.firstChild);
      });
    }
  }

  showFileProtocolBanner();

  document.addEventListener("DOMContentLoaded", App.init);
})(window);
