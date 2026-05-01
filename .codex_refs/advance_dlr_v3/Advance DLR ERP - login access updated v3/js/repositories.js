(function (global) {
  const App = global.SubstationRegisterApp = global.SubstationRegisterApp || {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildBasicRepository(collectionName, prefix) {
    return {
      collectionName: collectionName,

      ensureLoaded: function () {
        return App.storage.ensureCollection(collectionName);
      },

      list: function () {
        return App.storage.getCollection(collectionName);
      },

      listAsync: function () {
        return App.storage.getCollectionAsync(collectionName);
      },

      findById: function (recordId) {
        return App.storage.findById(collectionName, recordId);
      },

      save: function (record) {
        return App.storage.upsert(collectionName, record, prefix || collectionName);
      },

      remove: function (recordId) {
        return App.storage.remove(collectionName, recordId);
      }
    };
  }

  App.repositories = {
    substations: Object.assign(buildBasicRepository("substations", "substation"), {
      listSorted: function () {
        return this.list().sort(function (left, right) {
          return String(left.name || "").localeCompare(String(right.name || ""));
        });
      },
      getFeedersBySubstation: function (substationId) {
        const substation = this.findById(substationId);
        return substation ? clone(substation.feeders || []) : [];
      }
    }),
    dailyLogs: buildBasicRepository("dailyLogs", "dailylog"),
    faults: buildBasicRepository("faults", "fault"),
    maintenance: buildBasicRepository("maintenanceLogs", "maintenance"),
    battery: buildBasicRepository("batteryRecords", "battery"),
    history: {
      transformer: buildBasicRepository("transformerHistory", "transformerhistory"),
      vcb: buildBasicRepository("vcbHistory", "vcbhistory"),
      equipmentChange: buildBasicRepository("equipmentChangeHistory", "equipmentchange"),
      modification: buildBasicRepository("modificationHistory", "modificationhistory")
    },
    chargeHandover: buildBasicRepository("chargeHandoverRecords", "chargehandover"),
    settings: {
      get: function () {
        return App.storage.getSettings();
      },
      update: function (partialSettings) {
        return App.storage.updateSettings(partialSettings);
      }
    },
    backups: {
      exportFullBackup: function (metadata) {
        return App.storage.exportBackupPackageAsync(metadata);
      },
      importFullBackup: function (payload) {
        return App.storage.importBackupPackageAsync(payload);
      },
      getModuleRecords: function (collectionName) {
        return App.storage.getCollectionAsync(collectionName);
      }
    }
  };
})(window);
