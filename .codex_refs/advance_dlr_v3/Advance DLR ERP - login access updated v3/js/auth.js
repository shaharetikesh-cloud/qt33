(function (global) {
  const App = global.SubstationRegisterApp = global.SubstationRegisterApp || {};

  const SESSION_STORAGE_KEY = "msedcl-substation-register-system-session";
  const DEFAULT_ADMIN_USERNAME = "admin";
  const DEFAULT_ADMIN_PASSWORD = "admin123";
  const ROLE_LABELS = {
    MAIN_ADMIN: "Main Admin",
    SUBSTATION_USER: "Substation User"
  };
  const SUBSTATION_ROUTE_ALLOWLIST = [
    "dashboard",
    "dailylog",
    "faults",
    "maintenance",
    "battery",
    "reports",
    "chargehandover",
    "account"
  ];

  const runtime = {
    readyPromise: null,
    currentUser: null,
    defaultAdminSeeded: false
  };

  function isCloudMode() {
    return Boolean(App.cloudSync && typeof App.cloudSync.isEnabled === "function" && App.cloudSync.isEnabled());
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeUsername(value) {
    return String(value || "").trim();
  }

  function normalizeUsernameKey(value) {
    return normalizeUsername(value).toLowerCase();
  }

  function normalizeRole(value) {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized === "SUBSTATION_USER" ? "SUBSTATION_USER" : "MAIN_ADMIN";
  }

  function roleLabel(role) {
    return ROLE_LABELS[normalizeRole(role)] || ROLE_LABELS.MAIN_ADMIN;
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  function fallbackHashHex(text) {
    const input = String(text || "");
    let hashA = 2166136261;
    let hashB = 16777619;

    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      hashA ^= code;
      hashA = Math.imul(hashA, 16777619);
      hashB ^= (code << (index % 8));
      hashB = Math.imul(hashB, 2246822519);
    }

    const first = (hashA >>> 0).toString(16).padStart(8, "0");
    const second = (hashB >>> 0).toString(16).padStart(8, "0");
    const third = ((hashA ^ hashB) >>> 0).toString(16).padStart(8, "0");
    const fourth = ((Math.imul(hashA, 31) ^ Math.imul(hashB, 17)) >>> 0).toString(16).padStart(8, "0");
    return first + second + third + fourth;
  }

  async function sha256Hex(text) {
    const cryptoApi = global.crypto || global.msCrypto;
    const subtle = cryptoApi && cryptoApi.subtle;

    if (!subtle || typeof subtle.digest !== "function" || typeof TextEncoder !== "function") {
      return fallbackHashHex(text);
    }

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(String(text || ""));
      const digest = await subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest)).map(function (value) {
        return value.toString(16).padStart(2, "0");
      }).join("");
    } catch (error) {
      return fallbackHashHex(text);
    }
  }

  async function hashPassword(password, salt) {
    return sha256Hex(String(salt || "") + "::" + String(password || ""));
  }

  function writeSession(user) {
    if (!user) {
      global.localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    global.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      userId: user.id,
      username: user.username,
      role: user.role,
      assignedSubstationId: user.assignedSubstationId || "",
      loggedInAt: nowIso()
    }));
  }

  function readSession() {
    const raw = global.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      global.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  }

  function dispatchSessionChange() {
    global.dispatchEvent(new CustomEvent("substation-register:session-changed", {
      detail: {
        user: runtime.currentUser ? {
          id: runtime.currentUser.id,
          username: runtime.currentUser.username,
          role: runtime.currentUser.role,
          assignedSubstationId: runtime.currentUser.assignedSubstationId || ""
        } : null
      }
    }));
  }

  async function ensureDefaultAdmin() {
    if (isCloudMode()) {
      runtime.defaultAdminSeeded = false;
      return;
    }
    const users = App.storage.getCollection("users");
    if (users.length) {
      runtime.defaultAdminSeeded = users.length === 1 &&
        normalizeUsernameKey(users[0].username) === DEFAULT_ADMIN_USERNAME &&
        users[0].mustChangePassword &&
        !users[0].lastLoginAt;
      return;
    }

    const salt = randomSalt();
    const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD, salt);
    App.storage.upsert("users", {
      username: DEFAULT_ADMIN_USERNAME,
      usernameKey: DEFAULT_ADMIN_USERNAME,
      passwordHash: passwordHash,
      passwordSalt: salt,
      role: "MAIN_ADMIN",
      assignedSubstationId: "",
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: ""
    }, "user");
    runtime.defaultAdminSeeded = true;
  }

  function findUserBySession(session) {
    if (!session || !session.userId) {
      return null;
    }

    const user = App.storage.getCollection("users").find(function (item) {
      return item.id === session.userId;
    }) || null;

    if (!user || user.isActive === false) {
      return null;
    }

    return user;
  }

  function setCurrentUser(user) {
    runtime.currentUser = user ? clone(user) : null;
    if (!isCloudMode()) {
      writeSession(runtime.currentUser);
    }
    dispatchSessionChange();
  }

  async function ensureReady() {
    if (runtime.readyPromise) {
      return runtime.readyPromise;
    }

    runtime.readyPromise = (async function () {
      if (isCloudMode()) {
        await App.cloudSync.ensureInitialized();
        runtime.currentUser = App.cloudSync.getCurrentUser();
        dispatchSessionChange();
        return;
      }
      await App.storage.ensureCollection("users");
      await ensureDefaultAdmin();
      const session = readSession();
      const user = findUserBySession(session);
      if (user) {
        runtime.currentUser = clone(user);
      } else {
        writeSession(null);
        runtime.currentUser = null;
      }
      dispatchSessionChange();
    })();

    return runtime.readyPromise;
  }

  function getCurrentUser() {
    return runtime.currentUser ? clone(runtime.currentUser) : null;
  }

  function isAuthenticated() {
    return Boolean(runtime.currentUser && runtime.currentUser.isActive !== false);
  }

  function isAdmin() {
    return Boolean(runtime.currentUser && runtime.currentUser.role === "MAIN_ADMIN");
  }

  function isSubstationUser() {
    return Boolean(runtime.currentUser && runtime.currentUser.role === "SUBSTATION_USER");
  }

  function getAssignedSubstationId() {
    return isSubstationUser() ? String(runtime.currentUser.assignedSubstationId || "").trim() : "";
  }

  function canAccessSubstation(substationId) {
    if (!substationId) {
      return isAdmin();
    }
    return isAdmin() || getAssignedSubstationId() === String(substationId || "").trim();
  }

  function canAccessRoute(route) {
    const targetRoute = String(route || "").trim();

    if (targetRoute === "login") {
      return true;
    }

    if (!isAuthenticated()) {
      return false;
    }

    if (isAdmin()) {
      return true;
    }

    return SUBSTATION_ROUTE_ALLOWLIST.indexOf(targetRoute) >= 0;
  }

  function getHomeRoute() {
    if (!isAuthenticated()) {
      return "login";
    }
    return "dashboard";
  }

  function getSuggestedOperatorName() {
    return runtime.currentUser ? String(runtime.currentUser.username || "").trim() : "";
  }

  function getDefaultAdminHint() {
    if (isCloudMode()) {
      return "Cloud mode active: sign in using your email and password from Supabase Auth. Admin login activity is written to login_audit.";
    }
    if (!runtime.defaultAdminSeeded) {
      return "";
    }
    return "First-run admin login: admin / admin123. Change the password immediately after login.";
  }

  async function login(username, password) {
    await ensureReady();

    if (isCloudMode()) {
      const user = await App.cloudSync.signIn(username, password);
      runtime.defaultAdminSeeded = false;
      setCurrentUser(user);
      return clone(user);
    }

    const usernameKey = normalizeUsernameKey(username);
    const user = App.storage.getCollection("users").find(function (item) {
      return item.usernameKey === usernameKey;
    }) || null;

    if (!user || user.isActive === false) {
      throw new Error("Invalid username or inactive account.");
    }

    const passwordHash = await hashPassword(password, user.passwordSalt);
    if (passwordHash !== user.passwordHash) {
      throw new Error("Invalid username or password.");
    }

    const updatedUser = App.storage.upsert("users", Object.assign({}, user, {
      lastLoginAt: nowIso()
    }), "user");

    runtime.defaultAdminSeeded = false;
    setCurrentUser(updatedUser);
    return clone(updatedUser);
  }

  function logout() {
    if (isCloudMode()) {
      return App.cloudSync.signOut().finally(function () {
        setCurrentUser(null);
      });
    }
    setCurrentUser(null);
  }

  async function saveUserAccount(payload) {
    await ensureReady();

    if (isCloudMode()) {
      throw new Error("Cloud mode user creation is managed in Supabase Auth and user_profiles. Use the SQL/bootstrap flow from DEPLOYMENT.md.");
    }

    if (!isAdmin()) {
      throw new Error("Only Main Admin can manage user accounts.");
    }

    const users = App.storage.getCollection("users");
    const userId = String(payload.id || "").trim();
    const existingUser = userId ? (users.find(function (item) {
      return item.id === userId;
    }) || null) : null;
    const username = normalizeUsername(payload.username);
    const usernameKey = normalizeUsernameKey(username);
    const role = normalizeRole(payload.role);
    const assignedSubstationId = role === "SUBSTATION_USER" ? String(payload.assignedSubstationId || "").trim() : "";
    const password = String(payload.password || "");

    if (!username) {
      throw new Error("Username is required.");
    }

    if (users.some(function (item) {
      return item.id !== userId && item.usernameKey === usernameKey;
    })) {
      throw new Error("Username already exists.");
    }

    if (role === "MAIN_ADMIN" && users.some(function (item) {
      return item.id !== userId && item.role === "MAIN_ADMIN";
    })) {
      throw new Error("Only one Main Admin account is supported.");
    }

    if (role === "SUBSTATION_USER" && !assignedSubstationId) {
      throw new Error("Assigned substation is required for a substation user.");
    }

    if (role === "SUBSTATION_USER" && users.some(function (item) {
      return item.id !== userId && item.role === "SUBSTATION_USER" && item.assignedSubstationId === assignedSubstationId;
    })) {
      throw new Error("A substation login already exists for the selected substation.");
    }

    if (!existingUser && !password) {
      throw new Error("Password is required for a new user.");
    }

    const nextUser = Object.assign({}, existingUser || {}, {
      id: existingUser ? existingUser.id : "",
      username: username,
      usernameKey: usernameKey,
      role: role,
      assignedSubstationId: assignedSubstationId,
      isActive: payload.isActive !== false,
      mustChangePassword: Boolean(payload.mustChangePassword),
      lastLoginAt: existingUser ? existingUser.lastLoginAt : ""
    });

    if (password) {
      const salt = randomSalt();
      nextUser.passwordSalt = salt;
      nextUser.passwordHash = await hashPassword(password, salt);
    }

    const savedUser = App.storage.upsert("users", nextUser, "user");

    if (runtime.currentUser && runtime.currentUser.id === savedUser.id) {
      setCurrentUser(savedUser);
    }

    return savedUser;
  }

  async function adminResetPassword(userId, nextPassword, forceChange) {
    await ensureReady();

    if (isCloudMode()) {
      throw new Error("Cloud mode password resets should be handled through Supabase Auth reset email.");
    }

    if (!isAdmin()) {
      throw new Error("Only Main Admin can reset passwords.");
    }

    const user = App.storage.findById("users", userId);
    if (!user) {
      throw new Error("Selected user account was not found.");
    }

    if (!String(nextPassword || "").trim()) {
      throw new Error("New password is required.");
    }

    const salt = randomSalt();
    const savedUser = App.storage.upsert("users", Object.assign({}, user, {
      passwordSalt: salt,
      passwordHash: await hashPassword(nextPassword, salt),
      mustChangePassword: forceChange !== false
    }), "user");

    if (runtime.currentUser && runtime.currentUser.id === savedUser.id) {
      setCurrentUser(savedUser);
    }

    return savedUser;
  }

  async function changeOwnPassword(currentPassword, newPassword) {
    await ensureReady();

    if (isCloudMode()) {
      throw new Error("Cloud mode password changes should be completed through the Supabase Auth account flow.");
    }

    if (!isAuthenticated()) {
      throw new Error("Login required.");
    }

    if (!String(newPassword || "").trim()) {
      throw new Error("New password is required.");
    }

    const user = App.storage.findById("users", runtime.currentUser.id);
    if (!user) {
      throw new Error("Current user account was not found.");
    }

    const currentHash = await hashPassword(currentPassword, user.passwordSalt);
    if (currentHash !== user.passwordHash) {
      throw new Error("Current password is incorrect.");
    }

    const salt = randomSalt();
    const savedUser = App.storage.upsert("users", Object.assign({}, user, {
      passwordSalt: salt,
      passwordHash: await hashPassword(newPassword, salt),
      mustChangePassword: false
    }), "user");

    setCurrentUser(savedUser);
    return savedUser;
  }

  function buildLoginFormHtml() {
    const hint = getDefaultAdminHint();

    return [
      '<section class="module-shell auth-screen">',
      '  <div class="card auth-card">',
      '    <div class="card-header">',
      "      <div>",
      "        <h3>MSEDCL Substation Register</h3>",
      "        <p>" + App.escapeHtml(isCloudMode() ? "Role-based cloud access. Sign in with your email account." : "Role-based access control. Use your Main Admin or assigned substation login.") + "</p>",
      "      </div>",
      "    </div>",
      '    <form id="login-form" class="stack">',
      '      <div class="form-grid">',
      '        <div class="field-group"><label for="login-username">' + App.escapeHtml(isCloudMode() ? 'Email' : 'Username') + '</label><input id="login-username" name="username" type="' + App.escapeHtml(isCloudMode() ? 'email' : 'text') + '" autocomplete="username" required></div>',
      '        <div class="field-group"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" required></div>',
      "      </div>",
      '      <div class="form-actions"><button type="submit" class="primary-button">Login</button><button type="button" class="secondary-button" id="login-forgot-button">Forgot Password</button></div>',
      '      <p class="small-status">' + App.escapeHtml(hint || "Forgot password: contact Main Admin for reset. No email or OTP flow is used in this offline version.") + "</p>",
      "    </form>",
      "  </div>",
      "</section>"
    ].join("");
  }

  function buildAccountHtml() {
    const user = getCurrentUser();
    if (!user) {
      return '<section class="module-shell"><div class="card"><div class="empty-state">Login required.</div></div></section>';
    }

    const assignedSubstation = user.assignedSubstationId ? App.findSubstation(user.assignedSubstationId) : null;

    return [
      '<section class="module-shell">',
      '  <div class="module-grid two-col">',
      '    <div class="card">',
      '      <div class="card-header">',
      "        <div>",
      "          <h3>My Account</h3>",
      "          <p>Change your own password and review current role access.</p>",
      "        </div>",
      "      </div>",
      '      <div class="stack">',
      '        <div class="record-item"><strong>Username</strong><span class="muted-text">' + App.escapeHtml(user.username) + "</span></div>",
      '        <div class="record-item"><strong>Role</strong><span class="muted-text">' + App.escapeHtml(roleLabel(user.role)) + "</span></div>",
      '        <div class="record-item"><strong>Assigned Substation</strong><span class="muted-text">' + App.escapeHtml(assignedSubstation ? assignedSubstation.name : (user.role === "MAIN_ADMIN" ? "All substations" : "-")) + "</span></div>",
      '        <div class="record-item"><strong>Last Login</strong><span class="muted-text">' + App.escapeHtml(user.lastLoginAt ? App.formatDateTime(user.lastLoginAt) : "First login") + "</span></div>",
      user.mustChangePassword ? '<div class="tag warning">Password change is required before regular use.</div>' : "",
      "      </div>",
      "    </div>",
      '    <div class="card">',
      '      <div class="card-header">',
      "        <div>",
      "          <h3>Change Password</h3>",
      "          <p>Keep your shared station login practical but protected. Contact Main Admin if you forget the current password.</p>",
      "        </div>",
      "      </div>",
      '      <form id="account-password-form" class="stack">',
      '        <div class="form-grid">',
      '          <div class="field-group"><label for="account-current-password">Current Password</label><input id="account-current-password" name="currentPassword" type="password" autocomplete="current-password" required></div>',
      '          <div class="field-group"><label for="account-new-password">New Password</label><input id="account-new-password" name="newPassword" type="password" autocomplete="new-password" required></div>',
      '          <div class="field-group"><label for="account-confirm-password">Confirm New Password</label><input id="account-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" required></div>',
      "        </div>",
      '        <div class="form-actions"><button type="submit" class="primary-button">Update Password</button></div>',
      '        <p class="small-status">' + App.escapeHtml(isCloudMode() ? 'Cloud mode: use the reset email flow from the login screen.' : 'Forgot Password: contact Main Admin. Offline mode does not use email or OTP recovery.') + '</p>',
      "      </form>",
      "    </div>",
      "  </div>",
      "</section>"
    ].join("");
  }


  App.auth = {
    roles: clone(ROLE_LABELS),
    initialize: ensureReady,
    ensureReady: ensureReady,
    getCurrentUser: getCurrentUser,
    isAuthenticated: isAuthenticated,
    isAdmin: isAdmin,
    isSubstationUser: isSubstationUser,
    getAssignedSubstationId: getAssignedSubstationId,
    canAccessSubstation: canAccessSubstation,
    canAccessRoute: canAccessRoute,
    getHomeRoute: getHomeRoute,
    getRoleLabel: roleLabel,
    getSuggestedOperatorName: getSuggestedOperatorName,
    getDefaultAdminHint: getDefaultAdminHint,
    login: login,
    logout: logout,
    saveUserAccount: saveUserAccount,
    adminResetPassword: adminResetPassword,
    changeOwnPassword: changeOwnPassword,
    hashPassword: hashPassword
  };

  App.registerModule("login", {
    title: "Login",
    subtitle: "Offline role-based access for Main Admin and assigned substation users.",
    requiredCollections: ["users"],

    render: function () {
      return buildLoginFormHtml();
    },

    afterRender: function (container) {
      const form = container.querySelector("#login-form");
      const forgotButton = container.querySelector("#login-forgot-button");

      if (form) {
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          const formData = new FormData(form);
          const username = String(formData.get("username") || "").trim();
          const password = String(formData.get("password") || "");

          App.auth.login(username, password).then(function (user) {
            App.toast("Login successful.");
            const nextRoute = user.mustChangePassword ? "account" : App.auth.getHomeRoute();
            App.navigate(nextRoute);
          }).catch(function (error) {
            App.toast(error && error.message ? error.message : "Login failed.", "error");
          });
        });
      }

      if (forgotButton) {
        forgotButton.addEventListener("click", function () {
          if (isCloudMode()) {
            const usernameField = container.querySelector("#login-username");
            const email = usernameField ? String(usernameField.value || "").trim() : "";
            if (!email) {
              App.toast("Enter your email first, then click Forgot Password.", "warning");
              return;
            }
            App.cloudSync.sendResetPassword(email).then(function () {
              App.toast("Password reset email sent.");
            }).catch(function (error) {
              App.toast(error && error.message ? error.message : "Unable to send reset email.", "error");
            });
            return;
          }
          App.toast("Forgot password: contact Main Admin for password reset.", "warning");
        });
      }
    }
  });

  App.registerModule("account", {
    title: "My Account",
    subtitle: "Password management for the currently logged-in user.",
    requiredCollections: ["users", "substations"],

    render: function () {
      return buildAccountHtml();
    },

    afterRender: function (container) {
      const form = container.querySelector("#account-password-form");
      if (!form) {
        return;
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        const formData = new FormData(form);
        const currentPassword = String(formData.get("currentPassword") || "");
        const newPassword = String(formData.get("newPassword") || "");
        const confirmPassword = String(formData.get("confirmPassword") || "");

        if (!currentPassword || !newPassword || !confirmPassword) {
          App.toast("All password fields are required.", "error");
          return;
        }

        if (newPassword !== confirmPassword) {
          App.toast("New password and confirmation do not match.", "error");
          return;
        }

        App.auth.changeOwnPassword(currentPassword, newPassword).then(function () {
          App.toast("Password updated successfully.");
          App.navigate(App.auth.getHomeRoute());
        }).catch(function (error) {
          App.toast(error && error.message ? error.message : "Unable to change password.", "error");
        });
      });
    }
  });
})(window);
