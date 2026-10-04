(() => {
  /* ══════════════════════════════════════════════════════════════
     Подключение к Supabase
     ══════════════════════════════════════════════════════════════ */
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
      initBookingExperience();
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

  /* ══════════════════════════════════════════════════════════════
     Утилиты
     ══════════════════════════════════════════════════════════════ */
  const pad = value => String(value).padStart(2, '0');
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const money = value => `${Number(value || 0).toLocaleString('ru-RU')} ₽`;

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  // «Сегодня» по якутскому времени (UTC+9) — так же считает база данных
  const yakutskToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const isoOf = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const fromISO = iso => {
    const [year, month, day] = String(iso).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  };
  const shiftISO = (iso, days) => {
    const date = fromISO(iso);
    date.setUTCDate(date.getUTCDate() + days);
    return isoOf(date);
  };
  const humanDate = iso => new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC'
  }).format(fromISO(iso));

  const guestText = value => {
    const count = Number(value);
    const mod100 = count % 100;
    const mod10 = count % 10;
    const word = mod100 >= 11 && mod100 <= 14 ? 'гостей'
      : mod10 === 1 ? 'гость'
        : mod10 >= 2 && mod10 <= 4 ? 'гостя' : 'гостей';
    return `${count} ${word}`;
  };

  const timeText = value => String(value || '').slice(0, 5);
  const minutesOf = value => {
    const [hour, minute] = String(value || '0:0').split(':').map(Number);
    return (hour || 0) * 60 + (minute || 0);
  };
  const minutesToTime = total => `${pad(Math.floor((total % 1440) / 60))}:${pad(total % 60)}`;

  const priceFrom = selector => {
    const node = document.querySelector(selector);
    return Number(String(node?.textContent || '').replace(/\D/g, '')) || 0;
  };

  function bookingForm() { return document.querySelector('#bookingForm'); }

  /* ══════════════════════════════════════════════════════════════
     Календарь: дата выбирается только кликом по дню
     ══════════════════════════════════════════════════════════════ */
  function setupCalendar() {
    const form = bookingForm();
    const field = document.querySelector('#bookingDate');
    const grid = document.querySelector('#calGrid');
    if (!form || !field || !grid) return;

    const title = document.querySelector('#calTitle');
    const chosen = document.querySelector('#calChosen');
    const todayButton = document.querySelector('#calToday');
    const prevButton = document.querySelector('#calPrev');
    const nextButton = document.querySelector('#calNext');
    const error = document.querySelector('#dateError');

    const minISO = yakutskToday();
    field.min = minISO;

    const selected = () => (field.value && field.value >= minISO ? field.value : '');
    const startView = fromISO(selected() || minISO);
    const view = { year: startView.getUTCFullYear(), month: startView.getUTCMonth() };

    function setError(message) {
      if (!error) return;
      error.textContent = message || '';
      error.hidden = !message;
      field.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    function render() {
      const isCurrentMonth = view.year === Number(minISO.slice(0, 4)) && view.month === Number(minISO.slice(5, 7)) - 1;
      if (title) title.textContent = `${MONTHS[view.month]} ${view.year}`;
      if (prevButton) prevButton.disabled = isCurrentMonth;
      if (nextButton) nextButton.disabled = false;

      const current = selected();
      const first = new Date(Date.UTC(view.year, view.month, 1));
      const lead = (first.getUTCDay() + 6) % 7;          // неделя начинается с понедельника
      const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();

      let html = '';
      for (let index = 0; index < lead; index++) html += '<span class="cal-blank" aria-hidden="true"></span>';
      for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
        const isPast = iso < minISO;
        const isToday = iso === minISO;
        const isSelected = iso === current;
        const classes = ['cal-day'];
        if (isToday) classes.push('is-today');
        if (isSelected) classes.push('is-selected');
        html += `<button class="${classes.join(' ')}" type="button" data-date="${iso}"`
          + `${isPast ? ' disabled aria-disabled="true"' : ''}`
          + ` tabindex="${isSelected || (!current && isToday) ? '0' : '-1'}"`
          + ` aria-pressed="${isSelected}"`
          + ` aria-label="${humanDate(iso)}${isPast ? ' — недоступно' : ''}">${day}</button>`;
      }
      grid.innerHTML = html;

      if (chosen) {
        chosen.textContent = current ? humanDate(current) : 'Дата не выбрана';
        chosen.classList.toggle('is-set', Boolean(current));
      }
      updateSummary();
    }

    function selectDate(iso, options = {}) {
      if (!iso || iso < minISO) return;
      if (Number(iso.slice(0, 4)) !== view.year || Number(iso.slice(5, 7)) - 1 !== view.month) {
        view.year = Number(iso.slice(0, 4));
        view.month = Number(iso.slice(5, 7)) - 1;
      }
      const changed = field.value !== iso;
      field.value = iso;
      setError('');
      render();
      if (options.focus) {
        const button = grid.querySelector(`[data-date="${iso}"]`);
        if (button) button.focus({ preventScroll: true });
      }
      if (changed) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    grid.addEventListener('click', event => {
      const button = event.target.closest('.cal-day');
      if (!button || button.disabled) return;
      selectDate(button.dataset.date);
    });

    grid.addEventListener('keydown', event => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
      if (!step) return;
      event.preventDefault();
      const base = selected() || minISO;
      const next = shiftISO(base, step);
      if (next < minISO) return;
      selectDate(next, { focus: true });
    });

    prevButton?.addEventListener('click', () => {
      view.month -= 1;
      if (view.month < 0) { view.month = 11; view.year -= 1; }
      render();
    });
    nextButton?.addEventListener('click', () => {
      view.month += 1;
      if (view.month > 11) { view.month = 0; view.year += 1; }
      render();
    });
    todayButton?.addEventListener('click', () => selectDate(minISO));

    // изменение даты извне (например, из другого скрипта) — перерисовываем
    field.addEventListener('change', () => { setError(''); render(); });

    render();
  }

  /* ══════════════════════════════════════════════════════════════
     Свободное время — «чипсы» вместо длинного списка
     ══════════════════════════════════════════════════════════════ */
  function setupSlotChips() {
    const select = document.querySelector('#timeFrom');
    const box = document.querySelector('#slotChips');
    if (!select || !box) return;

    const error = document.querySelector('#timeError');

    function render() {
      if (select.disabled) {
        box.innerHTML = '<span class="slot-empty">Проверяем свободное время…</span>';
        return;
      }
      const dateField = document.querySelector('#bookingDate');
      if (!dateField?.value) {
        box.innerHTML = '<span class="slot-empty">Сначала выберите день в календаре — покажем свободные часы.</span>';
        return;
      }
      const options = Array.from(select.options).filter(option => option.value);
      if (!options.length) {
        box.innerHTML = '<span class="slot-empty">На этот день свободного времени нет — выберите другую дату.</span>';
        return;
      }
      box.innerHTML = options.map(option => {
        const busy = option.disabled;
        const active = !busy && option.value === select.value;
        const classes = ['slot-chip'];
        if (busy) classes.push('is-busy');
        if (active) classes.push('is-active');
        return `<button class="${classes.join(' ')}" type="button" data-time="${escapeHTML(option.value)}"`
          + `${busy ? ' disabled aria-disabled="true"' : ''} aria-pressed="${active}">`
          + `<span>${escapeHTML(timeText(option.value))}</span>`
          + `${busy ? '<small>занято</small>' : ''}</button>`;
      }).join('');
      if (error && select.value) error.hidden = true;
    }

    box.addEventListener('click', event => {
      const button = event.target.closest('.slot-chip');
      if (!button || button.disabled) return;
      select.value = button.dataset.time;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      render();
    });

    select.addEventListener('change', render);
    new MutationObserver(render).observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });
    render();
  }

  /* ══════════════════════════════════════════════════════════════
     Гости: число вписывается вручную, от 1 до 25
     ══════════════════════════════════════════════════════════════ */
  function setupGuests() {
    const form = bookingForm();
    const select = document.querySelector('#guestCount');
    if (!form || !select) return;

    const MAX_GUESTS = 25;
    const field = document.querySelector('#guestInput');
    const hint = document.querySelector('#guestHint');
    const minus = document.querySelector('#guestMinus');
    const plus = document.querySelector('#guestPlus');

    const isGroup = () => (form.elements.format?.value || 'individual') === 'group';
    const currentCount = () => {
      const value = Number(select.value);
      return Number.isFinite(value) && value >= 1 ? value : 1;
    };

    function setFormat(value) {
      const radio = form.querySelector(`input[name="format"][value="${value}"]`);
      if (!radio || radio.checked) return;
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // число гостей задаёт формат: 3 и больше — групповая, 1 — индивидуальная
    function syncFormat(count) {
      if (count > 2 && !isGroup()) setFormat('group');
      if (count === 1 && isGroup()) setFormat('individual');
    }

    function refresh() {
      const count = currentCount();
      if (field && document.activeElement !== field) field.value = String(count);
      if (minus) minus.disabled = count <= 1;
      if (plus) plus.disabled = count >= MAX_GUESTS;
      if (hint) {
        hint.textContent = isGroup()
          ? `Групповая: от 2 до ${MAX_GUESTS} гостей`
          : 'Индивидуально: 1–2 гостя. Впишите 3 и больше — формат станет групповым';
      }
    }

    // value — то, что вписал пользователь; rewrite — можно ли переписывать поле ввода
    function applyCount(value, rewrite = true) {
      const rounded = Math.round(Number(value));
      const count = Number.isFinite(rounded) ? Math.min(Math.max(rounded, 1), MAX_GUESTS) : currentCount();
      syncFormat(count);
      if (select.value !== String(count)) {
        select.value = String(count);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (rewrite && field) field.value = String(count);
      refresh();
      updateSummary();
    }

    field?.addEventListener('input', () => {
      const raw = field.value.trim();
      if (!/^\d+$/.test(raw)) return;              // пусто или не число — поправим при потере фокуса
      const typed = Number(raw);
      if (typed > MAX_GUESTS) { applyCount(MAX_GUESTS); return; }
      if (typed < 1) return;
      applyCount(typed, false);                    // не мешаем дописывать число
    });
    field?.addEventListener('change', () => applyCount(field.value));
    field?.addEventListener('blur', () => applyCount(field.value));

    minus?.addEventListener('click', () => applyCount(currentCount() - 1));
    plus?.addEventListener('click', () => applyCount(currentCount() + 1));

    select.addEventListener('change', () => { syncFormat(currentCount()); refresh(); updateSummary(); });
    new MutationObserver(() => { refresh(); syncFormat(currentCount()); }).observe(select, { childList: true });

    refresh();
  }

  /* ══════════════════════════════════════════════════════════════
     Живая сводка заявки
     ══════════════════════════════════════════════════════════════ */
  let lastSummaryHTML = null;

  function summaryData() {
    const form = bookingForm();
    if (!form || form.hidden) return null;

    const date = form.elements.date?.value || '';
    const start = form.elements.timeFrom?.value || '';
    const duration = Number(form.elements.duration?.value) || 120;
    const guests = Number(form.elements.guests?.value) || 1;
    const format = form.querySelector('input[name="format"]:checked')?.value || 'individual';
    const priceIndividual = priceFrom('#priceIndividual') || 2500;
    const priceGroup = priceFrom('#priceGroup') || 1500;
    const teaSelect = form.elements.tea_id;
    const tea = teaSelect?.value ? teaSelect.selectedOptions[0]?.textContent?.trim() : '';

    const price = format === 'individual' ? priceIndividual : priceGroup * guests;
    const end = start ? minutesToTime(minutesOf(start) + duration) : '';
    const perGuest = format === 'individual'
      ? 'цена за встречу'
      : `${money(priceGroup)} × ${guestText(guests)}`;

    return { date, start, end, duration, guests, format, tea, price, perGuest };
  }

  function updateSummary() {
    const summary = document.querySelector('#bookingSummary');
    const bar = document.querySelector('#stickyCta');
    const barPrice = document.querySelector('#stickyPrice');
    const barNote = document.querySelector('#stickyNote');
    if (!summary) return;

    const data = summaryData();
    if (!data) {
      if (summary.innerHTML !== '') { summary.innerHTML = ''; lastSummaryHTML = ''; }
      if (bar) bar.dataset.ready = '0';
      if (barPrice) barPrice.textContent = 'Записаться на церемонию';
      if (barNote) barNote.textContent = 'свободные даты в календаре';
      return;
    }

    if (!data.date) {
      const html = '<p class="summary-empty">Выберите день в календаре — и здесь появится стоимость встречи.</p>';
      if (summary.innerHTML !== html) { summary.innerHTML = html; lastSummaryHTML = html; }
      if (bar) bar.dataset.ready = '0';
      if (barPrice) barPrice.textContent = 'Записаться на церемонию';
      if (barNote) barNote.textContent = 'свободные даты в календаре';
      return;
    }

    const rows = [
      ['Формат', data.format === 'individual' ? 'Индивидуальная церемония' : 'Групповая церемония'],
      ['Дата', humanDate(data.date)],
      ['Время', data.start ? `${data.start}–${data.end}` : 'ещё не выбрано'],
      ['Гостей', guestText(data.guests)],
      ['Чай', data.tea || 'выберет Саргылаана']
    ];

    const html = `<div class="summary-card">
      <div class="summary-top"><span>Ваша встреча</span><strong>${money(data.price)}</strong></div>
      <dl class="summary-rows">${rows.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>
      <p class="summary-hint">${escapeHTML(data.perGuest)}. Итоговую стоимость подтвердит Саргылаана при подтверждении записи.</p>
    </div>`;

    if (html !== lastSummaryHTML || summary.innerHTML !== html) { summary.innerHTML = html; lastSummaryHTML = html; }
    if (bar) bar.dataset.ready = '1';
    if (barPrice) barPrice.textContent = money(data.price);
    if (barNote) barNote.textContent = data.start ? `${humanDate(data.date)} · ${data.start}` : humanDate(data.date);
  }

  function watchSummary() {
    const summary = document.querySelector('#bookingSummary');
    if (!summary) return;
    // Второй скрипт тоже пишет в этот блок короткой строкой — возвращаем карточку
    new MutationObserver(() => {
      if (summary.innerHTML === lastSummaryHTML) return;
      if (summary.querySelector('.summary-card') || summary.querySelector('.summary-empty')) return;
      updateSummary();
    }).observe(summary, { childList: true });
  }

  /* ══════════════════════════════════════════════════════════════
     Мобильная кнопка «Записаться»
     ══════════════════════════════════════════════════════════════ */
  function setupStickyCta() {
    const bar = document.querySelector('#stickyCta');
    const section = document.querySelector('#booking');
    if (!bar || !section) return;

    let sectionVisible = false;

    const sync = () => {
      const show = window.scrollY > 560 && !sectionVisible;
      if (show) {
        bar.hidden = false;
        requestAnimationFrame(() => bar.classList.add('is-visible'));
        return;
      }
      bar.classList.remove('is-visible');
      setTimeout(() => {
        if (!bar.classList.contains('is-visible')) bar.hidden = true;
      }, 280);
    };

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        sectionVisible = entries.some(entry => entry.isIntersecting);
        sync();
      }, { threshold: 0.12 }).observe(section);
    }

    window.addEventListener('scroll', sync, { passive: true });
    sync();
  }

  /* ══════════════════════════════════════════════════════════════
     Форма: подсказки, телефон, проверки
     ══════════════════════════════════════════════════════════════ */
  function setupFormAssist() {
    const form = bookingForm();
    if (!form) return;

    const phone = form.elements.phone;
    if (phone) {
      phone.addEventListener('blur', () => {
        const digits = phone.value.replace(/\D/g, '');
        const normalized = digits.length === 10 ? `7${digits}`
          : digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}`
            : digits;
        if (normalized.length === 11 && normalized.startsWith('7')) {
          phone.value = `+7 (${normalized.slice(1, 4)}) ${normalized.slice(4, 7)}-${normalized.slice(7, 9)}-${normalized.slice(9, 11)}`;
        }
      });
    }

    form.addEventListener('submit', () => {
      const date = form.elements.date?.value || '';
      const start = form.elements.timeFrom?.value || '';
      const dateError = document.querySelector('#dateError');
      const timeError = document.querySelector('#timeError');
      const minISO = yakutskToday();

      if (!date || date < minISO) {
        if (dateError) { dateError.textContent = 'Выберите день в календаре.'; dateError.hidden = false; }
        if (dateError) dateError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (dateError) dateError.hidden = true;

      if (!start) {
        if (timeError) {
          timeError.textContent = 'Свободное время не выбрано — нажмите на подходящий час.';
          timeError.hidden = false;
          timeError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      if (timeError) timeError.hidden = true;
    });

    ['full_name', 'phone'].forEach(name => {
      const field = form.elements[name];
      field?.addEventListener('input', () => { if (field.value.trim()) field.setCustomValidity(''); });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     Запуск интерфейса записи
     ══════════════════════════════════════════════════════════════ */
  function initBookingExperience() {
    const form = bookingForm();
    if (!form) return;

    setupCalendar();
    setupSlotChips();
    setupGuests();
    setupFormAssist();
    setupStickyCta();
    watchSummary();

    form.addEventListener('input', updateSummary);
    form.addEventListener('change', updateSummary);

    form.querySelectorAll('input[name="format"]').forEach(radio => {
      radio.addEventListener('change', () => {
        updateSummary();
      });
    });

    // когда форма показана (после входа) — обновляем сводку
    new MutationObserver(() => updateSummary()).observe(form, { attributes: true, attributeFilter: ['hidden'] });

    updateSummary();
  }

  function setupGuestHint() {
    const form = bookingForm();
    const hint = document.querySelector('#guestHint');
    if (!form || !hint) return;
    const format = form.elements.format?.value || 'individual';
    hint.textContent = format === 'individual' ? 'Индивидуально: 1–2 гостя' : 'Групповая: от 2 до 25 гостей';
  }

  /* ══════════════════════════════════════════════════════════════
     Подтверждение почты: окно «вы успешно зарегистрированы»
     показываем сразу, как только почта подтверждена
     ══════════════════════════════════════════════════════════════ */
  const verifiedModal = document.querySelector('#verifiedModal');
  const verificationModal = document.querySelector('#verificationModal');
  const verifiedTitle = document.querySelector('#verifiedTitle');
  const verifiedCopy = document.querySelector('#verifiedCopy');
  const verifiedHint = document.querySelector('#verifiedHint');
  const verifiedLogin = document.querySelector('#verifiedLogin');

  let waitingForEmail = false;   // пользователь ждёт подтверждения почты
  let modalMode = null;          // 'success' | 'fallback' — чтобы окно не мигало

  const isVerifiedUser = user => Boolean(user?.email_confirmed_at || user?.confirmed_at);

  // Оверлею нужен и атрибут hidden, и класс open — иначе он остаётся невидимым
  function openVerifiedModal() {
    if (!verifiedModal) return;
    verifiedModal.hidden = false;
    verifiedModal.classList.add('open');
  }

  function closeVerifiedModal() {
    if (!verifiedModal) return;
    verifiedModal.classList.remove('open');
    verifiedModal.hidden = true;
  }

  function hideVerificationModal() {
    if (!verificationModal) return;
    verificationModal.classList.remove('open');
    verificationModal.hidden = true;
  }

  function clearAuthParams() {
    if (window.location.search || window.location.hash) {
      history.replaceState(null, '', window.location.pathname);
    }
  }

  // Почта подтверждена — «Вы успешно зарегистрированы!»
  function showRegistered() {
    if (modalMode === 'success') return;
    modalMode = 'success';
    waitingForEmail = false;
    hideVerificationModal();
    clearAuthParams();
    if (verifiedTitle) verifiedTitle.textContent = 'Вы успешно зарегистрированы!';
    if (verifiedCopy) verifiedCopy.textContent = 'Почта подтверждена. Можете вернуться на сайт — выбрать дату и записаться на церемонию.';
    if (verifiedHint) {
      verifiedHint.textContent = 'Это окно открылось из письма: вкладку с почтой можно закрыть.';
      verifiedHint.hidden = false;
    }
    if (verifiedLogin) verifiedLogin.hidden = true;
    openVerifiedModal();
  }

  // Ссылка обработана, но сессия не появилась — предложим войти
  function showVerificationFallback() {
    if (modalMode) return;
    modalMode = 'fallback';
    hideVerificationModal();
    clearAuthParams();
    if (verifiedTitle) verifiedTitle.textContent = 'Почта подтверждена';
    if (verifiedCopy) verifiedCopy.textContent = 'Ссылка из письма обработана. Если вход не произошёл автоматически — войдите в аккаунт с тем же email.';
    if (verifiedHint) verifiedHint.hidden = true;
    if (verifiedLogin) verifiedLogin.hidden = false;
    openVerifiedModal();
  }

  document.querySelector('#verifiedClose')?.addEventListener('click', closeVerifiedModal);
  document.querySelector('#verifiedGo')?.addEventListener('click', () => {
    closeVerifiedModal();
    document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' });
  });
  verifiedLogin?.addEventListener('click', () => {
    closeVerifiedModal();
    const login = document.querySelector('#btnLogin');
    if (login && !login.hidden) login.click();
    else document.querySelector('[data-open-auth="login"]')?.click();
  });
  verifiedModal?.addEventListener('click', event => { if (event.target === verifiedModal) closeVerifiedModal(); });

  // Если человек вошёл вручную (не по ссылке из письма) — окно регистрации не показываем
  document.querySelector('#loginForm')?.addEventListener('submit', () => {
    waitingForEmail = false;
    modalMode = null;
  });

  // Ждём подтверждения: как только появилась подтверждённая сессия — показываем окно
  client.auth.onAuthStateChange((event, session) => {
    if (!waitingForEmail) return;
    if (session?.user && isVerifiedUser(session.user)) showRegistered();
  });

  // Если окно «подтвердите почту» открыто — значит пользователь ждёт письмо
  if (verificationModal) {
    new MutationObserver(() => {
      if (!verificationModal.hidden) waitingForEmail = true;
    }).observe(verificationModal, { attributes: true, attributeFilter: ['hidden'] });
  }

  function watchEmailConfirmation() {
    const url = new URL(window.location.href);
    // Supabase приводит пользователя с сайта письма: ?code=..., ?token_hash=... или #access_token=...
    const cameFromEmail = url.searchParams.has('code')
      || url.searchParams.has('token_hash')
      || url.searchParams.has('error_description')
      || url.hash.includes('access_token=');

    if (cameFromEmail) waitingForEmail = true;

    // опрос: и на странице из письма, и в открытой вкладке сайта
    let attempts = 0;
    const maxAttempts = cameFromEmail ? 10 : 40;
    const tick = async () => {
      if (!waitingForEmail || modalMode === 'success') return;
      attempts += 1;
      try {
        const { data } = await client.auth.getSession();
        const user = data?.session?.user;
        if (user && isVerifiedUser(user)) { showRegistered(); return; }
        if (user) {
          // в старом токене может не быть отметки о подтверждении — уточняем у сервера
          const { data: fresh } = await client.auth.getUser();
          if (isVerifiedUser(fresh?.user)) { showRegistered(); return; }
        }
      } catch (_) { /* тихо пробуем ещё раз */ }
      if (attempts >= maxAttempts) {
        if (cameFromEmail) showVerificationFallback();
        return;
      }
      setTimeout(tick, cameFromEmail ? 900 : 1500);
    };
    setTimeout(tick, cameFromEmail ? 400 : 1200);
  }
  watchEmailConfirmation();
})();
