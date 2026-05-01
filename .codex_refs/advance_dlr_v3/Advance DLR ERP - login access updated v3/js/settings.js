(function (global) {
  const App = global.SubstationRegisterApp;

  function getThemeButton(theme, currentTheme) {
    return '<button type="button" data-theme-value="' + theme + '" class="' + (theme === currentTheme ? "active" : "") + '">' + App.escapeHtml(theme === "light" ? "Light Theme" : "Dark Theme") + "</button>";
  }

  App.registerModule("settings", {
    title: "Settings",
    subtitle: "Theme, backup, restore, app information, and Supabase cloud sync placeholders.",

    render: function () {
      const settings = App.storage.getSettings();

      return [
        '<section class="module-shell">',
        '  <div class="settings-grid">',
        '    <div class="card">',
        '      <div class="card-header">',
        "        <div>",
        "          <h3>Application Settings</h3>",
        "          <p>Store app information locally and keep the interface ready for future upgrades.</p>",
        "        </div>",
        "      </div>",
        '      <form id="settings-form" class="stack">',
        '        <input type="hidden" id="theme-value" name="theme" value="' + App.escapeHtml(settings.theme || "light") + '">',
        '        <div class="field-group"><label>Theme</label><div class="theme-switch" id="theme-switch">' + getThemeButton("light", settings.theme) + getThemeButton("dark", settings.theme) + "</div></div>",
        '        <div class="field-group"><label for="settings-app-name">App Name</label><input id="settings-app-name" name="appName" type="text" value="' + App.escapeHtml(settings.appName || "") + '"></div>',
        '        <div class="field-group"><label for="settings-company-name">Company Name</label><input id="settings-company-name" name="companyName" type="text" value="' + App.escapeHtml(settings.companyName || "") + '"></div>',
        '        <div class="field-group"><label for="settings-office-note">Office Note</label><textarea id="settings-office-note" name="officeNote">' + App.escapeHtml(settings.officeNote || "") + "</textarea></div>",
        '        <div class="field-group"><label for="settings-provider">Cloud Sync Provider</label><input id="settings-provider" name="provider" type="text" value="' + App.escapeHtml(settings.futureSync.provider || "") + '"></div>',
        '        <div class="field-group"><label for="settings-project-id">Cloud Project ID</label><input id="settings-project-id" name="projectId" type="text" value="' + App.escapeHtml(settings.futureSync.projectId || "") + '"></div>',
        '        <div class="field-group"><label for="settings-sync-notes">Cloud Sync Notes</label><textarea id="settings-sync-notes" name="notes">' + App.escapeHtml(settings.futureSync.notes || "") + "</textarea></div>",
        '        <div class="form-actions"><button type="submit" class="primary-button">Save Settings</button></div>',
        "      </form>",
        "    </div>",

        '    <div class="card">',
        '      <div class="card-header">',
        "        <div>",
        "          <h3>Backup and Restore</h3>",
        "          <p>Download all local data to JSON and restore it on the same or another PC later.</p>",
        "        </div>",
        "      </div>",
        '      <div class="stack">',
        '        <div class="record-item"><strong>Backup All Data</strong><span class="muted-text">Downloads substations, daily logs, faults, maintenance logs, battery records, and settings as one JSON file.</span></div>',
        '        <div class="button-row"><button type="button" class="primary-button" id="backup-data-button">Download JSON Backup</button></div>',
        '        <div class="record-item"><strong>Restore From JSON</strong><span class="muted-text">Choose a backup file created from this application to restore all local records.</span></div>',
        '        <div class="button-row"><input type="file" id="restore-data-file" accept=".json,application/json"><button type="button" class="secondary-button" id="restore-data-button">Restore Backup</button></div>',
        '        <div class="record-item"><strong>Clear All Data</strong><span class="muted-text">This removes all locally stored records from this browser only. Use carefully after taking backup.</span></div>',
        '        <div class="button-row"><button type="button" class="danger-button" id="clear-data-button">Clear All Local Data</button></div>',
        "      </div>",
        "    </div>",

        '    <div class="card">',
        '      <div class="card-header">',
        "        <div>",
        "          <h3>About This Offline Version</h3>",
        "          <p>This phase is designed for local browser use with clean structure and future backend migration in mind.</p>",
        "        </div>",
        "      </div>",
        '      <div class="stack">',
        '        <div class="record-item"><strong>Current Storage</strong><span class="muted-text">Operational data uses IndexedDB with a shared storage abstraction layer, while lightweight preferences remain local.</span></div>',
        '        <div class="record-item"><strong>Included Modules</strong><span class="muted-text">Dashboard, substations, daily log, fault register, maintenance log, weekly battery record, reports, and settings.</span></div>',
        '        <div class="record-item"><strong>Future Upgrade Path</strong><span class="muted-text">This build supports IndexedDB offline cache with optional Supabase cloud sync for web deployment.</span></div>',
        '        <div class="record-item"><strong>Offline Scope</strong><span class="muted-text">This phase does not include attendance or shift attendance modules.</span></div>',
        "      </div>",
        "    </div>",
        "  </div>",
        "</section>"
      ].join("");
    },

    afterRender: function (container) {
      const form = container.querySelector("#settings-form");
      const themeInput = container.querySelector("#theme-value");
      const themeSwitch = container.querySelector("#theme-switch");
      const backupButton = container.querySelector("#backup-data-button");
      const restoreButton = container.querySelector("#restore-data-button");
      const restoreFileInput = container.querySelector("#restore-data-file");
      const clearDataButton = container.querySelector("#clear-data-button");

      themeSwitch.addEventListener("click", function (event) {
        const button = event.target.closest("[data-theme-value]");
        if (!button) {
          return;
        }
        const value = button.getAttribute("data-theme-value");
        themeInput.value = value;
        App.setTheme(value);
        themeSwitch.querySelectorAll("[data-theme-value]").forEach(function (item) {
          item.classList.toggle("active", item === button);
        });
      });

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        const formData = new FormData(form);
        const nextSettings = {
          theme: String(formData.get("theme") || "light"),
          appName: String(formData.get("appName") || "").trim() || App.defaultSettings.appName,
          companyName: String(formData.get("companyName") || "").trim() || App.defaultSettings.companyName,
          officeNote: String(formData.get("officeNote") || "").trim() || App.defaultSettings.officeNote,
          futureSync: {
            enabled: false,
            provider: String(formData.get("provider") || "").trim() || App.defaultSettings.futureSync.provider,
            projectId: String(formData.get("projectId") || "").trim(),
            notes: String(formData.get("notes") || "").trim()
          }
        };

        App.storage.updateSettings(nextSettings);
        App.setTheme(nextSettings.theme);
        document.title = nextSettings.appName;
        App.toast("Settings saved locally.");
        App.renderCurrentRoute();
      });

      backupButton.addEventListener("click", async function () {
        try {
          const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
          const payload = await App.storage.exportDataAsync();
          App.downloadTextFile("msedcl-substation-backup-" + timestamp + ".json", payload, "application/json;charset=utf-8");
          App.toast("JSON backup downloaded.");
        } catch (error) {
          console.error(error);
          App.toast("Unable to create the JSON backup.", "error");
        }
      });

      restoreButton.addEventListener("click", function () {
        const file = restoreFileInput.files[0];
        if (!file) {
          App.toast("Choose a JSON backup file first.", "error");
          return;
        }

        const reader = new FileReader();
        reader.onload = async function () {
          try {
            await App.storage.importDataAsync(reader.result);
            const restoredSettings = App.storage.getSettings();
            App.setTheme(restoredSettings.theme || "light");
            document.title = restoredSettings.appName || App.defaultSettings.appName;
            App.toast("Backup restored successfully.");
            App.navigate("dashboard");
          } catch (error) {
            console.error(error);
            App.toast("Unable to restore the selected backup file.", "error");
          }
        };
        reader.readAsText(file);
      });

      clearDataButton.addEventListener("click", async function () {
        const confirmationText = global.prompt('Type CLEAR to remove all local data from this browser.');
        if (confirmationText !== "CLEAR") {
          App.toast("Clear all data cancelled.", "warning");
          return;
        }

        try {
          await App.storage.clearAllAsync();
          App.setTheme(App.defaultSettings.theme);
          document.title = App.defaultSettings.appName;
          App.toast("All local data cleared.", "warning");
          App.navigate("dashboard");
        } catch (error) {
          console.error(error);
          App.toast("Unable to clear local data.", "error");
        }
      });
    }
  });
})(window);
