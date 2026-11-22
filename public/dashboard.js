// Dashboard module: occasions list, occasion form, wardrobe, and the occasion banner above the look editor.
import { occasionTypes, garmentCategories, wearsHijab } from './options.js';
import { $, $$, esc, api, notify, fileToPngDataUrl } from './ui.js';

let user = null;
let sessionReady = false;
let events = [];
let items = [];
let active = null; // the occasion open in the editor
let page = 'dashboard'; // dashboard | wardrobe | event | editor
let refreshEpoch = 0;
let formSerial = 0;
let recommending = false;

// Auto-save of the look being edited.
let currentLook = null;
let savedLookJson = '';
let saveTimer = null;
let saveState = ''; // '' | saving | saved | error

const host = document.createElement('section');
host.id = 'dashboard-root';
$('main').insertBefore(host, $('.intro'));
const banner = document.createElement('section');
banner.id = 'event-context';
$('#steps').before(banner);

const settingLabels = { indoor: 'مكان داخلي', outdoor: 'مكان خارجي', mixed: 'داخلي وخارجي' };
const sourceLabels = { all: 'خزانتي والكتالوج', wardrobe: 'من خزانتي', catalog: 'من الكتالوج' };

function localDate(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function countdown(date) {
  const days = Math.round((Date.parse(date) - Date.parse(localDate())) / 86400000);
  if (days < 0) return { text: 'انتهت', past: true };
  if (days === 0) return { text: 'اليوم' };
  if (days === 1) return { text: 'غداً' };
  if (days === 2) return { text: 'بعد يومين' };
  return { text: days <= 10 ? `بعد ${days} أيام` : `بعد ${days} يوماً` };
}

function weatherText(weather) {
  if (weather?.status !== 'available') return esc(weather?.message || 'لم يتم جلب الطقس بعد.');
  const rain = weather.rainProbability == null ? 'غير متاح' : esc(weather.rainProbability) + '%';
  return `الحرارة <bdi dir="ltr">${esc(Math.round(weather.min))}–${esc(Math.round(weather.max))}°C</bdi> · احتمال المطر <bdi>${rain}</bdi> · الرياح <bdi>${esc(weather.wind == null ? 'غير متاحة' : Math.round(weather.wind))}</bdi> كم/س`;
}

function show(mode) {
  page = mode;
  host.hidden = mode === 'editor';
  $('.intro').hidden = true;
  $('#steps').hidden = mode !== 'editor';
  $('.workspace').hidden = mode !== 'editor';
  banner.hidden = mode !== 'editor' || !active;
  $('.breadcrumb').textContent =
    mode === 'dashboard'
      ? 'لوحة التحكم'
      : mode === 'wardrobe'
        ? 'خزانتي'
        : mode === 'event'
          ? 'إنشاء / تعديل مناسبة'
          : active
            ? `مناسباتي / ${active.type}`
            : 'ملفي وصوري';
  const activeNav =
    mode === 'wardrobe'
      ? '#wardrobe-nav'
      : mode === 'event'
        ? '#new-look'
        : mode === 'editor' && !active
          ? '#photos-nav'
          : '#home';
  $$('nav .nav').forEach((button) => button.classList.toggle('active', button.matches(activeNav)));
  window.scrollTo({ top: 0 });
}

function needAccount() {
  if (user) return true;
  window.dispatchEvent(new CustomEvent('sab-open-account'));
  return false;
}

/** Leaves the occasion editor, saving any pending look first. */
function leaveEvent() {
  flushLook();
  if (active) window.dispatchEvent(new CustomEvent('sab-leave-event'));
  active = null;
  currentLook = null;
}

async function refresh() {
  const token = ++refreshEpoch;
  try {
    if (!user) {
      events = [];
      items = [];
    } else {
      const [eventData, catalogData] = await Promise.all([api('/api/events'), api('/api/catalog')]);
      if (token !== refreshEpoch) return;
      events = eventData.events;
      items = catalogData.items;
      window.dispatchEvent(new CustomEvent('sab-catalog', { detail: items }));
    }
  } catch (e) {
    notify(e.message);
  }
  if (page === 'wardrobe') wardrobe();
  else if (page === 'dashboard') dashboard();
}

// ------------------------------------------------------------------ dashboard

function eventCard(event) {
  const when = countdown(event.date);
  const pieces = event.look?.itemIds.length;
  return `<article class="event-card ${when.past ? 'past' : ''}">
    <div class="event-card-top"><span class="event-kind">${esc(event.type)}</span><span class="event-countdown">${when.text}</span></div>
    <h3>${esc(event.location.name)}</h3>
    <p><bdi dir="ltr">${esc(event.date)}</bdi> · ${settingLabels[event.setting]}</p>
    <p class="weather-line">${weatherText(event.weather)}</p>
    <small>${pieces ? `إطلالة محفوظة · ${pieces} ${pieces > 2 && pieces < 11 ? 'قطع' : 'قطعة'}` : event.recommendations?.length ? 'اقتراح جاهز بانتظار اعتمادك' : 'جاهزة لتنسيق إطلالتك'}</small>
    <div class="event-actions">
      <button class="primary" data-open-event="${event.id}">فتح المناسبة</button>
      <button class="secondary" data-edit-event="${event.id}">تعديل</button>
      <button class="icon-button danger" data-delete-event="${event.id}" aria-label="حذف مناسبة ${esc(event.type)}" title="حذف المناسبة">🗑</button>
    </div>
  </article>`;
}

function dashboard() {
  show('dashboard');
  const owned = items.filter((item) => item.source === 'wardrobe').length;
  const profileReady = user?.hasFace && user?.hasBody;
  const body = !sessionReady
    ? '<div class="empty-state"><span class="spinner"></span><p>نحضّر مساحتك…</p></div>'
    : !user
      ? '<div class="empty-state"><h3>مساحتك تبدأ بحسابك</h3><p>سجّلي الدخول لحفظ المناسبات وصورك وملابسك الخاصة.</p><button class="primary" id="dash-login">إنشاء حساب / دخول</button></div>'
      : !events.length
        ? `<div class="empty-state"><h3>ما المناسبة القادمة؟</h3><p>تخرج، زواج، مقابلة عمل أو يوم بسيط. ${profileReady ? 'أنشئي مناسبتك الأولى لنقترح إطلالة لها.' : 'ابدئي بإضافة صورتيك من «ملفي وصوري» ثم أنشئي مناسبتك الأولى.'}</p></div>`
        : `<div class="event-grid">${events.map(eventCard).join('')}</div>`;
  host.innerHTML = `
    <div class="dash-heading"><div><span class="eyebrow">YOUR OCCASIONS</span><h1>${user ? 'أهلاً، ' + esc(user.name) : 'إطلالة لكل مناسبة'}</h1><p>ابدئي بمناسبتك وموقعها، ودعينا ننسّق التفاصيل معك${wearsHijab(user?.profile) ? ' بما يناسب حجابك' : ''}.</p></div><button class="primary" id="create-event">＋ إنشاء مناسبة جديدة</button></div>
    <div class="story-rail" aria-label="وصول سريع">
      <button class="story-shortcut" id="story-event"><i>＋</i><strong>مناسبة جديدة</strong></button>
      <button class="story-shortcut" id="story-chat"><i>✦</i><strong>مستشارتي</strong></button>
      <button class="story-shortcut" id="story-wardrobe"><i>♧</i><strong>خزانتي</strong></button>
      <button class="story-shortcut" id="story-photos"><i>♡</i><strong>ملفي وصوري</strong></button>
    </div>
    <div class="dash-stats">
      <article><b>${events.length}</b><span>مناسبة محفوظة</span></article>
      <article><b>${owned}</b><span>قطعة في خزانتي</span></article>
      <article><b>${profileReady ? '✓' : '＋'}</b><button id="setup-photos">${profileReady ? 'ملفي وسماتي' : 'أضيفي صورتيك'}</button></article>
    </div>
    <div class="dash-section-title"><h2>مناسباتي</h2><button class="secondary" id="open-wardrobe">إدارة خزانتي</button></div>
    ${body}`;

  const createEvent = () => needAccount() && eventForm();
  const openWardrobe = () => needAccount() && wardrobe();
  $('#create-event').onclick = $('#story-event').onclick = createEvent;
  $('#open-wardrobe').onclick = $('#story-wardrobe').onclick = openWardrobe;
  $('#setup-photos').onclick = $('#story-photos').onclick = photos;
  $('#story-chat').onclick = () => $('#consult').click();
  $('#dash-login')?.addEventListener('click', needAccount);
  const find = (id) => events.find((event) => event.id === id);
  $$('[data-open-event]', host).forEach((b) => (b.onclick = () => openEvent(find(b.dataset.openEvent))));
  $$('[data-edit-event]', host).forEach((b) => (b.onclick = () => eventForm(find(b.dataset.editEvent))));
  $$('[data-delete-event]', host).forEach(
    (b) => (b.onclick = () => deleteEvent(find(b.dataset.deleteEvent), b)),
  );
}

async function deleteEvent(event, button) {
  if (
    !confirm(
      `حذف مناسبة «${event.type} · ${event.location.name}» مع إطلالتها وصورها المولدة؟ لا يمكن التراجع.`,
    )
  )
    return;
  button.disabled = true;
  try {
    await api('/api/events/' + event.id, null, 'DELETE');
    events = events.filter((e) => e.id !== event.id);
    notify('حُذفت المناسبة.');
    if (page === 'dashboard') dashboard();
  } catch (e) {
    notify(e.message);
    button.disabled = false;
  }
}

function photos() {
  if (!needAccount()) return;
  leaveEvent();
  show('editor');
  window.dispatchEvent(new CustomEvent('sab-edit-profile'));
}

// ------------------------------------------------------------------ occasion form

function eventForm(existing) {
  leaveEvent();
  const formId = ++formSerial;
  show('event');
  let location = existing?.location || null;
  let candidates = [];
  let lookupEpoch = 0;
  let weatherEpoch = 0;
  const current = () => page === 'event' && formId === formSerial;

  host.innerHTML = `
    <div class="dash-heading"><div><span class="eyebrow">A NEW MOMENT</span><h1>${existing ? 'تعديل المناسبة' : 'لنبدأ بمناسبتك'}</h1><p>اختاري المناسبة والمدينة والتاريخ ليصل اقتراح الإطلالة إلى تفاصيل يومك.</p></div><button class="secondary" id="cancel-event">العودة للوحة التحكم</button></div>
    <form class="event-form panel" id="occasion-form">
      <div class="form-grid">
        <label>نوع المناسبة<select id="event-type">${occasionTypes.map((type) => `<option ${existing?.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
        <label>تاريخ المناسبة<input id="event-date" type="date" value="${esc(existing?.date || localDate())}" ${existing ? '' : `min="${localDate()}"`} required></label>
      </div>
      <label>موقع المناسبة · المدينة<input id="event-location" maxlength="100" autocomplete="off" placeholder="مثلاً دمشق أو Damascus" value="${esc(location?.name || '')}" required></label>
      <p id="location-status" role="status">${location ? '✓ الموقع محدد: ' + esc(location.name) : 'اكتبي اسم المدينة واختاريها من النتائج لتحديد الطقس بدقة.'}</p>
      <div id="location-results" class="location-results"></div>
      <div class="weather-card" id="event-weather" role="status">${weatherText(existing?.weather)}</div>
      <small class="weather-credit">المدينة والطقس من <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. يُرسل اسم المدينة وإحداثياتها لجلب التوقع، دون صورك. المواعيد الأبعد من 16 يوماً لا يتوفر لها توقع بعد.</small>
      <div class="form-grid">
        <label>مكان المناسبة<select id="event-setting">${Object.entries(settingLabels)
          .map(([value, label]) => `<option value="${value}">${label}</option>`)
          .join('')}</select></label>
        <label>اختيار الملابس من<select id="event-source"><option value="all">خزانتي والكتالوج العام</option><option value="wardrobe">خزانتي فقط</option><option value="catalog">الكتالوج العام فقط</option></select></label>
      </div>
      <label>الستايل المرغوب<input id="event-style" maxlength="200" placeholder="كلاسيكي، محتشم، بسيط…" value="${esc(existing?.style ?? user?.profile?.style ?? '')}"></label>
      <label>تفاصيل تحبين مراعاتها<textarea id="event-preference" maxlength="1000" placeholder="ألوانك، الراحة، طول القطعة، طبيعة الحفل…">${esc(existing?.preference || '')}</textarea></label>
      <p id="event-error" role="alert"></p>
      <button class="primary" id="save-event" type="submit">${existing ? 'حفظ التعديلات وفتح المناسبة' : 'إنشاء المناسبة واقتراح إطلالة'}</button>
    </form>`;
  $('#event-setting').value = existing?.setting || 'indoor';
  $('#event-source').value = existing?.source || 'all';
  $('#cancel-event').onclick = dashboard;

  const loadWeather = async () => {
    const token = ++weatherEpoch;
    if (!location) return;
    $('#event-weather').textContent = 'نحضّر توقع الطقس لتاريخ مناسبتك…';
    try {
      const query = new URLSearchParams({
        latitude: location.latitude,
        longitude: location.longitude,
        date: $('#event-date').value,
      });
      const data = await api('/api/weather?' + query);
      if (current() && token === weatherEpoch) $('#event-weather').innerHTML = weatherText(data.weather);
    } catch (e) {
      if (current() && token === weatherEpoch) $('#event-weather').textContent = e.message;
    }
  };

  const search = async () => {
    const token = ++lookupEpoch;
    const query = $('#event-location').value.trim();
    if (query.length < 2) return;
    $('#location-status').textContent = 'نبحث عن المدينة…';
    try {
      const data = await api('/api/locations?q=' + encodeURIComponent(query));
      if (!current() || token !== lookupEpoch) return;
      candidates = data.locations;
      $('#location-status').textContent = candidates.length
        ? 'اختاري موقع المناسبة:'
        : 'لم نجد هذه المدينة. جرّبي الاسم بالإنجليزية أو مدينة قريبة.';
      $('#location-results').innerHTML = candidates
        .map(
          (c, i) =>
            `<button type="button" class="location-option" data-location="${i}">${esc(c.name)}</button>`,
        )
        .join('');
      $$('[data-location]').forEach(
        (button) =>
          (button.onclick = () => {
            location = candidates[Number(button.dataset.location)];
            ++lookupEpoch;
            $('#event-location').value = location.name;
            $('#location-results').replaceChildren();
            $('#location-status').textContent = '✓ الموقع محدد: ' + location.name;
            loadWeather();
          }),
      );
    } catch (e) {
      if (current() && token === lookupEpoch) $('#location-status').textContent = e.message;
    }
  };

  let typingTimer;
  $('#event-location').oninput = () => {
    location = null;
    ++lookupEpoch;
    ++weatherEpoch;
    $('#event-weather').textContent = 'اختاري موقعاً من نتائج البحث لتحديث الطقس.';
    $('#location-results').replaceChildren();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => current() && search(), 450);
  };
  $('#event-date').onchange = loadWeather;

  $('#occasion-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!location) {
      $('#event-error').textContent = 'اختاري المدينة من نتائج البحث أولاً.';
      $('#event-location').focus();
      return;
    }
    const button = $('#save-event');
    button.disabled = true;
    $('#event-error').textContent = 'نحفظ المناسبة ونحضّر الطقس…';
    try {
      const input = {
        type: $('#event-type').value,
        date: $('#event-date').value,
        location,
        setting: $('#event-setting').value,
        source: $('#event-source').value,
        style: $('#event-style').value,
        preference: $('#event-preference').value,
      };
      const { event } = await api('/api/events' + (existing ? '/' + existing.id : ''), input);
      events = [event, ...events.filter((x) => x.id !== event.id)];
      if (!current()) return;
      openEvent(event);
      // A recommendation that is still valid for the edited occasion is kept by the server.
      if (!event.recommendations?.length && !event.advice) recommend();
    } catch (error) {
      if (current()) {
        $('#event-error').textContent = error.message;
        button.disabled = false;
      } else notify(error.message);
    }
  };
}

// ------------------------------------------------------------------ occasion banner (above the editor)

function saveLabel() {
  return saveState === 'saving'
    ? 'جارٍ حفظ الإطلالة…'
    : saveState === 'saved'
      ? '✓ إطلالتك محفوظة تلقائياً'
      : saveState === 'error'
        ? '⚠ تعذر الحفظ؛ سنحاول عند التعديل التالي'
        : 'تُحفظ اختياراتك تلقائياً';
}

function eventBanner() {
  if (!active) return (banner.innerHTML = '');
  const suggestions = (active.recommendations || [])
    .map((r) => {
      const item = items.find((i) => i.id === r.itemId);
      return item
        ? `<article><img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy"><b>${esc(item.name)}</b><p>${esc(r.reason)}</p></article>`
        : '';
    })
    .join('');
  banner.innerHTML = `
    <div class="occasion-banner">
      <div><span class="eyebrow"><bdi dir="ltr">${esc(active.date)}</bdi> · ${countdown(active.date).text}</span><h2>${esc(active.type)} · ${esc(active.location.name)}</h2><p>${weatherText(active.weather)}</p><small>الستايل: ${esc(active.style || 'وفق تفضيلاتي')} · ${sourceLabels[active.source]} · ${settingLabels[active.setting]}</small></div>
      <div class="occasion-actions">
        <button class="primary" id="recommend-event" ${recommending ? 'disabled' : ''}>${recommending ? '<span class="spinner"></span> ننسّق اقتراحك…' : active.advice ? 'اقتراح جديد' : 'اقتراح إطلالة للمناسبة'}</button>
        <button class="secondary" id="edit-active">تعديل المناسبة</button>
        <button class="secondary" id="refresh-weather">تحديث الطقس</button>
        <span class="save-indicator ${saveState}" id="save-indicator" role="status">${saveLabel()}</span>
      </div>
    </div>
    <div id="event-advice" role="status">${active.advice ? `<p class="advice-text">${esc(active.advice)}</p>` : ''}${suggestions ? `<div class="outfit-suggestions">${suggestions}</div><button class="secondary" id="apply-outfit">اعتماد القطع المقترحة وتعديلها</button>` : ''}</div>`;

  $('#edit-active').onclick = () => eventForm(active);
  $('#recommend-event').onclick = recommend;
  $('#refresh-weather').onclick = async () => {
    const { id } = active;
    const button = $('#refresh-weather');
    button.disabled = true;
    try {
      const { event } = await api(`/api/events/${id}/weather`, {});
      if (active?.id !== id) return;
      active = event;
      events = events.map((e) => (e.id === id ? event : e));
      eventBanner();
      notify('تم تحديث الطقس.');
    } catch (e) {
      notify(e.message);
      if (button.isConnected) button.disabled = false;
    }
  };
  $('#apply-outfit')?.addEventListener('click', () => {
    window.dispatchEvent(
      new CustomEvent('sab-apply-outfit', { detail: active.recommendations.map((r) => r.itemId) }),
    );
    notify('تم اعتماد القطع. يمكنك تعديلها وإكمال باقي الخطوات.');
  });
}

