function setupSettingsDropdown() {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsDropdown = document.getElementById('settings-dropdown');
  const logoutBtn = document.getElementById('settings-logout');

  if (!settingsBtn || !settingsDropdown) return;

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
