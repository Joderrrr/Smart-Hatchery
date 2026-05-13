import { getAuthContext, hasPermission } from './authz.js';

async function applyNavigationPermissions(settingsDropdown) {
  const items = Array.from(settingsDropdown.querySelectorAll('.settings-item[href]'));
  const reportsLink = items.find((item) => item.getAttribute('href') === '/reports');
  const settingsLink = items.find((item) => item.getAttribute('href') === '/settings');

  try {
    const context = await getAuthContext();
    const canViewReports = hasPermission(context, 'view_reports');
    const canOpenSettings = hasPermission(context, 'manage_settings')
      || hasPermission(context, 'manage_users')
      || hasPermission(context, 'manage_roles');

    if (reportsLink) reportsLink.style.display = canViewReports ? '' : 'none';
    if (settingsLink) settingsLink.style.display = canOpenSettings ? '' : 'none';
  } catch (error) {
    if (reportsLink) reportsLink.style.display = 'none';
    if (settingsLink) settingsLink.style.display = 'none';
  }
}

function setupSettingsDropdown() {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsDropdown = document.getElementById('settings-dropdown');
  const logoutBtn = document.getElementById('settings-logout');

  if (!settingsBtn || !settingsDropdown) return;
  applyNavigationPermissions(settingsDropdown);

  const closeDropdown = () => {
    settingsDropdown.classList.remove('active');
    settingsBtn.setAttribute('aria-expanded', 'false');
  };

  settingsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = settingsDropdown.classList.toggle('active');
    settingsBtn.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (event) => {
    if (!settingsDropdown.contains(event.target) && !settingsBtn.contains(event.target)) {
      closeDropdown();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDropdown();
    }
  });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', (event) => {
      event.preventDefault();
      closeDropdown();
      if (typeof window.logout === 'function') {
        window.logout();
      } else {
        window.location.href = 'login.html';
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupSettingsDropdown);
} else {
  setupSettingsDropdown();
}
