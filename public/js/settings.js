/**
 * Settings Module - RBAC & User Management
 * Handles user/role CRUD operations, tab navigation, and Firebase integration
 */

import { database } from './firebase.js';
import { ref, onValue, set, update, remove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { fetchWithAuth, getAuthContext } from './authz.js';

// DOM Elements
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const addUserBtn = document.getElementById('add-user-btn');
const addRoleBtn = document.getElementById('add-role-btn');
const userForm = document.getElementById('user-form');
const roleForm = document.getElementById('role-form');
const usersTableBody = document.getElementById('users-table-body');
const rolesList = document.getElementById('roles-list');
const usersToast = document.getElementById('users-toast');
const rolesToast = document.getElementById('roles-toast');
const thresholdsForm = document.getElementById('thresholds-form');
const thresholdsToast = document.getElementById('thresholds-toast');
const temperatureMinInput = document.getElementById('temperature-min');
const temperatureMaxInput = document.getElementById('temperature-max');
const turbidityMaxInput = document.getElementById('turbidity-max');
const tdsMinInput = document.getElementById('tds-min');
const tdsMaxInput = document.getElementById('tds-max');

// Modal elements
const userModalOverlay = document.getElementById('user-modal-overlay');
const userModalClose = document.getElementById('user-modal-close');
const userModalCancel = document.getElementById('user-modal-cancel');
const userModalTitle = document.getElementById('user-modal-title');
const userModalError = document.getElementById('user-modal-error');
const userEmailInput = document.getElementById('user-email');
const userNameInput = document.getElementById('user-name');
const userPasswordInput = document.getElementById('user-password');
const userPasswordHelp = document.getElementById('password-help');
const userRoleSelect = document.getElementById('user-role');
const userStatusSelect = document.getElementById('user-status');

const roleModalOverlay = document.getElementById('role-modal-overlay');
const roleModalClose = document.getElementById('role-modal-close');
const roleModalCancel = document.getElementById('role-modal-cancel');
const roleModalTitle = document.getElementById('role-modal-title');
const roleModalError = document.getElementById('role-modal-error');
const roleNameInput = document.getElementById('role-name');
const permissionCheckboxes = document.querySelectorAll('input[name="permissions"]');

// State
let currentUser = null;
let editingUserId = null;
let editingRoleId = null;
let allUsers = {};
let allRoles = {};
let currentPermissions = new Set();
let currentRoleId = null;
const ALL_PERMISSION_KEYS = [
  'view_sensors',
  'toggle_detection',
  'edit_thresholds',
  'manage_settings',
  'manage_users',
  'manage_roles',
  'view_reports',
  'send_alerts',
];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await setupAuthorization();
  setupTabNavigation();
  setupModalHandlers();
  setupFormHandlers();
  initializeFirebaseListeners();
  getCurrentUser();
});

/**
 * Tab Navigation
 */
function setupTabNavigation() {
  tabButtons.forEach((btn) => {
    if (btn.classList.contains('hidden-permission-tab')) return;
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });
}

function switchTab(tabId) {
  // Update buttons
  tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Update contents
  tabContents.forEach((content) => {
    content.classList.toggle('active', content.getAttribute('data-tab') === tabId);
  });

  if (tabId === 'edit-thresholds' && currentRoleId === 'admin') {
    loadThresholds();
  }
}