function openEvent(event) {
  flushLook();
  active = structuredClone(event);
  currentLook = null;
  savedLookJson = '';
  saveState = '';
  show('editor');
  window.dispatchEvent(new CustomEvent('sab-start-event', { detail: { event: active, items } }));
  eventBanner();
}

async function recommend() {
  if (!active || recommending) return;
  const { id } = active;
  recommending = true;
  eventBanner();
  try {
    const { event } = await api(`/api/events/${id}/recommend`, {});
    events = [event, ...events.filter((e) => e.id !== id)];
    if (active?.id === id) {
      active = { ...event, look: active.look };
      notify('اقتراح مناسبتك جاهز. اعتمدي القطع أو عدّليها كما تحبين.');
    }
  } catch (e) {
    notify(e.message);
  } finally {
    recommending = false;
    if (page === 'editor' && active) eventBanner();
  }
}

// ------------------------------------------------------------------ look auto-save

async function saveLook(id, look) {
  const json = JSON.stringify(look);
  const setState = (value) => {
    if (active?.id !== id) return;
    saveState = value;
    const indicator = $('#save-indicator');
    if (indicator) {
      indicator.className = 'save-indicator ' + value;
      indicator.textContent = saveLabel();
    }
  };
  setState('saving');
  try {
    const { event } = await api(`/api/events/${id}/look`, look);
    events = events.map((e) => (e.id === id ? event : e));
    if (active?.id === id) {
      active.look = event.look;
      savedLookJson = json;
    }
    setState('saved');
  } catch (e) {
    setState('error');
    notify(e.message);
  }
}

