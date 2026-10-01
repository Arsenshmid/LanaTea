(() => {
  const setupNotice = document.querySelector('#setupNotice');
  const bookingGate = document.querySelector('#bookingGate');
  const config = window.SUPABASE_CONFIG;

  if (!config?.url || !config?.anonKey || !window.supabase?.createClient) {
    if (setupNotice) setupNotice.hidden = false;
    if (bookingGate) bookingGate.hidden = true;
    const loginButton = document.querySelector('#btnLogin');
    if (loginButton) {
      loginButton.disabled = true;
      loginButton.title = 'Сначала настройте подключение к базе';
    }
    return;
  }

  import('./supabase-app.js')
    .then(({ start }) => start(window.supabase.createClient(config.url, config.anonKey)))
    .catch(error => {
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = `Не удалось запустить приложение: ${error.message}`;
        toast.classList.add('show', 'error');
      }
    });
})();
