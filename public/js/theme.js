(function () {
  const STORAGE_KEY = 'hatchery_theme';

  function getSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;

    const btn = document.getElementById('theme-toggle');
    const label = document.getElementById('theme-toggle-label');

    if (btn) {
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }

    if (label) {
      label.textContent = theme === 'dark' ? 'Dark' : 'Light';
    }
  }

  function getSavedTheme() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  }

  function setSavedTheme(theme) {
    localStorage.setItem(STORAGE_KEY, theme);
  }

  function initTheme() {
    const saved = getSavedTheme();
    const initial = saved || getSystemTheme();
    applyTheme(initial);

    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', () => {
        const current = document.documentElement.dataset.theme || getSystemTheme();
        const next = current === 'dark' ? 'light' : 'dark';
        setSavedTheme(next);
        applyTheme(next);
      });
    }

    if (!saved && window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', () => {
        const stillNoSaved = !getSavedTheme();
        if (stillNoSaved) {
          applyTheme(getSystemTheme());
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();