function flushLook() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (active && currentLook && JSON.stringify(currentLook) !== savedLookJson)
    saveLook(active.id, currentLook);
}

window.addEventListener('sab-look-change', (e) => {
  if (!active) return;
  currentLook = e.detail;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushLook, 900);
});
window.addEventListener('pagehide', flushLook);

// ------------------------------------------------------------------ wardrobe

function wardrobe() {
  leaveEvent();
  show('wardrobe');
  const owned = items.filter((item) => item.source === 'wardrobe');
  const hijab = wearsHijab(user?.profile);
  host.innerHTML = `
    <div class="dash-heading"><div><span class="eyebrow">YOUR WARDROBE</span><h1>قطعك، بأسلوبك</h1><p>أضيفي ملابسك مرة واحدة لترافق اقتراحات مناسباتك. صورها خاصة بحسابك.</p></div><button class="secondary" id="wardrobe-back">العودة للوحة التحكم</button></div>
    <form class="panel wardrobe-form" id="wardrobe-form">
      <h2>إضافة قطعة لخزانتي</h2>
      <div class="form-grid">
        <label>صورة القطعة<input id="wardrobe-image" type="file" accept="image/jpeg,image/png,image/webp" required><img id="wardrobe-preview" alt="معاينة قطعة الخزانة" hidden></label>
        <div>
          <label>اسم القطعة<input id="wardrobe-name" maxlength="100" placeholder="بليزر أسود، حذاء بيج…" required></label>
          <label>نوع القطعة<select id="wardrobe-category">${Object.entries(garmentCategories)
            .map(([key, label]) => `<option value="${key}">${label}</option>`)
            .join('')}</select></label>
          <label>اللون<input id="wardrobe-color" maxlength="60" placeholder="أسود، بيج، متعدد الألوان…" required></label>
        </div>
      </div>
      <label class="consent-row"><input id="wardrobe-modest" type="checkbox" ${hijab ? 'checked' : ''}> قطعة محتشمة تناسب الحجاب (طويلة، واسعة، غير شفافة)</label>
      <fieldset><legend>مناسبات تناسبها (اختياري)</legend><div class="occasion-tags">${occasionTypes.map((type) => `<label><input type="checkbox" name="wardrobe-occasion" value="${type}">${type}</label>`).join('')}</div></fieldset>
      <p class="form-help">الاقتراحات تعتمد على وصفك ونوع القطعة، فاكتبي اسماً ولوناً دقيقين.</p>
      <p id="wardrobe-error" role="alert"></p>
      <button class="primary" id="save-wardrobe">حفظ القطعة في خزانتي</button>
    </form>
    <div class="dash-section-title"><h2>خزانتي · ${owned.length} من 50 قطعة</h2></div>
    ${
      owned.length
        ? `<div class="wardrobe-grid">${owned
            .map(
              (item) =>
                `<article class="wardrobe-card"><img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy"><h3>${esc(item.name)}</h3><p>${esc(garmentCategories[item.category] || item.category)} · ${esc(item.colorName)}${item.modest ? ' · محتشمة' : ''}</p><small>${esc(item.occasions.join('، ') || 'لكل المناسبات حسب التنسيق')}</small><button class="icon-button danger" data-delete-item="${esc(item.id)}" aria-label="حذف ${esc(item.name)}" title="حذف القطعة">🗑</button></article>`,
            )
            .join('')}</div>`
        : '<div class="empty-state"><h3>خزانتك جاهزة لأول قطعة</h3><p>أضيفيها لتظهر إلى جانب الكتالوج عند تنسيق المناسبة.</p></div>'
    }`;
  $('#wardrobe-back').onclick = dashboard;

  let image = null;
  let uploadEpoch = 0;
  $('#wardrobe-image').onchange = async (e) => {
    const token = ++uploadEpoch;
    image = null;
    $('#wardrobe-preview').hidden = true;
    const file = e.target.files[0];
    if (!file) return;
    $('#save-wardrobe').disabled = true;
    try {
      const data = await fileToPngDataUrl(file);
      if (page !== 'wardrobe' || token !== uploadEpoch) return;
      image = data;
      $('#wardrobe-preview').src = image;
      $('#wardrobe-preview').hidden = false;
      $('#wardrobe-error').textContent = '';
    } catch (error) {
      if (page === 'wardrobe' && token === uploadEpoch) $('#wardrobe-error').textContent = error.message;
    } finally {
      if (page === 'wardrobe' && token === uploadEpoch) $('#save-wardrobe').disabled = false;
    }
  };

  $('#wardrobe-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!image) return ($('#wardrobe-error').textContent = 'أضيفي صورة صالحة وانتظري ظهور معاينتها.');
    const button = $('#save-wardrobe');
    button.disabled = true;
    try {
      const { item } = await api('/api/wardrobe', {
        modest: $('#wardrobe-modest').checked,
        name: $('#wardrobe-name').value,
        category: $('#wardrobe-category').value,
        color: $('#wardrobe-color').value,
        occasions: $$('[name="wardrobe-occasion"]:checked').map((input) => input.value),
        image,
      });
      items = [item, ...items];
      window.dispatchEvent(new CustomEvent('sab-catalog', { detail: items }));
      notify('حُفظت القطعة في خزانتك الخاصة.');
      if (page === 'wardrobe') wardrobe();
    } catch (error) {
      if (page === 'wardrobe') {
        $('#wardrobe-error').textContent = error.message;
        button.disabled = false;
      }
    }
  };

  $$('[data-delete-item]', host).forEach(
    (button) =>
      (button.onclick = async () => {
        const item = items.find((i) => i.id === button.dataset.deleteItem);
        if (!confirm(`حذف «${item.name}» من خزانتك؟ ستُزال أيضاً من الإطلالات المحفوظة.`)) return;
        button.disabled = true;
        try {
          await api('/api/wardrobe/' + item.id, null, 'DELETE');
          notify('حُذفت القطعة.');
          await refresh();
        } catch (error) {
          notify(error.message);
          button.disabled = false;
        }
      }),
  );
}

// ------------------------------------------------------------------ navigation and session

$('#home').onclick = () => {
  leaveEvent();
  dashboard();
};
$('#new-look').onclick = () => needAccount() && eventForm();
$('#wardrobe-nav').onclick = () => needAccount() && wardrobe();
$('#photos-nav').onclick = photos;

window.addEventListener('sab-session-ready', () => {
  sessionReady = true;
  if (page === 'dashboard') dashboard();
});
window.addEventListener('sab-user-state', (e) => {
  const changed = user?.id !== e.detail?.id;
  user = e.detail;
  if (changed) {
    active = null;
    currentLook = null;
    if (page === 'editor') page = 'dashboard';
    refresh();
  } else if (page === 'dashboard') dashboard();
});
window.addEventListener('sab-account-cleared', () => {
  ++refreshEpoch;
  active = null;
  currentLook = null;
  user = null;
  events = [];
  items = [];
  dashboard();
});

dashboard();