async function setupAuthorization() {
  try {
    const context = await getAuthContext();
    currentPermissions = new Set(context?.permissions || []);
    currentRoleId = context?.roleId || null;
  } catch (error) {
    console.error('Failed to load auth context:', error);
    currentPermissions = new Set();
    currentRoleId = null;
  }

  const canManageUsers = currentPermissions.has('manage_users');
  const canManageRoles = currentPermissions.has('manage_roles');
  const canEditThresholds = currentRoleId === 'admin';

  const userTabButton = document.querySelector('.tab-btn[data-tab="user-management"]');
  const roleTabButton = document.querySelector('.tab-btn[data-tab="role-permissions"]');
  const thresholdsTabButton = document.querySelector('.tab-btn[data-tab="edit-thresholds"]');
  const userTabContent = document.querySelector('.tab-content[data-tab="user-management"]');
  const roleTabContent = document.querySelector('.tab-content[data-tab="role-permissions"]');
  const thresholdsTabContent = document.querySelector('.tab-content[data-tab="edit-thresholds"]');

  if (addUserBtn) addUserBtn.style.display = canManageUsers ? '' : 'none';
  if (addRoleBtn) addRoleBtn.style.display = canManageRoles ? '' : 'none';

  if (!canManageUsers) {
    userTabButton?.style.setProperty('display', 'none');
    userTabButton?.classList.add('hidden-permission-tab');
    userTabContent?.classList.remove('active');
  }
  if (!canManageRoles) {
    roleTabButton?.style.setProperty('display', 'none');
    roleTabButton?.classList.add('hidden-permission-tab');
    roleTabContent?.classList.remove('active');
  }
  if (!canEditThresholds) {
    thresholdsTabButton?.style.setProperty('display', 'none');
    thresholdsTabButton?.classList.add('hidden-permission-tab');
    thresholdsTabContent?.classList.remove('active');
  }

  if (canManageUsers) {
    switchTab('user-management');
  } else if (canManageRoles) {
    switchTab('role-permissions');
  } else if (canEditThresholds) {
    switchTab('edit-thresholds');
  } else if (userTabContent) {
    userTabContent.classList.add('active');
    userTabContent.innerHTML = '<div style="padding: 2rem; text-align: center; color: #ef4444;">You do not have permission to manage users or roles.</div>';
  }
}

/**
 * Modal Handlers
 */
function setupModalHandlers() {
  // User Modal
  addUserBtn?.addEventListener('click', () => openUserModal(null));
  userModalClose.addEventListener('click', closeUserModal);
  userModalCancel.addEventListener('click', closeUserModal);
  userModalOverlay.addEventListener('click', (e) => {
    if (e.target === userModalOverlay) closeUserModal();
  });

  // Role Modal
  addRoleBtn?.addEventListener('click', () => openRoleModal(null));
  roleModalClose.addEventListener('click', closeRoleModal);
  roleModalCancel.addEventListener('click', closeRoleModal);
  roleModalOverlay.addEventListener('click', (e) => {
    if (e.target === roleModalOverlay) closeRoleModal();
  });

  // Keyboard: Escape to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeUserModal();
      closeRoleModal();
    }
  });
}

function openUserModal(userId) {
  if (!currentPermissions.has('manage_users')) return;
  editingUserId = userId;
  clearUserForm();
  userModalError.classList.remove('show');

  if (userId) {
    userModalTitle.textContent = 'Edit User';
    const user = allUsers[userId];
    if (user) {
      userEmailInput.value = user.email || '';
      userEmailInput.disabled = true;
      userNameInput.value = user.name || '';
      userRoleSelect.value = user.roleId || user.role || '';
      userStatusSelect.value = user.status || 'active';
      userPasswordInput.style.display = 'none';
      userPasswordHelp.style.display = 'inline';
    }
  } else {
    userModalTitle.textContent = 'Add User';
    userEmailInput.disabled = false;
    userPasswordInput.style.display = 'block';
    userPasswordHelp.style.display = 'none';
  }

  userModalOverlay.classList.add('active');
}

function closeUserModal() {
  userModalOverlay.classList.remove('active');
  clearUserForm();
  editingUserId = null;
}

function clearUserForm() {
  userForm.reset();
  userEmailInput.disabled = false;
  userPasswordInput.style.display = 'block';
  userPasswordHelp.style.display = 'none';
  userModalError.classList.remove('show');
}

function openRoleModal(roleId) {
  if (!currentPermissions.has('manage_roles')) return;
  editingRoleId = roleId;
  clearRoleForm();
  roleModalError.classList.remove('show');

  if (roleId) {
    roleModalTitle.textContent = 'Edit Role';
    const role = allRoles[roleId];
    if (role) {
      roleNameInput.value = role.name || '';
      roleNameInput.disabled = true;
      const permissions = role.permissions || [];
      permissionCheckboxes.forEach((checkbox) => {
        checkbox.checked = permissions.includes(checkbox.value);
      });
    }
  } else {
    roleModalTitle.textContent = 'Add Role';
    roleNameInput.disabled = false;
  }

  roleModalOverlay.classList.add('active');
}

