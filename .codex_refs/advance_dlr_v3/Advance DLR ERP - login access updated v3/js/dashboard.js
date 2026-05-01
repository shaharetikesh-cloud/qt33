(function (global) {
  const App = global.SubstationRegisterApp;

  function buildRecentActivity() {
    return App.storage.getRecentActivity(8);
  }

  App.registerModule("dashboard", {
    title: "Dashboard",
    subtitle: "Quick view of substations, recent records, and direct links to daily work screens.",

    render: function () {
      const substations = App.getSubstations();
      const dailyLogCount = App.storage.getCollectionCount("dailyLogs");
      const faultCount = App.storage.getCollectionCount("faults");
      const maintenanceCount = App.storage.getCollectionCount("maintenanceLogs");
      const batteryCount = App.storage.getCollectionCount("batteryRecords");
      const latestUpdate = App.storage.getLastUpdated();
      const recentActivity = buildRecentActivity();

      return [
        '<section class="module-shell">',
        '  <div class="card">',
        '    <div class="card-header">',
        "      <div>",
        "        <h3>MSEDCL Substation Register System</h3>",
        "        <p>Daily operation, maintenance, and weekly battery records stored fully offline in the browser.</p>",
        "      </div>",
        '      <div class="tag">Last updated: ' + App.escapeHtml(App.formatDateTime(latestUpdate)) + "</div>",
        "    </div>",
        '    <div class="stats-grid">',
        '      <article class="stat-card"><h3>Total Substations</h3><p class="stat-value">' + substations.length + '</p><p class="stat-note">Master records configured locally</p></article>',
        '      <article class="stat-card"><h3>Daily Logs Saved</h3><p class="stat-value">' + dailyLogCount + '</p><p class="stat-note">Hourly DLR records available</p></article>',
        '      <article class="stat-card"><h3>Fault Entries</h3><p class="stat-value">' + faultCount + '</p><p class="stat-note">Fault register entries stored</p></article>',
        '      <article class="stat-card"><h3>Maintenance Notes</h3><p class="stat-value">' + maintenanceCount + '</p><p class="stat-note">Daily maintenance records</p></article>',
        '      <article class="stat-card"><h3>Battery Records</h3><p class="stat-value">' + batteryCount + '</p><p class="stat-note">Weekly battery maintenance pages</p></article>',
        "    </div>",
        "  </div>",

        '  <div class="module-grid two-col">',
        '    <div class="card">',
        '      <div class="card-header">',
        "        <div>",
        "          <h3>Quick Actions</h3>",
        "          <p>Open the most-used modules directly from the dashboard.</p>",
        "        </div>",
        "      </div>",
        '      <div class="shortcut-grid">',
        '        <button type="button" class="shortcut-button" data-route="dailylog"><strong>Daily Log / DLR</strong><span>Hourly feeder entries and totals</span></button>',
        '        <button type="button" class="shortcut-button" data-route="battery"><strong>Battery Maintenance</strong><span>Weekly battery record and print page</span></button>',
        '        <button type="button" class="shortcut-button" data-route="faults"><strong>Fault Register</strong><span>Fault details with duration tracking</span></button>',
        '        <button type="button" class="shortcut-button" data-route="maintenance"><strong>Maintenance Log</strong><span>Daily work details and remarks</span></button>',
        '        <button type="button" class="shortcut-button" data-route="reports"><strong>Reports</strong><span>Range filters and printable views</span></button>',
        '        <button type="button" class="shortcut-button" data-route="settings"><strong>Settings</strong><span>Theme, backup, restore, and app info</span></button>',
        "      </div>",
        "    </div>",

        '    <div class="card">',
        '      <div class="card-header">',
        "        <div>",
        "          <h3>Office Notes</h3>",
        "          <p>Recommended order for starting daily work.</p>",
        "        </div>",
        "      </div>",
        '      <div class="stack">',
        '        <div class="record-item"><strong>1. Configure substations first</strong><span class="muted-text">Add division, circle, CT ratio, MF, and feeder names before entering daily logs.</span></div>',
        '        <div class="record-item"><strong>2. Use Daily Log for hourly feeder entries</strong><span class="muted-text">The table changes automatically according to feeder configuration.</span></div>',
        '        <div class="record-item"><strong>3. Store weekly battery pages carefully</strong><span class="muted-text">Each weekly battery record is saved by substation and date for later printing.</span></div>',
        '        <div class="record-item"><strong>4. Keep JSON backup regularly</strong><span class="muted-text">Use Settings to download a complete local backup file.</span></div>',
        "      </div>",
        "    </div>",
        "  </div>",

        '  <div class="card">',
        '    <div class="card-header">',
        "      <div>",
        "        <h3>Recent Records</h3>",
        "        <p>Most recently saved items across the application.</p>",
        "      </div>",
        "    </div>",
        recentActivity.length ? (
          '    <div class="table-shell">' +
          '      <table class="compact-table">' +
          "        <thead><tr><th>Type</th><th>Date</th><th>Substation</th><th>Details</th><th>Updated</th></tr></thead>" +
          "        <tbody>" +
          recentActivity.map(function (item) {
            return "<tr>" +
              "<td>" + App.escapeHtml(item.type) + "</td>" +
              "<td>" + App.escapeHtml(App.formatDate(item.date)) + "</td>" +
              "<td>" + App.escapeHtml(item.substationName) + "</td>" +
              "<td>" + App.escapeHtml(item.details) + "</td>" +
              "<td>" + App.escapeHtml(App.formatDateTime(item.timestamp)) + "</td>" +
            "</tr>";
          }).join("") +
          "        </tbody>" +
          "      </table>" +
          "    </div>"
        ) : '<div class="empty-state">No records are stored yet. Add a substation first and start entering daily registers.</div>',
        "  </div>",
        "</section>"
      ].join("");
    }
  });
})(window);
