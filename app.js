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

  const client = window.supabase.createClient(config.url, config.anonKey);

  import('./supabase-app.js')
    .then(({ start }) => {
      start(client);
      enhanceBookingForm();
      setTimeout(updateSummary, 600);
      setTimeout(updateSummary, 2000);
    })
    .catch(error => {
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = `Не удалось запустить приложение: ${error.message}`;
        toast.classList.add('show', 'error');
      }
    });

  /* ═══ 1. Дата: только встроенный календарь, без ручного ввода ═══ */

  // «Сегодня» по якутскому времени (UTC+9) — чтобы нельзя было выбрать прошедшую дату
  const yakutskToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  const bookingDate = document.querySelector('#bookingDate');
  if (bookingDate) bookingDate.min = yakutskToday();

  // Клик по любому полю даты на сайте сразу открывает календарик
  document.addEventListener('click', event => {
    const input = event.target instanceof Element && event.target.closest('input[type="date"]');
    if (!input) return;
    try { input.showPicker?.(); } catch (_) { /* календарь откроется штатно */ }
  });

  /* ═══ 2. Гости: всегда от 1 до 25 ═══ */
  function ensureGuestRange() {
    const select = document.querySelector('#guestCount');
    if (!select) return;
    const fill = () => {
      // уже готово — ничего не делаем (защита от цикла наблюдателя)
      if (select.options.length === 25 && select.options[0].value === '1') return;
      const previous = select.value;
      let html = '';
      for (let i = 1; i <= 25; i++) html += `<option value="${i}">${i}</option>`;
      select.innerHTML = html;
      const n = Math.min(Math.max(parseInt(previous, 10) || 1, 1), 25);
      select.value = String(n);
    };
    fill();
    // если другой скрипт подменяет список гостей — возвращаем 1–25 автоматически
    new MutationObserver(fill).observe(select, { childList: true });
  }
  ensureGuestRange();

  /* ═══ 3. Живая сводка заявки с ценой ═══ */
  function updateSummary() {
    const form = document.querySelector('#bookingForm');
    const summary = document.querySelector('#bookingSummary');
    if (!form || form.hidden || !summary) return;

    const date = form.elements.date?.value;
    if (!date) {
      summary.textContent = 'Выберите дату в календаре — и увидите детали визита.';
      return;
    }
    const from = form.elements.timeFrom?.value || '14:00';
    const duration = parseInt(form.elements.duration?.value, 10) || 120;
    const guests = parseInt(form.elements.guests?.value, 10) || 1;
    const format = form.querySelector('input[name="format"]:checked')?.value || 'individual';

    const priceIndividual = parseInt((document.querySelector('#priceIndividual')?.textContent || '').replace(/\D/g, ''), 10) || 0;
    const priceGroup = parseInt((document.querySelector('#priceGroup')?.textContent || '').replace(/\D/g, ''), 10) || 0;
    // индивидуальная — фикс за встречу (1–2 гостя); больше двух — по цене за гостя
    const price = (format === 'individual' && guests <= 2) ? priceIndividual : priceGroup * guests;

    const [h, m] = from.split(':').map(Number);
    const end = ((h || 0) * 60 + (m || 0) + duration) % (24 * 60);
    const to = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;

    const teaSelect = form.elements.tea_id;
    const tea = teaSelect?.value ? teaSelect.selectedOptions[0].textContent : 'на выбор Саргылааны';

    const kind = format === 'individual' ? 'Индивидуальная церемония' : 'Групповая церемония';
    summary.innerHTML =
      `${kind} · <strong>${date.split('-').reverse().join('.')}</strong> · ${from}–${to} · гостей: ${guests} · чай: ${tea} · <strong>${price.toLocaleString('ru-RU')} ₽</strong>`;
  }

  function enhanceBookingForm() {
    const form = document.querySelector('#bookingForm');
    if (!form) return;
    form.addEventListener('input', updateSummary);
    form.addEventListener('change', updateSummary);
    updateSummary();
  }

  /* ═══ 4. Приветствие после подтверждения почты ═══ */
  const verifiedModal = document.querySelector('#verifiedModal');

  function openVerifiedModal() { if (verifiedModal) verifiedModal.hidden = false; }
  function closeVerifiedModal() { if (verifiedModal) verifiedModal.hidden = true; }

  document.querySelector('#verifiedClose')?.addEventListener('click', closeVerifiedModal);
  document.querySelector('#verifiedGo')?.addEventListener('click', () => {
    closeVerifiedModal();
    document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' });
  });
  verifiedModal?.addEventListener('click', e => { if (e.target === verifiedModal) closeVerifiedModal(); });

  function watchEmailConfirmation() {
    const url = new URL(window.location.href);
    // Supabase возвращает пользователя с сайта письма с ?code=... или #access_token=...
    const cameFromEmail = url.searchParams.has('code') || url.hash.includes('access_token=');
    if (!cameFromEmail) return;

    let shown = false;
    const check = async () => {
      if (shown) return;
      try {
        const { data } = await client.auth.getSession();
        if (data?.session) {
          shown = true;
          openVerifiedModal();
          // чистим адресную строку от служебных параметров
          history.replaceState(null, '', window.location.pathname);
        }
      } catch (_) { /* тихо пробуем ещё раз */ }
    };
    [800, 2000, 4000, 7000].forEach(delay => setTimeout(check, delay));
  }
  watchEmailConfirmation();
})();