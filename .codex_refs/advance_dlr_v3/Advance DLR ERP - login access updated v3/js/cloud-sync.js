(function (global) {
  const App = global.SubstationRegisterApp = global.SubstationRegisterApp || {};
  const STORAGE_KEY = "msedcl-substation-register-system-cloud-sync";
  const config = global.SubstationRegisterCloudConfig || {};
  const runtime = {
    initialized: false,
    enabled: Boolean(config && config.enabled && global.supabase && typeof global.supabase.createClient === "function" && config.supabaseUrl && config.supabaseAnonKey),
    client: null,
    profile: null,
    session: null,
    status: "disabled"
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getClient() {
    if (!runtime.enabled) {
      return null;
    }
    if (!runtime.client) {
      runtime.client = global.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
    return runtime.client;
  }

  function setStatus(status) {
    runtime.status = status;
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: status, updatedAt: nowIso() }));
    } catch (error) {
      console.warn("Unable to persist cloud sync status.", error);
    }
  }

  async function ensureInitialized() {
    if (runtime.initialized) {
      return runtime;
    }
    runtime.initialized = true;

    if (!runtime.enabled) {
      setStatus("disabled");
      return runtime;
    }

    const client = getClient();
    const response = await client.auth.getSession();
    runtime.session = response && response.data ? response.data.session : null;
    if (runtime.session && runtime.session.user) {
      await refreshProfile();
      setStatus("ready");
    } else {
      setStatus("signed_out");
    }
    return runtime;
  }

  async function refreshProfile() {
    const client = getClient();
    if (!client) {
      return null;
    }
    const authResponse = await client.auth.getUser();
    const authUser = authResponse && authResponse.data ? authResponse.data.user : null;
    if (!authUser) {
      runtime.profile = null;
      return null;
    }

    const profileResponse = await client
      .from("user_profiles")
      .select("id,auth_user_id,email,full_name,role,assigned_substation_id,is_active")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (profileResponse.error) {
      throw profileResponse.error;
    }

    runtime.profile = profileResponse.data ? {
      id: profileResponse.data.id || authUser.id,
      authUserId: authUser.id,
      username: profileResponse.data.full_name || authUser.email || "",
      email: profileResponse.data.email || authUser.email || "",
      role: String(profileResponse.data.role || "SUBSTATION_USER").toUpperCase() === "MAIN_ADMIN" ? "MAIN_ADMIN" : "SUBSTATION_USER",
      assignedSubstationId: profileResponse.data.assigned_substation_id || "",
      isActive: profileResponse.data.is_active !== false,
      lastLoginAt: nowIso()
    } : {
      id: authUser.id,
      authUserId: authUser.id,
      username: authUser.email || "",
      email: authUser.email || "",
      role: "SUBSTATION_USER",
      assignedSubstationId: "",
      isActive: true,
      lastLoginAt: nowIso()
    };

    return clone(runtime.profile);
  }

  function getCurrentUser() {
    return runtime.profile ? clone(runtime.profile) : null;
  }

  async function signIn(email, password) {
    const client = getClient();
    if (!client) {
      throw new Error("Cloud sign-in is not configured.");
    }

    const result = await client.auth.signInWithPassword({ email: String(email || "").trim(), password: String(password || "") });
    if (result.error) {
      throw result.error;
    }

    runtime.session = result.data ? result.data.session : null;
    await refreshProfile();
    await writeLoginAudit("login_success", { email: String(email || "").trim() });
    setStatus("ready");
    return getCurrentUser();
  }

  async function signOut() {
    const client = getClient();
    if (!client) {
      runtime.profile = null;
      runtime.session = null;
      return;
    }
    const current = getCurrentUser();
    await writeLoginAudit("logout", { email: current && current.email ? current.email : "" }).catch(function () {});
    const result = await client.auth.signOut();
    if (result && result.error) {
      throw result.error;
    }
    runtime.profile = null;
    runtime.session = null;
    setStatus("signed_out");
  }

  async function sendResetPassword(email) {
    const client = getClient();
    if (!client) {
      throw new Error("Cloud reset is not configured.");
    }
    const result = await client.auth.resetPasswordForEmail(String(email || "").trim(), {
      redirectTo: (config.siteUrl || global.location.origin) + "/"
    });
    if (result.error) {
      throw result.error;
    }
    await writeLoginAudit("password_reset_requested", { email: String(email || "").trim() });
    return true;
  }

  async function loadBootstrapData() {
    const client = getClient();
    if (!client) {
      return null;
    }
    await ensureInitialized();
    if (!runtime.profile) {
      return null;
    }

    const response = await client
      .from("app_records")
      .select("collection_name,record_id,payload,deleted_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: true });

    if (response.error) {
      throw response.error;
    }

    const collections = {
      substations: [], users: [], dailyLogs: [], meterChangeEvents: [], faultAutoSuppressions: [], faults: [], maintenanceLogs: [], batteryRecords: [], transformerHistory: [], vcbHistory: [], equipmentChangeHistory: [], modificationHistory: [], chargeHandoverRecords: [], settings: []
    };

    (response.data || []).forEach(function (row) {
      const key = String(row.collection_name || "").trim();
      if (!collections[key]) {
        collections[key] = [];
      }
      if (row.payload) {
        collections[key].push(row.payload);
      }
    });

    return collections;
  }

  async function syncRecord(collectionName, record, operation) {
    const client = getClient();
    if (!client || !runtime.profile) {
      return false;
    }

    const payload = {
      collection_name: String(collectionName || "").trim(),
      record_id: String(record && record.id || "").trim(),
      substation_id: record && record.substationId ? String(record.substationId).trim() : null,
      payload: record || {},
      updated_by_auth_user_id: runtime.profile.authUserId || null,
      updated_by_email: runtime.profile.email || null,
      deleted_at: operation === "delete" ? nowIso() : null,
      updated_at: nowIso()
    };

    const result = await client.from("app_records").upsert(payload, { onConflict: "collection_name,record_id" });
    if (result.error) {
      throw result.error;
    }
    return true;
  }

  async function syncCollectionReplace(collectionName, records) {
    const client = getClient();
    if (!client || !runtime.profile) {
      return false;
    }
    const rows = (records || []).map(function (record) {
      return {
        collection_name: String(collectionName || "").trim(),
        record_id: String(record && record.id || "").trim(),
        substation_id: record && record.substationId ? String(record.substationId).trim() : null,
        payload: record || {},
        updated_by_auth_user_id: runtime.profile.authUserId || null,
        updated_by_email: runtime.profile.email || null,
        deleted_at: null,
        updated_at: nowIso()
      };
    });
    if (!rows.length) {
      return true;
    }
    const result = await client.from("app_records").upsert(rows, { onConflict: "collection_name,record_id" });
    if (result.error) {
      throw result.error;
    }
    return true;
  }

  async function writeLoginAudit(action, metadata) {
    const client = getClient();
    if (!client) {
      return false;
    }
    const currentUser = runtime.profile;
    const result = await client.from("login_audit").insert({
      action: String(action || "event").trim(),
      auth_user_id: currentUser && currentUser.authUserId ? currentUser.authUserId : null,
      email: metadata && metadata.email ? metadata.email : (currentUser && currentUser.email ? currentUser.email : null),
      metadata: metadata || {},
      app_instance_id: config.appInstanceId || "default"
    });
    if (result.error) {
      throw result.error;
    }
    return true;
  }

  App.cloudSync = {
    isEnabled: function () { return Boolean(runtime.enabled); },
    getStatus: function () { return runtime.status; },
    ensureInitialized: ensureInitialized,
    getCurrentUser: getCurrentUser,
    signIn: signIn,
    signOut: signOut,
    sendResetPassword: sendResetPassword,
    refreshProfile: refreshProfile,
    loadBootstrapData: loadBootstrapData,
    syncRecord: syncRecord,
    syncCollectionReplace: syncCollectionReplace,
    writeLoginAudit: writeLoginAudit,
    config: clone(config)
  };
})(window);
