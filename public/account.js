// Account module: session state, sign-in / profile dialog, profile photos and saved analysis.
// It owns the `user` object and broadcasts it to the other modules with `sab-user-state`.
import { faceLabels, bodyLabels } from './appearance-features.js';
import { $, esc, api, notify, blobToDataUrl } from './ui.js';

let user = null;
let pendingPhotos = null; // photos chosen before signing in; saved right after authentication
let registering = true;

const dialog = document.createElement('dialog');
dialog.id = 'account-dialog';
document.body.append(dialog);

const measurements = [
  ['heightCm', 'الطول', 80, 230],
  ['chestCm', 'محيط الصدر', 40, 250],
  ['waistCm', 'محيط الخصر', 40, 250],
  ['hipsCm', 'محيط الورك', 40, 250],
];

/** Publishes the current user to every module and refreshes the sidebar. */
function broadcast() {
  $('#profile-name').textContent = user ? `أهلاً، ${user.name}` : 'أهلاً بكِ';
  $('.avatar').textContent = user ? user.name[0] : '♡';
  $('#account-button').textContent = user ? 'حسابي وتفضيلاتي' : 'إنشاء حساب / دخول';
  window.dispatchEvent(new CustomEvent('sab-user-state', { detail: user }));
  window.dispatchEvent(
    new CustomEvent('sab-analysis-state', {
      detail: { analysis: user?.analysis || null, photoRevision: user?.photoRevision || null },
    }),
  );
}