function closeRoleModal() {
  roleModalOverlay.classList.remove('active');
  clearRoleForm();
  editingRoleId = null;
}

function clearRoleForm() {
  roleForm.reset();
  roleNameInput.disabled = false;
  permissionCheckboxes.forEach((checkbox) => {
    checkbox.checked = false;
  });
  roleModalError.classList.remove('show');
}

/**
 * Form Handlers
 */
function setupFormHandlers() {
  userForm.addEventListener('submit', handleUserFormSubmit);
  roleForm.addEventListener('submit', handleRoleFormSubmit);
  thresholdsForm?.addEventListener('submit', handleThresholdsSubmit);
}

async function handleUserFormSubmit(e) {
  e.preventDefault();
  userModalError.classList.remove('show');

  const email = userEmailInput.value.trim();
  const name = userNameInput.value.trim();
  const password = userPasswordInput.value.trim();
  const roleId = userRoleSelect.value;
  const status = userStatusSelect.value;

  if (!email || !name || !roleId || !status) {
    showUserError('All fields are required');
    return;
  }

  if (!editingUserId && !password) {
    showUserError('Password is required for new users');
    return;
  }

  try {
    if (editingUserId) {
      // Update existing user
      const selectedRole = allRoles[roleId];
      await updateUserInDatabase(editingUserId, { name, roleId, role: selectedRole?.name || roleId, status });
      showToast(usersToast, 'User updated successfully', 'success');
    } else {
      // Create new user via backend API
      const payload = { email, password, name, roleId, status };
      console.log('Sending user creation payload:', payload);

      const response = await fetchWithAuth('/api/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      console.log('Response status:', response.status);
      const responseData = await response.json();
      console.log('Response data:', responseData);

      if (!response.ok) {
        throw new Error(responseData.message || `Server error: ${response.status}`);
      }

      showToast(usersToast, 'User created successfully', 'success');
    }

    closeUserModal();
  } catch (error) {
    console.error('User form error:', error);
    showUserError(error.message || 'An error occurred');
  }
}

async function handleRoleFormSubmit(e) {
  if (!currentPermissions.has('manage_roles')) {
    showRoleError('You do not have permission to manage roles');
    return;
  }
  e.preventDefault();
  roleModalError.classList.remove('show');

  const roleName = roleNameInput.value.trim();
  const permissions = Array.from(permissionCheckboxes)
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);

  if (!roleName) {
    showRoleError('Role name is required');
    return;
  }

  if (permissions.length === 0) {
    showRoleError('At least one permission must be selected');
    return;
  }

  try {
    if (editingRoleId) {
      // Update existing role
      await updateRoleInDatabase(editingRoleId, { name: roleName, permissions });
      showToast(rolesToast, 'Role updated successfully', 'success');
    } else {
      // Create new role
      const roleId = generateId();
      await saveRoleToDatabase(roleId, { name: roleName, permissions, createdAt: new Date().toISOString() });
      showToast(rolesToast, 'Role created successfully', 'success');
    }

    closeRoleModal();
  } catch (error) {
    console.error('Role form error:', error);
    showRoleError(error.message || 'An error occurred');
  }
}

function getThresholdPayloadFromForm() {
  const payload = {
    temperature: {
      min: Number(temperatureMinInput?.value),
      max: Number(temperatureMaxInput?.value),
    },
    turbidity: {
      max: Number(turbidityMaxInput?.value),
    },
    tds: {
      min: Number(tdsMinInput?.value),
      max: Number(tdsMaxInput?.value),
    },
  };

  if (
    [payload.temperature.min, payload.temperature.max, payload.turbidity.max, payload.tds.min, payload.tds.max]
      .some((value) => Number.isNaN(value))
    || payload.temperature.min >= payload.temperature.max
    || payload.tds.min >= payload.tds.max
    || payload.turbidity.max < 0
  ) {
    throw new Error('Please enter valid threshold ranges.');
  }

  return payload;
}

