(function (global) {
  const App = global.SubstationRegisterApp;

  function getModuleState() {
    return App.getModuleState("users", {
      editingId: null,
      passwordResetUserId: null,
      showPasswordResetForm: false
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getEditingRecord() {
    const state = getModuleState();
    return state.editingId ? App.storage.findById("users", state.editingId) : null;
  }

  function buildUserListHtml() {
    const users = App.storage.getCollection("users");
    const substations = App.getSubstations();
    const substationById = substations.reduce(function (acc, item) {
      acc[item.id] = item;
      return acc;
    }, {});

    if (!users.length) {
      return [
        '<section class="module-shell">',
        '  <div class="card">',
        '    <div class="empty-state">',
        '      <p>No user accounts found. Click the button below to create the first account.</p>',
        '    </div>',
        '  </div>',
        '</section>'
      ].join("");
    }

    const rows = users.map(function (user) {
      const role = App.auth.getRoleLabel(user.role);
      const substationName = user.assignedSubstationId && substationById[user.assignedSubstationId]
        ? substationById[user.assignedSubstationId].name
        : (user.role === "MAIN_ADMIN" ? "All Substations" : "Unassigned");
      const status = user.isActive ? "Active" : "Inactive";
      const statusClass = user.isActive ? "success" : "muted-text";
      const lastLogin = user.lastLoginAt ? App.formatDateTime(user.lastLoginAt) : "Never";
      const mustChangeClass = user.mustChangePassword ? " warning" : "";

      return [
        '<tr data-user-id="' + App.escapeHtml(user.id) + '">',
        '  <td>' + App.escapeHtml(user.username) + '</td>',
        '  <td>' + App.escapeHtml(role) + '</td>',
        '  <td>' + App.escapeHtml(substationName) + '</td>',
        '  <td><span class="' + statusClass + '">' + status + '</span>' + (user.mustChangePassword ? ' <span class="tag warning">Password change required</span>' : '') + '</td>',
        '  <td class="muted-text">' + lastLogin + '</td>',
        '  <td>',
        '    <button type="button" class="action-button edit-button" title="Edit user">Edit</button>',
        '    <button type="button" class="action-button reset-button" title="Reset password">Reset Password</button>',
        '  </td>',
        '</tr>'
      ].join("");
    }).join("");

    return [
      '<section class="module-shell">',
      '  <div class="card">',
      '    <div class="card-header">',
      '      <div>',
      '        <h3>User Accounts</h3>',
      '        <p>Manage Main Admin and Substation user accounts.</p>',
      '      </div>',
      '      <button type="button" class="primary-button" id="add-user-button">+ Add User</button>',
      '    </div>',
      '    <table class="data-table">',
      '      <thead>',
      '        <tr>',
      '          <th>Username</th>',
      '          <th>Role</th>',
      '          <th>Assigned Substation</th>',
      '          <th>Status</th>',
      '          <th>Last Login</th>',
      '          <th>Actions</th>',
      '        </tr>',
      '      </thead>',
      '      <tbody>',
      rows,
      '      </tbody>',
      '    </table>',
      '  </div>',
      '</section>'
    ].join("");
  }

  function buildUserFormHtml(user) {
    const substations = App.getSubstations();
    const isNew = !user || !user.id;
    const isAdmin = App.auth.isAdmin();

    if (!isAdmin) {
      return '<section class="module-shell"><div class="card"><div class="empty-state">You do not have permission to manage users.</div></div></section>';
    }

    const roleOptions = [
      '<option value="MAIN_ADMIN"' + (user && user.role === "MAIN_ADMIN" ? " selected" : "") + '>Main Admin</option>',
      '<option value="SUBSTATION_USER"' + (user && user.role === "SUBSTATION_USER" ? " selected" : "") + '>Substation User</option>'
    ].join("");

    const substationOptions = '<option value="">Select a substation</option>' + substations.map(function (sub) {
      const selected = user && user.assignedSubstationId === sub.id ? " selected" : "";
      return '<option value="' + App.escapeHtml(sub.id) + '"' + selected + '>' + App.escapeHtml(sub.name) + '</option>';
    }).join("");

    return [
      '<section class="module-shell">',
      '  <div class="card">',
      '    <div class="card-header">',
      '      <div>',
      '        <h3>' + (isNew ? 'Create New User' : 'Edit User') + '</h3>',
      '        <p>Set up user account with role and assigned substation.</p>',
      '      </div>',
      '    </div>',
      '    <form id="user-form" class="stack">',
      '      <div class="form-grid">',
      '        <div class="field-group">',
      '          <label for="user-username">Username</label>',
      '          <input id="user-username" name="username" type="text" value="' + App.escapeHtml(user && user.username || "") + '" required>',
      '        </div>',
      '        <div class="field-group">',
      '          <label for="user-role">Role</label>',
      '          <select id="user-role" name="role" required>' + roleOptions + '</select>',
      '        </div>',
      '        <div class="field-group" id="user-substation-group" style="display: ' + (user && user.role === "SUBSTATION_USER" ? "block" : "none") + ';">',
      '          <label for="user-substation">Assigned Substation</label>',
      '          <select id="user-substation" name="assignedSubstationId">' + substationOptions + '</select>',
      '        </div>',
      '        <div class="field-group">',
      '          <label for="user-active"><input id="user-active" name="isActive" type="checkbox"' + (user && user.isActive !== false ? " checked" : "") + '> Active Account</label>',
      '        </div>',
      '        ' + (isNew ? '<div class="field-group"><label for="user-password">Initial Password</label><input id="user-password" name="password" type="password" required></div>' : ''),
      '        ' + (isNew ? '<div class="field-group"><label for="user-confirm-password">Confirm Password</label><input id="user-confirm-password" name="confirmPassword" type="password" required></div>' : ''),
      '        ' + (!isNew ? '<div class="field-group"><label for="user-must-change-password"><input id="user-must-change-password" name="mustChangePassword" type="checkbox"> Require password change on next login</label></div>' : ''),
      '      </div>',
      '      <div class="form-actions">',
      '        <button type="submit" class="primary-button">Save User</button>',
      '        <button type="button" class="secondary-button" id="cancel-edit-button">Cancel</button>',
      '      </div>',
      '    </form>',
      '  </div>',
      '</section>'
    ].join("");
  }

  function buildPasswordResetFormHtml(user) {
    if (!user) {
      return '';
    }

    return [
      '<div class="card">',
      '  <div class="card-header">',
      '    <div>',
      '      <h3>Reset Password for ' + App.escapeHtml(user.username) + '</h3>',
      '      <p>Set a new password for this user account.</p>',
      '    </div>',
      '  </div>',
      '  <form id="password-reset-form" class="stack">',
      '    <div class="form-grid">',
      '      <div class="field-group">',
      '        <label for="reset-new-password">New Password</label>',
      '        <input id="reset-new-password" name="newPassword" type="password" required>',
      '      </div>',
      '      <div class="field-group">',
      '        <label for="reset-confirm-password">Confirm Password</label>',
      '        <input id="reset-confirm-password" name="confirmPassword" type="password" required>',
      '      </div>',
      '      <div class="field-group">',
      '        <label for="reset-force-change"><input id="reset-force-change" name="forceChange" type="checkbox" checked> Require password change on next login</label>',
      '      </div>',
      '    </div>',
      '    <div class="form-actions">',
      '      <button type="submit" class="primary-button">Reset Password</button>',
      '      <button type="button" class="secondary-button" id="cancel-reset-button">Cancel</button>',
      '    </div>',
      '  </form>',
      '</div>'
    ].join("");
  }

  App.registerModule("users", {
    title: "User Management",
    subtitle: "Create and manage user accounts with role-based access control.",
    requiredCollections: ["users", "substations"],

    render: function () {
      const state = getModuleState();
      const editing = getEditingRecord();

      if (state.showPasswordResetForm && state.passwordResetUserId) {
        const resetUser = App.storage.findById("users", state.passwordResetUserId);
        return [
          '<section class="module-shell">',
          buildPasswordResetFormHtml(resetUser),
          '</section>'
        ].join("");
      }

      if (state.editingId) {
        return buildUserFormHtml(editing);
      }

      return buildUserListHtml();
    },

    afterRender: function (container) {
      const state = getModuleState();

      // List view events
      const addButton = container.querySelector("#add-user-button");
      if (addButton) {
        addButton.addEventListener("click", function () {
          state.editingId = null;
          App.navigate("users", true);
        });
      }

      const editButtons = container.querySelectorAll(".edit-button");
      editButtons.forEach(function (button) {
        button.addEventListener("click", function () {
          const row = button.closest("[data-user-id]");
          const userId = row ? row.getAttribute("data-user-id") : null;
          if (userId) {
            state.editingId = userId;
            App.navigate("users", true);
          }
        });
      });

      const resetButtons = container.querySelectorAll(".reset-button");
      resetButtons.forEach(function (button) {
        button.addEventListener("click", function () {
          const row = button.closest("[data-user-id]");
          const userId = row ? row.getAttribute("data-user-id") : null;
          if (userId) {
            state.passwordResetUserId = userId;
            state.showPasswordResetForm = true;
            App.navigate("users", true);
          }
        });
      });

      // Form view events
      const userForm = container.querySelector("#user-form");
      if (userForm) {
        const roleSelect = userForm.querySelector("[name='role']");
        const substationGroup = container.querySelector("#user-substation-group");

        if (roleSelect && substationGroup) {
          roleSelect.addEventListener("change", function () {
            substationGroup.style.display = roleSelect.value === "SUBSTATION_USER" ? "block" : "none";
          });
        }

        const cancelButton = container.querySelector("#cancel-edit-button");
        if (cancelButton) {
          cancelButton.addEventListener("click", function (event) {
            event.preventDefault();
            state.editingId = null;
            App.navigate("users", true);
          });
        }

        userForm.addEventListener("submit", function (event) {
          event.preventDefault();
          const formData = new FormData(userForm);
          const username = String(formData.get("username") || "").trim();
          const role = String(formData.get("role") || "").trim();
          const assignedSubstationId = String(formData.get("assignedSubstationId") || "").trim();
          const isActive = Boolean(formData.get("isActive"));
          const password = String(formData.get("password") || "");
          const confirmPassword = String(formData.get("confirmPassword") || "");
          const mustChangePassword = Boolean(formData.get("mustChangePassword"));

          if (!username) {
            App.toast("Username is required.", "error");
            return;
          }

          if (password !== confirmPassword && password) {
            App.toast("Passwords do not match.", "error");
            return;
          }

          if (!state.editingId && !password) {
            App.toast("Password is required for new users.", "error");
            return;
          }

          if (role === "SUBSTATION_USER" && !assignedSubstationId) {
            App.toast("Assigned substation is required for substation users.", "error");
            return;
          }

          const payload = {
            id: state.editingId || "",
            username: username,
            role: role,
            assignedSubstationId: assignedSubstationId,
            isActive: isActive,
            mustChangePassword: mustChangePassword
          };

          if (password) {
            payload.password = password;
          }

          App.auth.saveUserAccount(payload).then(function () {
            App.toast(state.editingId ? "User updated successfully." : "User created successfully.");
            state.editingId = null;
            App.navigate("users", true);
          }).catch(function (error) {
            App.toast(error && error.message ? error.message : "Unable to save user.", "error");
          });
        });
      }

      // Password reset form events
      const passwordResetForm = container.querySelector("#password-reset-form");
      if (passwordResetForm) {
        const cancelResetButton = container.querySelector("#cancel-reset-button");
        if (cancelResetButton) {
          cancelResetButton.addEventListener("click", function (event) {
            event.preventDefault();
            state.showPasswordResetForm = false;
            state.passwordResetUserId = null;
            App.navigate("users", true);
          });
        }

        passwordResetForm.addEventListener("submit", function (event) {
          event.preventDefault();
          const formData = new FormData(passwordResetForm);
          const newPassword = String(formData.get("newPassword") || "");
          const confirmPassword = String(formData.get("confirmPassword") || "");
          const forceChange = Boolean(formData.get("forceChange"));

          if (!newPassword || !confirmPassword) {
            App.toast("Both password fields are required.", "error");
            return;
          }

          if (newPassword !== confirmPassword) {
            App.toast("Passwords do not match.", "error");
            return;
          }

          App.auth.adminResetPassword(state.passwordResetUserId, newPassword, forceChange).then(function () {
            App.toast("Password reset successfully.");
            state.showPasswordResetForm = false;
            state.passwordResetUserId = null;
            App.navigate("users", true);
          }).catch(function (error) {
            App.toast(error && error.message ? error.message : "Unable to reset password.", "error");
          });
        });
      }
    }
  });
})(window);