const select = (id, label, options, value) =>
  `<label>${label}<select id="${id}">${Object.entries(options)
    .map(([key, name]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${esc(name)}</option>`)
    .join('')}</select></label>`;

function profileForm() {
  const p = user.profile;
  return `
    <fieldset class="segmented" id="profile-hijab">
      <legend>أسلوب الإطلالة</legend>
      <label><input type="radio" name="hijabStyle" value="hijab" ${p.hijabStyle === 'hijab' ? 'checked' : ''}><span>إطلالة بالحجاب</span></label>
      <label><input type="radio" name="hijabStyle" value="none" ${p.hijabStyle === 'hijab' ? '' : 'checked'}><span>دون حجاب</span></label>
    </fieldset>
    ${select('profile-modesty', 'تفضيل الملابس', { standard: 'حسب الاختيارات', modest: 'طويلة وواسعة ومحتشمة' }, p.modesty || 'standard')}
    <label>أسلوبك المفضل<input id="profile-style" maxlength="200" placeholder="كلاسيكي، بسيط…" value="${esc(p.style || '')}"></label>
    <label>الألوان المفضلة<input id="profile-colors" maxlength="200" placeholder="وردي، زيتوني…" value="${esc(p.favoriteColors || '')}"></label>
    <label>المقاس المعتاد (اختياري)<input id="profile-size" maxlength="200" placeholder="مثلاً M أو 40" value="${esc(p.size || '')}"></label>
    <details ${measurements.some(([key]) => p[key] != null) ? 'open' : ''}>
      <summary>قياسات اختيارية بالسنتيمتر</summary>
      <p>تدخلينها بنفسك لدعم الاقتراح؛ لا نستخرج قياسات من الصور.</p>
      <div class="form-grid">${measurements
        .map(
          ([key, label, min, max]) =>
            `<label>${label}<input id="profile-${key}" type="number" inputmode="decimal" step="0.1" min="${min}" max="${max}" value="${p[key] ?? ''}"></label>`,
        )
        .join('')}</div>
    </details>
    <details ${(p.faceShape && p.faceShape !== 'auto') || (p.bodyBalance && p.bodyBalance !== 'auto') ? 'open' : ''}>
      <summary>تصحيح تقدير السمات</summary>
      <p>إن لم يكن تقدير التحليل دقيقاً، اختاري الوصف الأقرب وسيُعتمد في الاقتراحات.</p>
      ${select('profile-faceShape', 'شكل الوجه', { auto: 'استخدمي تقدير التحليل', ...faceLabels }, p.faceShape || 'auto')}
      ${select('profile-bodyBalance', 'توازن الكتفين والوركين', { auto: 'استخدمي تقدير التحليل', ...bodyLabels }, p.bodyBalance || 'auto')}
    </details>`;
}

function signInForm() {
  const registerOnly = registering
    ? `<label>الاسم<input id="account-name" autocomplete="given-name" maxlength="60" required></label>`
    : '';
  const hijabQuestion = registering
    ? `<fieldset class="segmented"><legend>هل ترتدين الحجاب؟ <small>(يخصّص الخطوات والاقتراحات، ويمكن تغييره لاحقاً)</small></legend>
        <label><input type="radio" name="account-hijab" value="yes"><span>نعم، إطلالة بالحجاب</span></label>
        <label><input type="radio" name="account-hijab" value="no" checked><span>لا</span></label>
      </fieldset>`
    : '';
  return `${registerOnly}
    <label>البريد الإلكتروني<input id="account-email" type="email" autocomplete="email" maxlength="254" required></label>
    <label>كلمة المرور<input id="account-password" type="password" minlength="8" maxlength="128" autocomplete="${registering ? 'new-password' : 'current-password'}" required><small>8 أحرف على الأقل</small></label>
    ${hijabQuestion}`;
}

function render() {
  const title = user ? 'ملف إطلالتك' : registering ? 'إنشاء حسابك' : 'مرحباً بعودتك';
  const intro = user
    ? 'تفضيلاتك ترافق اقتراحات الإطلالة والمستشارة.'
    : 'حسابك يحفظ صورك ومناسباتك وخزانتك على هذا الجهاز.';
  dialog.innerHTML = `
    <button class="account-close close" aria-label="إغلاق">×</button>
    <span class="eyebrow">YOUR BEAUTY PROFILE</span>
    <h2>${title}</h2><p>${intro}</p>
    <form id="account-form">
      ${user ? profileForm() : signInForm()}
      <p id="account-message" role="alert"></p>
      <button class="primary" id="account-submit" type="submit">${user ? 'حفظ التفضيلات' : registering ? 'إنشاء الحساب والمتابعة' : 'تسجيل الدخول'}</button>
    </form>
    <button class="secondary account-switch">${user ? 'تسجيل الخروج' : registering ? 'لدي حساب بالفعل' : 'إنشاء حساب جديد'}</button>`;

  $('.account-close', dialog).onclick = () => dialog.close();
  $('.account-switch', dialog).onclick = user ? logout : () => ((registering = !registering), render());
  $('#account-form').onsubmit = submit;
  // Choosing the hijab implies the modest wardrobe preference; the user can still change it.
  $('#profile-hijab')?.addEventListener('change', (e) => {
    if (e.target.value === 'hijab') $('#profile-modesty').value = 'modest';
  });
}

async function submit(event) {
  event.preventDefault();
  const button = $('#account-submit');
  button.disabled = true;
  try {
    if (user) {
      const input = {
        hijabStyle: $('[name="hijabStyle"]:checked', dialog).value,
        modesty: $('#profile-modesty').value,
        faceShape: $('#profile-faceShape').value,
        bodyBalance: $('#profile-bodyBalance').value,
        style: $('#profile-style').value,
        favoriteColors: $('#profile-colors').value,
        size: $('#profile-size').value,
        ...Object.fromEntries(measurements.map(([key]) => [key, $('#profile-' + key).value])),
      };
      user = (await api('/api/profile', input)).user;
      broadcast();
      notify('تم حفظ تفضيلاتك.');
      dialog.close();
      return;
    }
    const input = { email: $('#account-email').value, password: $('#account-password').value };
    if (registering) {
      input.name = $('#account-name').value;
      input.hijab = $('[name="account-hijab"]:checked', dialog).value === 'yes';
    }
    user = (await api(registering ? '/api/register' : '/api/login', input)).user;
    broadcast();
    dialog.close();
    if (pendingPhotos) await savePhotos(pendingPhotos);
    else await restorePhotos();
    notify(
      user.hasFace && user.hasBody
        ? `أهلاً ${user.name}، صورك جاهزة.`
        : 'حسابك جاهز. أضيفي صورتَي الوجه والجسم من «ملفك» ثم احفظيهما.',
    );
  } catch (error) {
    if (dialog.open && $('#account-message')) $('#account-message').textContent = error.message;
    else notify(error.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function logout() {
  try {
    await api('/api/logout', {});
  } catch (error) {
    return notify(error.message);
  }
  user = null;
  pendingPhotos = null;
  dialog.close();
  broadcast();
  window.dispatchEvent(new CustomEvent('sab-account-cleared'));
  notify('تم تسجيل الخروج.');
}

function open() {
  render();
  if (!dialog.open) dialog.showModal();
}

/** Loads the saved profile photos back into the editor after sign-in or reload. */
async function restorePhotos() {
  const photos = {};
  for (const [key, flag] of [
    ['face', 'hasFace'],
    ['body', 'hasBody'],
  ]) {
    if (!user[flag]) continue;
    const response = await fetch('/api/photo/' + key);
    if (!response.ok) throw Error('تعذرت استعادة الصور المحفوظة.');
    photos[key] = await blobToDataUrl(await response.blob());
  }
  window.dispatchEvent(
    new CustomEvent('sab-account-photos', {
      detail: { ...photos, analysis: user.analysis, photoRevision: user.photoRevision },
    }),
  );
}

async function savePhotos(photos) {
  if (!user) {
    pendingPhotos = photos;
    notify('أنشئي حساباً أو سجّلي الدخول لحفظ الصورتين.');
    return open();
  }
  user = (await api('/api/photos', photos)).user;
  pendingPhotos = null;
  window.dispatchEvent(
    new CustomEvent('sab-photos-saved', { detail: { photoRevision: user.photoRevision } }),
  );
  broadcast();
  notify('حُفظت الصورتان في حسابك. نحلل السمات الآن…');
}

/** Saves the locally extracted pose check and appearance features, in that order. */
async function saveAnalysis({ photoRevision, result, features, silent }) {
  if (!user) return;
  try {
    if (result) user = (await api('/api/analysis', { photoRevision, result })).user;
    if (features) user = (await api('/api/features', { photoRevision, features })).user;
    broadcast();
    if (!silent) notify('تم تحديث تحليل السمات.');
    else notify('اكتمل تحليل السمات وأصبح جزءاً من اقتراحاتك.');
  } catch (error) {
    notify(error.message);
  }
}

window.addEventListener('sab-open-account', open);
window.addEventListener('sab-save-photos', (e) =>
  savePhotos(e.detail).catch((error) => notify(error.message)),
);
window.addEventListener('sab-save-analysis', (e) => saveAnalysis(e.detail));
window.addEventListener('sab-set-profile', async (e) => {
  if (!user) return open();
  try {
    user = (await api('/api/profile', e.detail)).user;
    broadcast();
    notify(
      user.profile.hijabStyle === 'hijab'
        ? 'تم التخصيص: ستظهر لفات الحجاب والإطلالات المحتشمة.'
        : 'تم التخصيص: ستظهر التسريحات وكل القطع.',
    );
  } catch (error) {
    notify(error.message);
  }
});
$('#account-button').onclick = open;

broadcast();
api('/api/me')
  .then(async ({ user: current }) => {
    user = current;
    broadcast();
    window.dispatchEvent(new CustomEvent('sab-session-ready', { detail: user }));
    if (user) await restorePhotos();
  })
  .catch((error) => {
    window.dispatchEvent(new CustomEvent('sab-session-ready', { detail: null }));
    notify(error.message);
  });