async function loadThresholds() {
  if (currentRoleId !== 'admin') return;
  if (!thresholdsForm) return;

  try {
    const response = await fetchWithAuth('/api/settings/thresholds');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || 'Failed to load thresholds');
    }

    const thresholds = data?.thresholds || {};
    if (temperatureMinInput) temperatureMinInput.value = thresholds.temperature?.min ?? 20;
    if (temperatureMaxInput) temperatureMaxInput.value = thresholds.temperature?.max ?? 32;
    if (turbidityMaxInput) turbidityMaxInput.value = thresholds.turbidity?.max ?? 100;
    if (tdsMinInput) tdsMinInput.value = thresholds.tds?.min ?? 0;
    if (tdsMaxInput) tdsMaxInput.value = thresholds.tds?.max ?? 1000;
  } catch (error) {
    showToast(thresholdsToast, error.message || 'Unable to load thresholds', 'error');
  }
}

async function handleThresholdsSubmit(e) {
  e.preventDefault();

  if (currentRoleId !== 'admin') {
    showToast(thresholdsToast, 'Only admins can edit thresholds.', 'error');
    return;
  }

  try {
    const payload = getThresholdPayloadFromForm();
    const response = await fetchWithAuth('/api/settings/thresholds', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || 'Failed to save thresholds');
    }

    showToast(thresholdsToast, 'Thresholds updated successfully', 'success');
  } catch (error) {
    showToast(thresholdsToast, error.message || 'Failed to save thresholds', 'error');
  }
}

/**
 * Firebase Database Operations
 */
async function getCurrentUser() {
  const auth = getAuth();
  const user = auth.currentUser;
  if (user) {
    currentUser = user;
    console.log('Current user:', user.email);
  }
}

function initializeFirebaseListeners() {
  if (!database) {
    console.error('Database not initialized');
    return;
  }

  if (currentPermissions.has('manage_users')) {
    const usersRef = ref(database, '/users');
    onValue(
      usersRef,
      (snapshot) => {
        const data = snapshot.val() || {};
        allUsers = data;
        renderUsersTable();
      },
      (error) => {
        console.error('Error loading users:', error);
        usersTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem; color: #ef4444;">Error loading users: ${error.message}</td></tr>`;
      }
    );
  }

  if (currentPermissions.has('manage_roles') || currentPermissions.has('manage_users')) {
    const rolesRef = ref(database, '/roles');
    onValue(
      rolesRef,
      (snapshot) => {
        const data = snapshot.val() || {};
        allRoles = data;
        renderRolesCards();
        populateUserRoleSelect();
      },
      (error) => {
        console.error('Error loading roles:', error);
        rolesList.innerHTML = `<div style="text-align: center; grid-column: 1 / -1; padding: 2rem; color: #ef4444;">Error loading roles: ${error.message}</div>`;
      }
    );
  }
}

function populateUserRoleSelect() {
  if (!userRoleSelect) return;

  const selected = userRoleSelect.value;
  userRoleSelect.innerHTML = '<option value="">-- Select Role --</option>';
  Object.entries(allRoles).forEach(([roleId, role]) => {
    const option = document.createElement('option');
    option.value = roleId;
    option.textContent = role?.name || roleId;
    userRoleSelect.appendChild(option);
  });

  if (selected && allRoles[selected]) {
    userRoleSelect.value = selected;
  }
}

