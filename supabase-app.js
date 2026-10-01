export function start(client) {
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));
  const form = $('#bookingForm');
  const dateField = $('#bookingDate');
  const startField = $('#timeFrom');
  const durationField = $('#duration');
  const guestField = $('#guestCount');
  const teaField = $('select[name="tea_id"]');
  const bookingList = $('#bookingList');
  const emptyMessage = $('#logEmpty');
  const toastElement = $('#toast');
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  const prices = { individual: 2500, groupPerGuest: 1500 };
  let session = null;
  let profile = null;
  let busySlots = [];
  let toastTimer;
  let availabilityRequest = 0;
  let pendingVerificationEmail = '';
  let resendCooldownTimer;
  let editingNewsId = null;
  let adminNewsItems = [];

  function toast(message, error = false) {
    toastElement.textContent = message;
    toastElement.classList.toggle('error', error);
    toastElement.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), 4500);
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function minutes(value) {
    const [hour, minute] = String(value).split(':').map(Number);
    return hour * 60 + minute;
  }

  function timeText(value) {
    return String(value).slice(0, 5);
  }

  function dateText(value) {
    const [year, month, day] = value.split('-');
    return `${day}.${month}.${year}`;
  }

  function guestText(value) {
    const count = Number(value);
    const mod100 = count % 100;
    const mod10 = count % 10;
    const word = mod100 >= 11 && mod100 <= 14 ? 'гостей'
      : mod10 === 1 ? 'гость'
        : mod10 >= 2 && mod10 <= 4 ? 'гостя' : 'гостей';
    return `${count} ${word}`;
  }

  function normalizePhone(value) {
    let digits = String(value).replace(/\D/g, '');
    if (digits.length === 10) digits = `7${digits}`;
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    return digits.length === 11 && digits.startsWith('7') ? `+${digits}` : null;
  }

  function showAuth(mode = 'login') {
    $('#authModal').hidden = false;
    $('#authModal').classList.add('open');
    setAuthMode(mode);
  }

  function closeAuth() {
    $('#authModal').classList.remove('open');
    $('#authModal').hidden = true;
  }

  function isEmailVerified(user) {
    return Boolean(user?.email_confirmed_at || user?.confirmed_at);
  }

  function verificationRedirect() {
    const redirect = new URL(window.location.href);
    redirect.search = '';
    redirect.hash = '';
    return redirect.href;
  }

  function showVerification(email, message = 'Не нашли письмо? Проверьте папку «Спам».') {
    pendingVerificationEmail = String(email || '').trim();
    $('#verificationEmail').textContent = pendingVerificationEmail || 'указанный адрес';
    $('#verificationStatus').textContent = message;
    $('#verificationModal').hidden = false;
    $('#verificationModal').classList.add('open');
    $('#bookingGate').hidden = false;
    $('#bookingGate').querySelector('p').textContent = 'Подтвердите адрес почты, чтобы открыть запись и личный кабинет.';
  }

  function closeVerification() {
    $('#verificationModal').classList.remove('open');
    $('#verificationModal').hidden = true;
  }

  function setAuthMode(mode) {
    $('#loginForm').hidden = mode !== 'login';
    $('#registerForm').hidden = mode !== 'register';
    $$('[data-auth-mode]').forEach(button => button.classList.toggle('active', button.dataset.authMode === mode));
    $('#authTitle').textContent = mode === 'login' ? 'Добро пожаловать.' : 'Первая чашка — за знакомство.';
  }

  function updatePrices() {
    const individual = $('#priceIndividual');
    const group = $('#priceGroup');
    if (individual) individual.textContent = `${prices.individual.toLocaleString('ru-RU')} ₽`;
    if (group) group.textContent = `${prices.groupPerGuest.toLocaleString('ru-RU')} ₽`;
    updateSummary();
  }

  function buildGuestOptions() {
    const format = form.elements.format.value;
    const minimum = format === 'individual' ? 1 : 2;
    const maximum = format === 'individual' ? 2 : 25;
    const previous = Number(guestField.value);
    guestField.innerHTML = Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index)
      .map(count => `<option value="${count}">${guestText(count)}</option>`).join('');
    guestField.value = previous >= minimum && previous <= maximum ? String(previous) : (format === 'group' ? '4' : '1');
    updateSummary();
  }

  async function loadPublicData() {
    const [settingsResult, teasResult] = await Promise.all([
      client.from('settings').select('price_individual,price_group_per_guest').eq('id', 1).single(),
      client.from('teas').select('id,name,is_active').eq('is_active', true).order('sort_order')
    ]);
    if (!settingsResult.error && settingsResult.data) {
      prices.individual = settingsResult.data.price_individual;
      prices.groupPerGuest = settingsResult.data.price_group_per_guest;
      updatePrices();
    }
    if (teasResult.error) {
      toast(`Не удалось загрузить чайную карту: ${teasResult.error.message}`, true);
      return;
    }
    teaField.innerHTML = '<option value="">Пусть Лана выберет</option>' + teasResult.data
      .map(tea => `<option value="${escapeHTML(tea.id)}">${escapeHTML(tea.name)}</option>`).join('');
  }

  function newsDateLabel(item) {
    const parts = [];
    if (item.event_date) parts.push(dateText(item.event_date));
    if (item.event_time) parts.push(timeText(item.event_time));
    return parts.join(' · ') || 'Новости чайного дома';
  }

  async function loadPublicNews() {
    const { data, error } = await client.from('news_events')
      .select('id,kind,title,description,event_date,event_time,created_at')
      .eq('is_published', true)
      .or(`event_date.is.null,event_date.gte.${today()}`)
      .order('event_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) {
      toast(`Не удалось загрузить новости: ${error.message}`, true);
      return;
    }
    const section = $('#newsSection');
    const items = data || [];
    section.hidden = items.length === 0;
    $('#publicNews').innerHTML = items.map(item => `
      <article class="public-news-card">
        <span class="news-kind">${item.kind === 'event' ? 'Событие' : 'Новость'}</span>
        <p class="news-date">${escapeHTML(newsDateLabel(item))}</p>
        <h3>${escapeHTML(item.title)}</h3>
        <p class="news-description">${escapeHTML(item.description)}</p>
      </article>`).join('');
  }

  async function syncSession(nextSession) {
    session = nextSession;
    profile = null;
    const hasSession = Boolean(session?.user);
    const isSignedIn = hasSession && isEmailVerified(session.user);
    $('#btnLogin').hidden = isSignedIn;
    $('#btnLogout').hidden = !isSignedIn;
    $('#userLabel').hidden = !isSignedIn;
    $('#bookingGate').hidden = isSignedIn;
    form.hidden = !isSignedIn;
    $('#my').hidden = !isSignedIn;
    $('#navMy').hidden = !isSignedIn;
    $('#navAdmin').hidden = true;
    $('#adminStats').hidden = true;

    if (hasSession && !isSignedIn) {
      const email = session.user.email || '';
      $('#bookingGate').hidden = false;
      $('#bookingGate').querySelector('p').textContent = 'Подтвердите адрес почты, чтобы открыть запись и личный кабинет.';
      bookingList.innerHTML = '';
      emptyMessage.hidden = false;
      emptyMessage.textContent = 'Подтвердите email, чтобы увидеть записи.';
      showVerification(email, 'Подтвердите адрес по ссылке в письме, прежде чем записываться.');
      return;
    }

    if (!isSignedIn) {
      $('#bookingGate').querySelector('p').textContent = 'Войдите или зарегистрируйтесь, чтобы выбрать время и оставить заявку.';
      bookingList.innerHTML = '';
      emptyMessage.hidden = false;
      emptyMessage.textContent = 'Войдите, чтобы увидеть свои записи.';
      return;
    }

    closeVerification();

    const { data, error } = await client.from('profiles')
      .select('full_name,phone,email,role').eq('id', session.user.id).single();
    if (error) {
      toast(`Не удалось загрузить профиль: ${error.message}`, true);
      return;
    }
    profile = data;
    const isAdmin = profile.role === 'admin';
    const name = profile.full_name || session.user.email;
    $('#userLabel').textContent = name;
    $('#navAdmin').hidden = !isAdmin;
    $('#adminStats').hidden = !isAdmin;
    $('#adminNews').hidden = !isAdmin;
    $('#logKicker').textContent = isAdmin ? 'Панель хозяйки' : 'Личный кабинет';
    $('#logTitle').innerHTML = isAdmin ? 'Все <em>заявки.</em>' : 'Мои <em>записи.</em>';
    form.elements.full_name.value = profile.full_name || '';
    form.elements.phone.value = profile.phone || '';
    await loadBookings();
    if (isAdmin) await loadAdminNews();
    if (dateField.value) await loadAvailability();
  }

  function updateSummary() {
    if (!dateField.value || !startField.value) {
      $('#bookingSummary').textContent = 'Выберите дату и свободное время.';
      return;
    }
    const format = form.elements.format.value;
    const guests = Number(guestField.value) || 1;
    const start = minutes(startField.value);
    const end = start + Number(durationField.value);
    const endText = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    const cost = format === 'individual' ? prices.individual : prices.groupPerGuest * guests;
    const label = format === 'individual' ? 'Индивидуальная' : 'Групповая';
    $('#bookingSummary').innerHTML = `${label} церемония · ${dateText(dateField.value)} · ${timeText(startField.value)}–${endText} · ${guestText(guests)} · <strong>${cost.toLocaleString('ru-RU')} ₽</strong>`;
  }

  function buildStartOptions() {
    const duration = Number(durationField.value);
    const previous = startField.value;
    const buffer = 30;
    const options = [];
    for (let start = 10 * 60; start + duration <= 21 * 60; start += 30) {
      const end = start + duration;
      const occupied = busySlots.some(slot => {
        const occupiedStart = minutes(slot.slot_from);
        const occupiedEnd = minutes(slot.slot_to);
        return start < occupiedEnd + buffer && occupiedStart < end + buffer;
      });
      const label = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
      options.push(`<option value="${label}" ${occupied ? 'disabled' : ''}>${label}${occupied ? ' · занято' : ''}</option>`);
    }
    if (!options.length) {
      startField.innerHTML = '<option value="">Нет свободного времени</option>';
    } else {
      startField.innerHTML = options.join('');
      if (previous && Array.from(startField.options).some(option => option.value === previous && !option.disabled)) {
        startField.value = previous;
      } else {
        const firstFree = Array.from(startField.options).find(option => !option.disabled);
        startField.value = firstFree?.value || '';
      }
    }
    updateSummary();
  }

  async function loadAvailability() {
    const date = dateField.value;
    const request = ++availabilityRequest;
    if (!date) {
      busySlots = [];
      startField.innerHTML = '<option value="">Сначала выберите дату</option>';
      updateSummary();
      return;
    }
    startField.disabled = true;
    startField.innerHTML = '<option value="">Проверяем время…</option>';
    const { data, error } = await client.rpc('busy_slots', { day: date });
    if (request !== availabilityRequest) return;
    if (error) {
      startField.innerHTML = '<option value="">Не удалось загрузить слоты</option>';
      toast(`Не удалось проверить занятость: ${error.message}`, true);
      startField.disabled = true;
      return;
    }
    busySlots = data || [];
    buildStartOptions();
    startField.disabled = false;
  }

  async function loadBookings() {
    if (!session?.user) return;
    let query = client.from('bookings')
      .select('id,booking_date,time_from,time_to,format,guests,comment,price,status,created_at,profiles(full_name,phone),teas(name)')
      .order('booking_date', { ascending: true }).order('time_from', { ascending: true });
    const filter = $('#bookingFilter').value;
    if (filter === 'upcoming') query = query.gte('booking_date', today()).neq('status', 'cancelled');
    if (filter === 'date' && $('#adminDate').value) query = query.eq('booking_date', $('#adminDate').value);
    const { data, error } = await query;
    if (error) {
      toast(`Не удалось загрузить записи: ${error.message}`, true);
      return;
    }
    renderBookings(data || []);
  }

  function renderBookings(bookings) {
    const isAdmin = profile?.role === 'admin';
    const labels = { pending: 'Ожидает ответа', confirmed: 'Подтверждена', cancelled: 'Отменена' };
    emptyMessage.hidden = bookings.length > 0;
    bookingList.innerHTML = bookings.map(booking => {
      const guestName = booking.profiles?.full_name || '';
      const phone = isAdmin
        ? `${booking.profiles?.phone || ''} · ${booking.profiles?.email || ''}`
        : booking.profiles?.phone || '';
      const tea = booking.teas?.name || 'Пусть Лана выберет';
      const individual = booking.format === 'individual';
      const actions = booking.status === 'cancelled' ? '' : `
        ${isAdmin && booking.status === 'pending' ? `<button class="row-action" type="button" data-action="confirm" data-id="${escapeHTML(booking.id)}">Подтвердить</button>` : ''}
        <button class="row-action row-action-danger" type="button" data-action="cancel" data-id="${escapeHTML(booking.id)}">Отменить</button>`;
      return `<article class="booking-row">
        <div class="booking-row-main"><strong>${dateText(booking.booking_date)} · ${timeText(booking.time_from)}–${timeText(booking.time_to)}</strong><span>${escapeHTML(guestName)} · ${escapeHTML(phone)}</span></div>
        <div class="booking-row-details"><strong>${individual ? 'Индивидуальная' : 'Групповая'} · ${guestText(booking.guests)}</strong><span>${escapeHTML(tea)} · ${Number(booking.price).toLocaleString('ru-RU')} ₽</span></div>
        <span class="status status-${escapeHTML(booking.status)}">${labels[booking.status] || escapeHTML(booking.status)}</span>
        <div class="row-actions">${actions}</div>
      </article>`;
    }).join('');

    if (isAdmin) {
      const current = today();
      $('#statToday').textContent = bookings.filter(item => item.booking_date === current && item.status !== 'cancelled').length;
      $('#statPending').textContent = bookings.filter(item => item.status === 'pending' && item.booking_date >= current).length;
    }
  }

  async function loadAdminNews() {
    if (profile?.role !== 'admin') return;
    const { data, error } = await client.from('news_events')
      .select('id,kind,title,description,event_date,event_time,is_published,created_at')
      .order('created_at', { ascending: false });
    if (error) {
      toast(`Не удалось загрузить новости: ${error.message}`, true);
      return;
    }
    renderAdminNews(data || []);
  }

  function renderAdminNews(items) {
    adminNewsItems = items;
    const list = $('#adminNewsList');
    if (!items.length) {
      list.innerHTML = '<p class="news-admin-empty">Публикаций пока нет.</p>';
      return;
    }
    list.innerHTML = items.map(item => `
      <article class="admin-news-item">
        <div class="admin-news-content">
          <span class="news-kind">${item.kind === 'event' ? 'Событие' : 'Новость'} · ${item.is_published ? 'Опубликовано' : 'Черновик'}</span>
          <h4>${escapeHTML(item.title)}</h4>
          <p class="news-date">${escapeHTML(newsDateLabel(item))}</p>
          <p class="news-description">${escapeHTML(item.description)}</p>
        </div>
        <div class="admin-news-actions">
          <button class="row-action" type="button" data-news-action="edit" data-id="${escapeHTML(item.id)}">Изменить</button>
          <button class="row-action" type="button" data-news-action="toggle" data-id="${escapeHTML(item.id)}" data-published="${item.is_published}">${item.is_published ? 'Снять с публикации' : 'Опубликовать'}</button>
          <button class="row-action row-action-danger" type="button" data-news-action="delete" data-id="${escapeHTML(item.id)}">Удалить</button>
        </div>
      </article>`).join('');
  }

  function resetNewsForm() {
    editingNewsId = null;
    $('#newsForm').reset();
    $('#newsForm').elements.id.value = '';
    $('#saveNewsButton').innerHTML = 'Опубликовать <span aria-hidden="true">↗</span>';
    $('#cancelNewsEdit').hidden = true;
  }

  function editNewsItem(item) {
    editingNewsId = item.id;
    const eventForm = $('#newsForm');
    eventForm.elements.id.value = item.id;
    eventForm.elements.kind.value = item.kind;
    eventForm.elements.title.value = item.title;
    eventForm.elements.event_date.value = item.event_date || '';
    eventForm.elements.event_time.value = item.event_time ? timeText(item.event_time) : '';
    eventForm.elements.description.value = item.description;
    eventForm.elements.is_published.checked = item.is_published;
    $('#saveNewsButton').textContent = 'Сохранить изменения';
    $('#cancelNewsEdit').hidden = false;
    eventForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function saveNewsItem(event) {
    event.preventDefault();
    if (profile?.role !== 'admin') return toast('Недостаточно прав для публикации.', true);
    const eventForm = event.currentTarget;
    const data = new FormData(eventForm);
    const values = {
      kind: String(data.get('kind')),
      title: String(data.get('title')).trim(),
      description: String(data.get('description')).trim(),
      event_date: String(data.get('event_date')) || null,
      event_time: String(data.get('event_time')) || null,
      is_published: data.get('is_published') === 'on'
    };
    const saveButton = $('#saveNewsButton');
    saveButton.disabled = true;
    try {
      const result = editingNewsId
        ? await client.from('news_events').update(values).eq('id', editingNewsId)
        : await client.from('news_events').insert({ ...values, created_by: session.user.id });
      if (result.error) throw result.error;
      toast(editingNewsId ? 'Изменения сохранены.' : 'Публикация создана.');
      resetNewsForm();
      await Promise.all([loadAdminNews(), loadPublicNews()]);
    } catch (error) {
      toast(`Не удалось сохранить публикацию: ${error.message}`, true);
    } finally {
      saveButton.disabled = false;
    }
  }

  async function handleAdminNewsAction(event) {
    const button = event.target.closest('[data-news-action]');
    if (!button || profile?.role !== 'admin') return;
    const item = adminNewsItems.find(news => news.id === button.dataset.id);
    if (!item) return;
    const action = button.dataset.newsAction;
    if (action === 'edit') return editNewsItem(item);
    if (action === 'delete' && !window.confirm(`Удалить публикацию «${item.title}»?`)) return;
    button.disabled = true;
    try {
      const result = action === 'toggle'
        ? await client.from('news_events').update({ is_published: !item.is_published }).eq('id', item.id)
        : await client.from('news_events').delete().eq('id', item.id);
      if (result.error) throw result.error;
      toast(action === 'toggle' ? (item.is_published ? 'Публикация снята с сайта.' : 'Публикация размещена на сайте.') : 'Публикация удалена.');
      await Promise.all([loadAdminNews(), loadPublicNews()]);
    } catch (error) {
      toast(`Не удалось изменить публикацию: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  }

  function describeError(error) {
    if (error.code === '23P01') return 'Это время только что заняли. Выберите другой свободный интервал.';
    if (error.code === '23514') return 'Проверьте длительность, формат и число гостей.';
    return error.message || 'Не удалось выполнить запрос.';
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!session?.user) return showAuth();
    const data = new FormData(form);
    const phone = normalizePhone(data.get('phone'));
    if (!phone) return toast('Введите российский номер телефона из 10 или 11 цифр.', true);
    if (!dateField.value || dateField.value < today()) return toast('Выберите сегодняшнюю или будущую дату.', true);
    if (!startField.value || startField.selectedOptions[0]?.disabled) return toast('Выберите свободное время.', true);

    const start = minutes(startField.value);
    const end = start + Number(durationField.value);
    const timeTo = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const { error: profileError } = await client.from('profiles').update({
        full_name: String(data.get('full_name')).trim(), phone
      }).eq('id', session.user.id);
      if (profileError) throw profileError;

      const { error } = await client.from('bookings').insert({
        user_id: session.user.id,
        booking_date: dateField.value,
        time_from: startField.value,
        time_to: timeTo,
        format: String(data.get('format')),
        guests: Number(data.get('guests')),
        tea_id: data.get('tea_id') || null,
        comment: String(data.get('comment')).trim(),
        status: 'pending'
      });
      if (error) throw error;

      toast('Заявка отправлена. Лана свяжется с вами для подтверждения.');
      form.elements.comment.value = '';
      await loadBookings();
      await loadAvailability();
      $('#my').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      toast(describeError(error), true);
    } finally {
      button.disabled = false;
    }
  });

  bookingList.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || !session?.user) return;
    const action = button.dataset.action;
    if (action === 'cancel' && !window.confirm('Отменить эту запись?')) return;
    button.disabled = true;
    const status = action === 'confirm' ? 'confirmed' : 'cancelled';
    const { error } = await client.from('bookings').update({ status }).eq('id', button.dataset.id);
    if (error) {
      toast(describeError(error), true);
      button.disabled = false;
      return;
    }
    toast(status === 'confirmed' ? 'Запись подтверждена.' : 'Запись отменена.');
    await loadBookings();
    if (dateField.value) await loadAvailability();
  });

  $('#newsForm').addEventListener('submit', saveNewsItem);
  $('#cancelNewsEdit').addEventListener('click', resetNewsForm);
  $('#adminNewsList').addEventListener('click', handleAdminNewsAction);

  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const loginForm = event.currentTarget;
    const data = new FormData(loginForm);
    const email = String(data.get('email')).trim();
    const { error } = await client.auth.signInWithPassword({
      email, password: String(data.get('password'))
    });
    if (error) {
      if (error.code === 'email_not_confirmed') {
        closeAuth();
        showVerification(email, 'Сначала подтвердите email по ссылке в письме.');
        return;
      }
      return toast(error.message, true);
    }
    loginForm.reset();
    closeAuth();
    toast('Вы вошли в аккаунт.');
  });

  $('#registerForm').addEventListener('submit', async event => {
    event.preventDefault();
    const registerForm = event.currentTarget;
    const data = new FormData(registerForm);
    const phone = normalizePhone(data.get('phone'));
    if (!phone) return toast('Введите российский номер телефона из 10 или 11 цифр.', true);
    const email = String(data.get('email')).trim();
    const { data: result, error } = await client.auth.signUp({
      email,
      password: String(data.get('password')),
      options: {
        emailRedirectTo: verificationRedirect(),
        data: {
          full_name: String(data.get('full_name')).trim(),
          phone,
          privacy_policy_version: '2026-10-01'
        }
      }
    });
    if (error) return toast(error.message, true);
    registerForm.reset();
    closeAuth();
    if (!isEmailVerified(result.user)) {
      showVerification(email, 'Письмо со ссылкой отправлено. Подтвердите email, чтобы записаться на церемонию.');
      return;
    }
    toast(result.session ? 'Email уже подтверждён, аккаунт создан.' : 'Аккаунт создан. Войдите, чтобы записаться.');
  });

  async function resendVerification() {
    const button = $('#resendVerification');
    const status = $('#verificationStatus');
    if (!pendingVerificationEmail) {
      status.textContent = 'Не удалось определить email. Попробуйте зарегистрироваться ещё раз.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Отправляем письмо…';
    const { error } = await client.auth.resend({
      type: 'signup',
      email: pendingVerificationEmail,
      options: { emailRedirectTo: verificationRedirect() }
    });
    if (error) {
      status.textContent = `Не удалось отправить письмо: ${error.message}`;
      button.disabled = false;
      button.textContent = 'Отправить письмо ещё раз';
      return;
    }
    status.textContent = `Новое письмо отправлено на ${pendingVerificationEmail}. Проверьте также папку «Спам».`;
    let remaining = 60;
    button.textContent = `Повторить через ${remaining} с`;
    clearInterval(resendCooldownTimer);
    resendCooldownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(resendCooldownTimer);
        button.disabled = false;
        button.textContent = 'Отправить письмо ещё раз';
        return;
      }
      button.textContent = `Повторить через ${remaining} с`;
    }, 1000);
  }

  async function checkVerification() {
    const button = $('#checkVerification');
    const status = $('#verificationStatus');
    button.disabled = true;
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !isEmailVerified(data?.user)) {
        status.textContent = 'Подтверждение пока не найдено. Откройте ссылку из письма и попробуйте снова.';
        return;
      }
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      closeVerification();
      await syncSession(sessionData?.session || null);
      toast('Почта подтверждена. Добро пожаловать!');
    } catch (error) {
      status.textContent = `Не удалось проверить подтверждение: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  $('#btnLogin').addEventListener('click', () => showAuth('login'));
  $('#btnLogout').addEventListener('click', async () => {
    const { error } = await client.auth.signOut();
    if (error) toast(error.message, true);
  });
  $('#authClose').addEventListener('click', closeAuth);
  $('#verificationClose').addEventListener('click', closeVerification);
  $('#resendVerification').addEventListener('click', resendVerification);
  $('#checkVerification').addEventListener('click', checkVerification);
  $('#authModal').addEventListener('click', event => {
    if (event.target === $('#authModal')) closeAuth();
  });
  $('#verificationModal').addEventListener('click', event => {
    if (event.target === $('#verificationModal')) closeVerification();
  });
  $$('[data-open-auth]').forEach(button => button.addEventListener('click', () => showAuth(button.dataset.openAuth)));
  $$('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
  $$('.main-nav a').forEach(link => link.addEventListener('click', () => {
    $('#menuToggle').setAttribute('aria-expanded', 'false');
    $('#mainNav').classList.remove('is-open');
  }));
  $('#menuToggle').addEventListener('click', () => {
    const toggle = $('#menuToggle');
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    $('#mainNav').classList.toggle('is-open', !open);
  });

  $$('input[name="format"]').forEach(input => input.addEventListener('change', buildGuestOptions));
  [guestField, startField].forEach(field => field.addEventListener('change', updateSummary));
  durationField.addEventListener('change', buildStartOptions);
  dateField.addEventListener('change', loadAvailability);
  $('#bookingFilter').addEventListener('change', event => {
    $('#adminDate').hidden = event.target.value !== 'date';
    loadBookings();
  });
  $('#adminDate').addEventListener('change', loadBookings);
  dateField.min = today();
  startField.innerHTML = '<option value="">Сначала выберите дату</option>';
  buildGuestOptions();
  updatePrices();

  loadPublicData().catch(error => toast(error.message, true));
  loadPublicNews().catch(error => toast(error.message, true));
  client.auth.getSession().then(({ data, error }) => {
    if (error) toast(error.message, true);
    syncSession(data?.session || null);
  });
  client.auth.onAuthStateChange((_event, nextSession) => {
    setTimeout(() => syncSession(nextSession), 0);
  });
}