function renderUsersTable() {
  if (!currentPermissions.has('manage_users')) {
    usersTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">You do not have permission to manage users.</td></tr>';
    return;
  }

  if (!allUsers || Object.keys(allUsers).length === 0) {
    usersTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">No users yet. Click "Add User" to create one.</td></tr>';
    return;
  }

  usersTableBody.innerHTML = Object.entries(allUsers)
    .map(([userId, user]) => {
      const statusBadgeClass = user.status === 'active' ? 'optimal' : 'critical';
      const statusText = user.status === 'active' ? 'Active' : 'Inactive';

      return `
        <tr>
          <td>${user.email || 'N/A'}</td>
          <td>${user.role || 'N/A'}</td>
          <td style="text-align: center;">
            <span class="status-badge ${statusBadgeClass}" style="position: static; display: inline-block;">${statusText}</span>
          </td>
          <td style="text-align: center;">
            <button class="report-btn view-btn" style="margin: 0 auto;" onclick="window.openEditUserModal('${userId}')">Edit</button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderRolesCards() {
  if (!currentPermissions.has('manage_roles')) {
    rolesList.innerHTML = '<div style="text-align: center; grid-column: 1 / -1; padding: 2rem;">You do not have permission to manage roles.</div>';
    return;
  }

  if (!allRoles || Object.keys(allRoles).length === 0) {
    rolesList.innerHTML = '<div style="text-align: center; grid-column: 1 / -1; padding: 2rem;">No roles yet. Click "Add Role" to create one.</div>';
    return;
  }

  rolesList.innerHTML = Object.entries(allRoles)
    .map(([roleId, role]) => {
      const permissions = role.permissions || [];
      const permissionsHtml = ALL_PERMISSION_KEYS
        .map((perm) => {
          const isActive = permissions.includes(perm);
          const label = perm.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
          return `<div class="permission-item ${isActive ? 'active' : ''}">${label}</div>`;
        })
        .join('');

      return `
        <div class="role-card">
          <div class="role-card-header">
            <div class="role-card-name">${role.name}</div>
            <div class="role-card-actions">
              <button class="report-btn view-btn" onclick="window.openEditRoleModal('${roleId}')">Edit</button>
              <button class="report-btn" onclick="window.deleteRoleModal('${roleId}')" style="background: #dc2626; border-color: #991b1b;">Delete</button>
            </div>
          </div>
          <div class="permissions-grid">${permissionsHtml}</div>
        </div>
      `;
    })
    .join('');
}

async function updateUserInDatabase(userId, updates) {
  if (!currentPermissions.has('manage_users')) {
    throw new Error('You do not have permission to manage users');
  }
  const userRef = ref(database, `/users/${userId}`);
  await update(userRef, updates);
}

async function saveRoleToDatabase(roleId, roleData) {
  if (!currentPermissions.has('manage_roles')) {
    throw new Error('You do not have permission to manage roles');
  }
  const roleRef = ref(database, `/roles/${roleId}`);
  await set(roleRef, roleData);
}

async function updateRoleInDatabase(roleId, updates) {
  if (!currentPermissions.has('manage_roles')) {
    throw new Error('You do not have permission to manage roles');
  }
  const roleRef = ref(database, `/roles/${roleId}`);
  await update(roleRef, updates);
}

async function deleteRoleFromDatabase(roleId) {
  if (!currentPermissions.has('manage_roles')) {
    throw new Error('You do not have permission to manage roles');
  }
  const roleRef = ref(database, `/roles/${roleId}`);
  await remove(roleRef);
}

/**
 * Utility Functions
 */
function generateId() {
  return 'role_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function showUserError(message) {
  userModalError.textContent = message;
  userModalError.classList.add('show');
}

function showRoleError(message) {
  roleModalError.textContent = message;
  roleModalError.classList.add('show');
}

function showToast(toastElement, message, type = 'info') {
  toastElement.textContent = message;
  toastElement.className = `toast show ${type}`;

  setTimeout(() => {
    toastElement.classList.remove('show');
  }, 4000);
}

/**
 * Global functions for onclick handlers
 */
window.openEditUserModal = (userId) => openUserModal(userId);
window.openEditRoleModal = (roleId) => openRoleModal(roleId);
window.deleteRoleModal = (roleId) => {
  if (confirm('Are you sure you want to delete this role?')) {
    deleteRoleFromDatabase(roleId).then(() => {
      showToast(rolesToast, 'Role deleted successfully', 'success');
    });
  }
};

console.log('Settings module initialized');
