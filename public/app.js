// Look editor: the five-step flow (profile → clothes → hair/hijab → makeup → final look).
// Talks to the other modules only through `sab-*` window events; see docs/ARCHITECTURE.md.
import { faceLabels, bodyLabels, verticalLabels, stylingBrief } from './appearance-features.js';
import {
  hairstyles,
  hairColors,
  hijabStyles,
  hijabColors,
  makeupPresets,
  makeupStrengths,
  garmentCategories,
  defaultLook,
  lookKeys,
  maxLookItems,
  wearsHijab,
  prefersModest,
  matchesSource,
} from './options.js';
import { $, $$, esc, toast, loadImage, fileToPngDataUrl, saveBlob } from './ui.js';

const state = {
  step: 0,
  ...defaultLook(),
  photo: null,
  bodyPhoto: null,
  analysis: null,
  photoRevision: null,
};
let profile = null; // saved profile of the signed-in user, or null
let userId = null;
let eventInfo = null;
let catalog = [];
let modestOnly = false;
let categoryFilter = 'all';
let loading = false;
let photosDirty = false; // photos picked in this session but not saved to the account yet
let photoVersion = 0; // bumped whenever a profile photo changes; keeps signatures cheap
let analysing = false;
let analysisMessage = '';
let poseCanvas = null;
const analysedRevisions = new Set();
let makeupPreviewWanted = false;
let hairPreviewWanted = false;
let previewEpoch = 0;
let lastLookJson = '';

// AI image generation state, per mode ("hair" doubles as the hijab try-on for hijab wearers).
let imageBusy = false;
let generationMessage = '';
const imageResults = { hair: null, outfit: null };
const consent = { hair: false, outfit: false };

const hijab = () => wearsHijab(profile);
const stepLabels = () => ['ملفك', 'الملابس', hijab() ? 'الحجاب' : 'الشعر', 'المكياج', 'إطلالتك'];
const byId = (list, id) => list.find((item) => item.id === id);
const colorValue = (list, name) => list.find((color) => color.name === name).value;
const lookData = () => Object.fromEntries(lookKeys.map((key) => [key, state[key]]));
const chosenItems = () => catalog.filter((item) => state.itemIds.includes(item.id));
const outfitNames = () =>
  chosenItems()
    .map((item) => item.name)
    .join('، ') || 'لم تختاري قطعاً بعد';
const headSummary = () =>
  hijab()
    ? `${byId(hijabStyles, state.hijabWrap).name} · ${state.hijabColor}`
    : `${byId(hairstyles, state.hair).name} · ${state.color}`;
const availableItems = () =>
  catalog.filter((item) => (!modestOnly || item.modest === true) && matchesSource(item, eventInfo?.source));

// ------------------------------------------------------------------ artwork

const hairPaths = {
  waves:
    'M48 38Q78 -8 112 32Q136 64 117 93Q139 122 119 155L95 152 94 76 62 76 62 151 36 155Q20 124 41 96Q24 63 48 38Z',
  back: 'M43 73Q27 9 80 8Q133 9 116 73L106 88 102 46Q78 30 58 48L54 87Z',
  braid: 'M48 70Q40 12 80 10Q125 12 115 76L109 129 92 168 80 155 93 127 94 77Z',
  ponytail:
    'M43 73Q27 9 80 8Q120 6 117 49Q151 47 140 108L124 151 112 142 122 97 108 72 102 46Q78 30 58 48L54 87Z',
  lowbun: 'M45 74Q30 12 79 10Q125 12 115 75L118 107Q131 129 106 138L89 126 97 86 96 47Q71 33 56 57Z',
  bob: 'M39 55Q35 8 80 9Q125 8 123 55L126 119Q108 133 95 119L98 63 62 59 65 120Q46 133 32 119Z',
  pixie: 'M43 70Q28 25 52 15L62 22 75 7 87 16 100 11Q130 23 116 71L105 57 96 42 73 49 58 61Z',
  curly:
    'M42 35Q22 21 24 53Q7 64 27 83Q4 109 28 125Q12 155 44 157L63 144 63 69 96 69 97 145Q121 171 140 145Q156 122 134 111Q154 89 135 73Q152 44 125 32Q113 4 89 17Q63 -1 42 35Z',
  halfup: 'M45 50Q33 11 80 9Q129 10 116 53L129 153 99 155 95 70 64 70 60 155 32 152Z',
  straight: 'M44 42Q45 9 80 8Q115 10 116 42L126 170 96 170 95 62 65 62 65 170 34 170Z',
};

function hairArt(id, color = '#3d2c25') {
  return `<svg viewBox="0 0 160 180" aria-hidden="true"><path d="M54 165 63 112H97L107 165" fill="#deb6a2"/><path d="M28 180Q25 143 62 146Q80 163 99 146Q137 146 136 180" fill="#6c5c62"/><path d="${hairPaths[id] || hairPaths.waves}" fill="${color}"/><ellipse cx="80" cy="77" rx="29" ry="40" fill="#e8c2ac"/><path d="M50 59Q47 23 80 22Q110 24 110 59Q89 51 78 37Q68 53 50 59" fill="${color}"/><path d="M61 77 68 76M91 76 98 77M74 98Q80 102 87 98" stroke="#9f7064" stroke-width="2" fill="none"/></svg>`;
}

// Each wrap: the fabric silhouette, plus fold lines that make the wrap recognisable.
const hijabShapes = {
  classic: {
    fabric: 'M80 18Q122 20 122 72Q122 108 140 180L20 180Q38 108 38 72Q38 20 80 18Z',
    folds: 'M52 118Q80 140 108 118M44 150Q80 168 116 150',
  },
  turkish: {
    fabric: 'M80 16Q124 18 120 72Q118 100 102 120L122 180 38 180 58 120Q42 100 40 72Q36 18 80 16Z',
    folds: 'M50 40Q80 26 110 40M62 122 80 150 98 122',
  },
  shayla: {
    fabric: 'M80 18Q122 20 122 72Q124 104 150 128L146 180 20 180Q38 108 38 72Q38 20 80 18Z',
    folds: 'M108 104Q132 128 124 178M96 118Q112 146 104 178M50 124Q70 140 92 126',
  },
  layered: {
    fabric: 'M80 16Q118 16 126 54Q146 74 130 104Q128 136 142 180L20 180Q38 108 38 72Q38 18 80 16Z',
    folds: 'M118 50Q134 74 122 100M110 44Q124 70 114 96M50 122Q80 142 112 120',
  },
  practical: {
    fabric: 'M80 22Q116 24 116 72Q116 104 104 124L118 180 42 180 56 124Q44 104 44 72Q44 24 80 22Z',
    folds: 'M60 128Q80 138 100 128',
  },
  khimar: {
    fabric: 'M80 16Q122 18 123 72Q126 112 158 180L2 180Q34 112 37 72Q38 18 80 16Z',
    folds: 'M40 132Q80 156 120 132M24 164Q80 184 136 164M80 122V176',
  },
  pinned: {
    fabric: 'M80 18Q122 20 122 72Q122 108 140 180L20 180Q38 108 38 72Q38 20 80 18Z',
    folds: 'M48 112Q84 108 116 78M46 132Q90 130 120 100',
    pin: [116, 78],
  },
  evening: {
    fabric: 'M80 14Q126 18 124 72Q126 106 146 180L14 180Q36 108 36 72Q34 18 80 14Z',
    folds: 'M48 36Q64 22 80 22M46 118Q80 150 114 118M38 146Q80 176 122 146M112 40Q120 60 118 84',
    gloss: true,
  },
};

function hijabArt(id, color = '#cdb293') {
  const shape = hijabShapes[id] || hijabShapes.classic;
  return `<svg viewBox="0 0 160 180" aria-hidden="true"><path d="M14 180Q16 146 62 146L98 146Q144 146 146 180Z" fill="#6c5c62"/><path d="${shape.fabric}" fill="${color}"/><path d="${shape.folds}" fill="none" stroke="#000" stroke-opacity=".16" stroke-width="2.5" stroke-linecap="round"/>${shape.gloss ? '<path d="M54 44Q62 28 78 24" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>' : ''}<ellipse cx="80" cy="76" rx="25" ry="33" fill="#e8c2ac"/><path d="M63 76 70 75M90 75 97 76M74 95Q80 99 86 95" stroke="#9f7064" stroke-width="2" fill="none"/>${shape.pin ? `<circle cx="${shape.pin[0]}" cy="${shape.pin[1]}" r="4" fill="#d9b25f" stroke="#fff" stroke-width="1"/>` : ''}</svg>`;
}

// ------------------------------------------------------------------ rendering

function render() {
  ++previewEpoch;
  const labels = stepLabels();
  $('#steps').innerHTML = labels
    .map(
      (label, i) =>
        `<li><button class="step ${i === state.step ? 'current' : i < state.step ? 'done' : ''}" data-step="${i}" ${i === state.step ? 'aria-current="step"' : ''}><b>${i < state.step ? '✓' : String(i + 1).padStart(2, '0')}</b>${label}</button></li>`,
    )
    .join('');
  $('#step-count').textContent = `الخطوة ${state.step + 1} من ${labels.length}`;
  $('#back').disabled = state.step === 0 || loading;
  $('#next').disabled = loading;
  $('#next').hidden = state.step === labels.length - 1;
  $('#content').innerHTML = [profileStep, clothesStep, headStep, makeupStep, reviewStep][state.step]();
  renderSummary();
  bindStep();
  announceLook();
  if (state.step === 3 && makeupPreviewWanted) runMakeupPreview();
  if (state.step === 2 && hairPreviewWanted && !hijab()) runHairPreview();
}

function renderSummary() {
  $('#portrait-preview').innerHTML = state.photo
    ? `<img src="${state.photo}" alt="صورتك المختارة">`
    : '<span>✧</span><p>هنا تبدأ الحكاية</p><small>أضيفي صورتك في الخطوة الأولى</small>';
  const rows = [
    ['الملابس', outfitNames()],
    hijab() ? ['الحجاب', headSummary()] : ['الشعر', headSummary()],
    ['المكياج', `${byId(makeupPresets, state.makeup).name} · ${state.strength}`],
  ];
  $('#summary-items').innerHTML = rows
    .map(([key, value]) => `<div class="summary-row"><span>${esc(key)}</span><b>${esc(value)}</b></div>`)
    .join('');
}

/** Tells the dashboard (auto-save) and chat about look changes, only when something really changed. */
function announceLook() {
  const json = JSON.stringify(lookData());
  if (json === lastLookJson) return;
  lastLookJson = json;
  window.dispatchEvent(new CustomEvent('sab-look-change', { detail: lookData() }));
}

// ------------------------------------------------------------------ step 1: profile

function hijabChoice() {
  if (!userId)
    return '<div class="hijab-choice"><strong>هل ترتدين الحجاب؟</strong><p>سجّلي الدخول لنخصّص الخطوات والاقتراحات: لفات حجاب بدل التسريحات، وإطلالات محتشمة.</p></div>';
  const option = (value, title, hint) =>
    `<button type="button" class="hijab-option ${hijab() === (value === 'hijab') ? 'selected' : ''}" data-hijab-choice="${value}" aria-pressed="${hijab() === (value === 'hijab')}"><span class="hijab-option-art">${value === 'hijab' ? hijabArt('classic', '#b98a96') : hairArt('waves')}</span><b>${title}</b><small>${hint}</small></button>`;
  return `<div class="hijab-choice"><strong>كيف تحبين أن تكون إطلالتك؟</strong><p>اختيارك يخصّص كل الخطوات: المحجبات يرين لفات الحجاب وإطلالات محتشمة، ويمكنك تغييره في أي وقت.</p><div class="hijab-options">${option('hijab', 'إطلالة بالحجاب', 'لفات حجاب وألوانه · ملابس محتشمة')}${option('none', 'إطلالة دون حجاب', 'تسريحات وألوان شعر · كل القطع')}</div></div>`;
}

function analysisView() {
  const analysis = state.analysis;
  const features = analysis?.features;
  if (analysing) return '<p class="analysis-note">نحلل معالم الوجه والجسم محلياً على جهازك…</p>';
  if (!analysis?.model && !features)
    return `<p class="analysis-note">${esc(analysisMessage || 'لم تُحلل الصور بعد. احفظي الصورتين ليبدأ التحليل تلقائياً.')}</p>`;
  const brief = stylingBrief(profile || {}, features || null);
  const bodyCheck = analysis?.model
    ? `<p>${analysis.fullBodyVisible ? '✓ معالم الجسم الأساسية ظاهرة' : '⚠ صورة الجسم تحتاج وضوحاً أكبر أو إظهار الجسم بالكامل'} · ${analysis.visibleLandmarks} من ${analysis.landmarkCount} معلماً · ${analysis.pose === 'upright' ? 'وقوف مستقيم واضح' : 'تعذر تأكيد الوقوف المستقيم'}</p>`
    : '<p>⚠ تعذر فحص صورة الجسم. استخدمي صورة أمامية كاملة يظهر فيها شخص واحد.</p>';
  const chip = (label, value, source) =>
    `<div class="feature-chip"><span>${label}</span><b>${esc(value)}</b>${source === 'user-reviewed' ? '<small>صححتِه يدوياً</small>' : source === 'image-estimate' ? '<small>تقدير من الصورة</small>' : ''}</div>`;
  const tips = brief.guidance.length
    ? `<div class="styling-tips"><strong>نصائح مبنية على سماتك</strong><ul>${brief.guidance.map((tip) => `<li>${esc(tip)}</li>`).join('')}</ul></div>`
    : '';
  return `<div class="analysis-results">${bodyCheck}<div class="feature-chips">${chip('شكل الوجه', faceLabels[brief.faceShape], brief.faceShapeSource)}${chip('الكتفان والوركان', bodyLabels[brief.bodyBalance], brief.bodyBalanceSource)}${chip('الجذع والساقان', verticalLabels[brief.verticalProportion], brief.verticalProportion === 'unknown' ? 'unknown' : 'image-estimate')}</div>${tips}<small>${esc(analysisMessage || 'تقديرات هندسية من معالم الصورة تُرسل كنص للمستشارة لتخصيص الاقتراحات. ليست قياسات ملابس، ويمكنك تصحيحها من «حسابي».')}</small></div>`;
}

function profileStep() {
  const uploads = [
    ['photo', 'صورة الوجه', 'photo-input'],
    ['bodyPhoto', 'صورة الجسم كاملة', 'body-input'],
  ]
    .map(
      ([key, label, id]) =>
        `<label class="upload compact">${state[key] ? `<img class="upload-thumb" src="${state[key]}" alt="${label} المختارة">` : '<span class="upload-icon">↑</span>'}<strong>${label}</strong><small>JPG أو PNG أو WEBP · حتى 10 ميغابايت</small><input id="${id}" type="file" accept="image/jpeg,image/png,image/webp" aria-label="رفع ${label}"></label>`,
    )
    .join('');
  const bothPhotos = state.photo && state.bodyPhoto;
  const saveLabel = photosDirty
    ? 'حفظ الصورتين في حسابي'
    : bothPhotos && state.photoRevision
      ? '✓ الصورتان محفوظتان'
      : 'حفظ الصورتين في حسابي';
  return `<h2>ملفك، وبداية تشبهك</h2><p class="description">اختاري أسلوب إطلالتك، ثم أضيفي صورة واضحة لوجهك وصورة أمامية كاملة لجسمك. تُحفظان في حسابك ويُحلَّلان محلياً على جهازك.</p>${hijabChoice()}<div class="photo-grid">${uploads}</div><button id="save-photos" class="${photosDirty ? 'primary' : 'secondary'}" ${!bothPhotos || !photosDirty || loading ? 'disabled' : ''}>${saveLabel}</button><div class="feature-status"><div class="feature-status-head"><strong>سمات الوجه والجسم</strong><button id="analyze-features" class="secondary" ${!bothPhotos || !state.photoRevision || photosDirty || analysing ? 'disabled' : ''}>${analysing ? 'جارٍ التحليل…' : 'إعادة التحليل'}</button></div>${analysisView()}</div><canvas id="body-canvas" class="body-canvas" aria-label="معالم وضعية الجسم" hidden></canvas>`;
}

// ------------------------------------------------------------------ step 2: clothes

function clothesStep() {
  const available = availableItems();
  const categories = [...new Set(available.map((item) => item.category))].filter((c) => garmentCategories[c]);
  if (categoryFilter !== 'all' && !categories.includes(categoryFilter)) categoryFilter = 'all';
  const visible = available.filter((item) => categoryFilter === 'all' || item.category === categoryFilter);
  const chips =
    categories.length > 1
      ? `<div class="filter-chips" role="group" aria-label="تصفية حسب النوع">${[['all', 'الكل'], ...categories.map((c) => [c, garmentCategories[c]])].map(([value, label]) => `<button type="button" class="chip ${categoryFilter === value ? 'selected' : ''}" data-category="${esc(value)}" aria-pressed="${categoryFilter === value}">${esc(label)}</button>`).join('')}</div>`
      : '';
  const cards = visible
    .map((item) => {
      const selected = state.itemIds.includes(item.id);
      return `<button class="choice ${selected ? 'selected' : ''}" data-outfit="${esc(item.id)}" aria-pressed="${selected}"><div class="art"><img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy">${item.modest ? '<span class="badge">محتشمة</span>' : ''}</div><span class="label">${esc(item.name)}</span><small>${esc(item.source === 'wardrobe' ? 'من خزانتي' : item.detail || 'الكتالوج العام')}</small></button>`;
    })
    .join('');
  const empty = available.length
    ? ''
    : `<p class="empty-note">${modestOnly ? 'لا توجد قطع موصوفة بالمحتشمة في المصدر المختار. أضيفي قطعك من «خزانتي» وعلّميها كمحتشمة، أو ألغي التصفية.' : 'لا توجد قطع في المصدر المختار. أضيفي ملابسك من «خزانتي» أو عدّلي مصدر الملابس في المناسبة.'}</p>`;
  return `<h2>${hijab() ? 'إطلالات تناسب حجابك' : 'نسّقي قطع إطلالتك'}</h2><p class="description">اختاري فستاناً أو قطعة علوية وسفلية، وأضيفي الحذاء والحقيبة والإكسسوارات المتاحة. القطع الخاصة تظهر أولاً.</p><label class="consent-row"><input type="checkbox" id="modest-only" ${modestOnly ? 'checked' : ''}> عرض القطع المحتشمة المناسبة للحجاب فقط</label>${chips}<div class="draft-tag">${state.itemIds.length} قطع مختارة · ${available.length} قطعة متاحة</div><div class="cards outfit-cards">${cards}</div>${empty}<div class="tip">${esc(outfitNames())}</div><p class="catalog-note">الكتالوج العام عينة تجريبية: صور من Fashionpedia وإطلالات محتشمة مولدة بالذكاء الاصطناعي ورسومات توضيحية، وليست منتجات للبيع. أضيفي صور ملابسك الحقيقية لدقة أعلى.</p>`;
}

// ------------------------------------------------------------------ step 3: hair or hijab

function faceTip() {
  const brief = stylingBrief(profile || {}, state.analysis?.features || null);
  return brief.faceShape !== 'unknown' && brief.guidance[0]
    ? `<div class="tip styling-tip">✦ ${esc(brief.guidance[0])}</div>`
    : '';
}

function swatches(colors, selected, attribute) {
  return `<div class="swatches">${colors.map((c) => `<button class="swatch ${selected === c.name ? 'selected' : ''}" style="--color:${c.value}" data-${attribute}="${c.name}" aria-label="${c.name}" title="${c.name}" aria-pressed="${selected === c.name}"></button>`).join('')}</div>`;
}

function headStep() {
  if (hijab()) {
    const color = colorValue(hijabColors, state.hijabColor);
    const cards = hijabStyles
      .map(
        (h) =>
          `<button class="choice ${state.hijabWrap === h.id ? 'selected' : ''}" data-hijab-wrap="${h.id}" aria-pressed="${state.hijabWrap === h.id}"><div class="art">${hijabArt(h.id, color)}</div><span class="label">${h.name}</span><small>${h.detail}</small></button>`,
      )
      .join('');
    return `<h2>اختاري لفة حجابك</h2><p class="description">اختاري اللفة ولونها، ثم جرّبيها على صورتك بمحرك الصور. الرسومات توضيحية لشكل اللفة.</p>${faceTip()}<div class="cards hair-cards">${cards}</div><span class="inline-label">لون الحجاب · ${esc(state.hijabColor)}</span>${swatches(hijabColors, state.hijabColor, 'hijab-color')}${generationPanel('hair')}`;
  }
  const cards = hairstyles
    .map(
      (h) =>
        `<button class="choice ${state.hair === h.id ? 'selected' : ''}" data-hair="${h.id}" aria-pressed="${state.hair === h.id}"><div class="art">${hairArt(h.id, colorValue(hairColors, state.color))}</div><span class="label">${h.name}</span></button>`,
    )
    .join('');
  return `<h2>اختاري تسريحة تشبهك</h2><p class="description">اختاري التسريحة ولونها، ثم جرّبي شكلها على صورتك بمحرك الصور، أو عايني اللون فقط محلياً.</p>${faceTip()}<div class="cards hair-cards">${cards}</div><span class="inline-label">لون الشعر · ${esc(state.color)}</span>${swatches(hairColors, state.color, 'color')}${generationPanel('hair')}<h3 class="subheading">معاينة محلية للون الشعر فقط</h3><div class="beauty-tools"><button id="try-hair" class="secondary">تطبيق اللون على صورتي</button><button id="download-hair" class="secondary" disabled>تنزيل المعاينة</button></div><p id="hair-status" role="status">تُجرى على جهازك دون إرسال الصورة، ولا تغيّر شكل التسريحة.</p><div id="hair-comparison" class="beauty-comparison" hidden><figure><figcaption>الصورة الأصلية</figcaption><img src="${state.photo}" alt="الشعر قبل التلوين"></figure><figure><figcaption>معاينة اللون</figcaption><canvas id="hair-canvas" aria-label="الشعر بعد معاينة اللون"></canvas></figure></div>`;
}

// ------------------------------------------------------------------ step 4: makeup

function makeupStep() {
  const presets = makeupPresets
    .map(
      (m) =>
        `<button class="choice ${state.makeup === m.id ? 'selected' : ''}" data-makeup="${m.id}" aria-pressed="${state.makeup === m.id}"><div class="makeup-art"><div class="palette">${m.colors.map((c) => `<i style="--color:${c}"></i>`).join('')}</div></div><span class="label">${m.name}</span></button>`,
    )
    .join('');
  const pickers = [
    ['lip', 'لون الشفاه'],
    ['eye', 'لون ظل العين'],
    ['blush', 'لون الخدود'],
  ]
    .map(
      ([key, label]) =>
        `<label>${label}<input type="color" data-makeup-color="${key}" value="${state[key]}" aria-label="${label}"></label>`,
    )
    .join('');
  const brief = stylingBrief(profile || {}, state.analysis?.features || null);
  const tip =
    brief.faceShape !== 'unknown' && brief.guidance[1]
      ? `<div class="tip styling-tip">✦ ${esc(brief.guidance[1])}</div>`
      : '';
  return `<h2>لمسة أخيرة من اللون</h2><p class="description">اختاري لوحة جاهزة أو خصّصي لون الشفاه وظل العين والخدود، ثم عايني النتيجة على صورتك محلياً.</p>${tip}<div class="cards">${presets}</div><div class="makeup-controls">${pickers}</div><label class="inline-label">قوة المكياج<select id="strength">${Object.keys(
    makeupStrengths,
  )
    .map((v) => `<option ${state.strength === v ? 'selected' : ''}>${v}</option>`)
    .join(
      '',
    )}</select></label><div class="beauty-tools"><button id="try-makeup" class="primary">جرّبي المكياج على صورتك</button><button id="download-makeup" class="secondary" disabled>تنزيل المعاينة</button></div><p id="makeup-status" role="status">المعاينة تقريبية وتتأثر بإضاءة الصورة ووضوح الوجه. تُجرى على جهازك.</p><div class="beauty-comparison"><figure><figcaption>الصورة الأصلية</figcaption><img src="${state.photo}" alt="الوجه قبل المكياج"></figure><figure><figcaption>معاينة المكياج</figcaption><canvas id="makeup-canvas" aria-label="الوجه بعد معاينة المكياج"></canvas></figure></div>`;
}

// ------------------------------------------------------------------ step 5: review

function reviewStep() {
  return `<h2>إطلالتك النهائية</h2>${generationPanel('outfit')}<div class="review"><div><strong>الملابس</strong>${esc(outfitNames())}</div><div><strong>${hijab() ? 'الحجاب' : 'الشعر'}</strong>${esc(headSummary())}</div><div><strong>المكياج</strong>${esc(byId(makeupPresets, state.makeup).name + ' · ' + state.strength)}</div></div><details class="reference-export"><summary>تنزيل ملخص الاختيارات</summary><p>لوحة مرجعية تجمع صورك الأصلية والقطع والألوان، وملف JSON بالتفاصيل. ليست صورة مولدة.</p><div class="beauty-tools"><button id="download" class="secondary">تنزيل لوحة الاختيارات PNG</button><button id="export-json" class="secondary">تنزيل التفاصيل JSON</button></div></details>`;
}

// ------------------------------------------------------------------ AI image generation

function imageSignature(mode) {
  const look = lookData();
  // The head try-on depends only on the head choices; the outfit depends on everything.
  const relevant =
    mode === 'hair' ? (hijab() ? [look.hijabWrap, look.hijabColor] : [look.hair, look.color]) : look;
  return JSON.stringify([userId, eventInfo?.id, photoVersion, hijab(), relevant]);
}

function generationPanel(mode) {
  const result = imageResults[mode];
  const current = result?.signature === imageSignature(mode);
  const title =
    mode === 'outfit' ? 'توليد صورة الإطلالة' : hijab() ? 'تجربة لفة الحجاب' : 'تجربة شكل التسريحة';
  const action =
    mode === 'outfit'
      ? 'ولّدي صورة الإطلالة'
      : hijab()
        ? 'جرّبي اللفة على صورتك'
        : 'جرّبي التسريحة على صورتك';
  const sent = mode === 'hair' ? 'صورة الوجه' : 'صورة الجسم والوجه وصور القطع المختارة';
  const output = result
    ? `<p class="result-note">${current ? '✓ آخر نتيجة لهذه الاختيارات' : 'نتيجة سابقة؛ تغيرت الاختيارات أو الصور. أعيدي التوليد لتطبيقها.'}</p><img class="generated-image" src="${result.url}" alt="نتيجة مولدة بالذكاء الاصطناعي"><p><a class="secondary button-link" href="${result.url}" download>تنزيل الصورة المولدة</a></p>`
    : '';
  return `<div class="feature-status generation-panel"><strong>${title}</strong><p>تُرسل ${sent} إلى Cloudflare لتعديلها بالذكاء الاصطناعي. قد تختلف الملامح وتفاصيل الملابس؛ راجعي النتيجة.</p><label class="consent-row"><input type="checkbox" id="image-consent" ${consent[mode] ? 'checked' : ''}> أوافق على إرسال هذه الصور إلى Cloudflare لهذه التجربة.</label><p><button id="generate-${mode}" class="primary" ${imageBusy ? 'disabled' : ''}>${imageBusy ? '<span class="spinner"></span> جارٍ التوليد…' : action}</button></p><p id="generation-status" role="status">${esc(generationMessage)}</p>${output}</div>`;
}

/** Downscales a reference to the 480px the image engine accepts. */
async function referenceImage(src) {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 480 / Math.max(image.width, image.height));
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** Lays the chosen garments out on one white 480px board, the third reference of an outfit request. */
async function garmentBoard(items) {
  if (!items.length) throw Error('اختاري قطع الملابس أولاً.');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 480;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 480, 480);
  const columns = items.length === 1 ? 1 : items.length <= 4 ? 2 : 3;
  const rows = Math.ceil(items.length / columns);
  const cellWidth = 480 / columns;
  const cellHeight = 480 / rows;
  const images = await Promise.all(items.map((item) => loadImage(item.image)));
  images.forEach((image, i) => {
    const scale = Math.min((cellWidth - 8) / image.width, (cellHeight - 8) / image.height);
    context.drawImage(
      image,
      (i % columns) * cellWidth + (cellWidth - image.width * scale) / 2,
      Math.floor(i / columns) * cellHeight + (cellHeight - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
  });
  return canvas.toDataURL('image/png');
}

async function runGeneration(mode) {
  if (imageBusy) return;
  if (!consent[mode]) return toast('وافقي على إرسال الصور إلى Cloudflare أولاً.');
  if (!state.photo || (mode === 'outfit' && !state.bodyPhoto)) return toast('أضيفي صور الملف أولاً.');
  if (mode === 'outfit' && !state.itemIds.length) return toast('اختاري قطع الملابس أولاً من خطوة «الملابس».');
  const signature = imageSignature(mode);
  const requestUser = userId;
  const eventId = eventInfo?.id || null;
  const look = structuredClone(lookData());
  const { photo: face, bodyPhoto: body } = state;
  const items = chosenItems();
  imageBusy = true;
  generationMessage = 'جارٍ تجهيز الصور وتوليد النتيجة… قد تستغرق العملية دقيقتين.';
  render();
  try {
    const images =
      mode === 'hair'
        ? [await referenceImage(face)]
        : await Promise.all([referenceImage(body), referenceImage(face), garmentBoard(items)]);
    const response = await fetch('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, consent: true, eventId, images, ...look }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'تعذر التوليد.');
    if (requestUser !== userId) return;
    if (signature === imageSignature(mode)) {
      imageResults[mode] = { url: data.url, signature };
      generationMessage = 'الصورة جاهزة ومحفوظة في حسابك.';
    } else {
      generationMessage = 'اكتمل توليد الاختيارات السابقة وحُفظ في حسابك. أعيدي التوليد للاختيارات الحالية.';
      imageResults[mode] = { url: data.url, signature };
    }
    toast(generationMessage);
  } catch (e) {
    if (requestUser === userId) {
      generationMessage = e.message;
      toast(e.message);
    }
  } finally {
    imageBusy = false;
    render();
  }
}

// ------------------------------------------------------------------ bindings

function setLook(changes) {
  Object.assign(state, changes);
  render();
}

function bindStep() {
  $$('[data-step]').forEach((button) => (button.onclick = () => go(Number(button.dataset.step))));

  // Profile
  $$('[data-hijab-choice]').forEach(
    (button) =>
      (button.onclick = () => {
        const wantsHijab = button.dataset.hijabChoice === 'hijab';
        if (wantsHijab === hijab()) return;
        window.dispatchEvent(
          new CustomEvent('sab-set-profile', {
            detail: wantsHijab ? { hijabStyle: 'hijab', modesty: 'modest' } : { hijabStyle: 'none' },
          }),
        );
      }),
  );
  $('#photo-input')?.addEventListener('change', (e) => loadUpload(e, 'photo'));
  $('#body-input')?.addEventListener('change', (e) => loadUpload(e, 'bodyPhoto'));
  $('#save-photos')?.addEventListener('click', () => {
    if (!state.photo || !state.bodyPhoto) return toast('أضيفي صورة الوجه وصورة الجسم أولاً.');
    window.dispatchEvent(
      new CustomEvent('sab-save-photos', { detail: { face: state.photo, body: state.bodyPhoto } }),
    );
  });
  $('#analyze-features')?.addEventListener('click', () => runAnalysis(true));
  const bodyCanvas = $('#body-canvas');
  if (bodyCanvas && poseCanvas) {
    bodyCanvas.hidden = false;
    bodyCanvas.width = poseCanvas.width;
    bodyCanvas.height = poseCanvas.height;
    bodyCanvas.getContext('2d').drawImage(poseCanvas, 0, 0);
  }

  // Clothes
  $('#modest-only')?.addEventListener('change', (e) => {
    modestOnly = e.target.checked;
    render();
  });
  $$('[data-category]').forEach(
    (button) =>
      (button.onclick = () => {
        categoryFilter = button.dataset.category;
        render();
      }),
  );
  $$('[data-outfit]').forEach(
    (button) =>
      (button.onclick = () => {
        toggleOutfit(button.dataset.outfit);
        render();
      }),
  );

  // Hair / hijab
  $$('[data-hair]').forEach((button) => (button.onclick = () => setLook({ hair: button.dataset.hair })));
  $$('[data-color]').forEach((button) => (button.onclick = () => setLook({ color: button.dataset.color })));
  $$('[data-hijab-wrap]').forEach(
    (button) => (button.onclick = () => setLook({ hijabWrap: button.dataset.hijabWrap })),
  );
  $$('[data-hijab-color]').forEach(
    (button) => (button.onclick = () => setLook({ hijabColor: button.dataset.hijabColor })),
  );
  $('#try-hair')?.addEventListener('click', () => {
    hairPreviewWanted = true;
    runHairPreview();
  });
  $('#download-hair')?.addEventListener('click', () =>
    $('#hair-canvas').toBlob((blob) => blob && saveBlob(blob, 'smart-ai-beauty-hair.png'), 'image/png'),
  );

  // Makeup
  $$('[data-makeup]').forEach(
    (button) =>
      (button.onclick = () => {
        const [blush, eye, lip] = byId(makeupPresets, button.dataset.makeup).colors;
        setLook({ makeup: button.dataset.makeup, blush, eye, lip });
      }),
  );
  $$('[data-makeup-color]').forEach(
    (input) => (input.onchange = () => setLook({ [input.dataset.makeupColor]: input.value })),
  );
  $('#strength')?.addEventListener('change', (e) => setLook({ strength: e.target.value }));
  $('#try-makeup')?.addEventListener('click', () => {
    makeupPreviewWanted = true;
    runMakeupPreview();
  });
  $('#download-makeup')?.addEventListener('click', () =>
    $('#makeup-canvas').toBlob((blob) => blob && saveBlob(blob, 'smart-ai-beauty-makeup.png'), 'image/png'),
  );

  // Generation and export
  const mode = state.step === 4 ? 'outfit' : 'hair';
  $('#image-consent')?.addEventListener('change', (e) => (consent[mode] = e.target.checked));
  $('#generate-hair')?.addEventListener('click', () => runGeneration('hair'));
  $('#generate-outfit')?.addEventListener('click', () => runGeneration('outfit'));
  $('#download')?.addEventListener('click', downloadBoard);
  $('#export-json')?.addEventListener('click', exportJson);
}

function go(step) {
  if (loading) return;
  if (step > 0 && (!state.photo || !state.bodyPhoto))
    return toast('أضيفي صورة الوجه وصورة الجسم أولاً لنبدأ الإطلالة.');
  state.step = step;
  render();
  $('.panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Adds or removes a garment, replacing whatever it conflicts with (a dress replaces top and bottom…). */
function toggleOutfit(id) {
  const item = byId(catalog, id);
  if (!item) return;
  if (state.itemIds.includes(id)) {
    state.itemIds = state.itemIds.filter((value) => value !== id);
    return;
  }
  const separates = ['shirt, blouse', 'pants', 'skirt'];
  const bottoms = ['pants', 'skirt'];
  const conflicts = (other) =>
    other.category === item.category ||
    (item.category === 'dress' && separates.includes(other.category)) ||
    (separates.includes(item.category) && other.category === 'dress') ||
    (bottoms.includes(item.category) && bottoms.includes(other.category));
  state.itemIds = state.itemIds.filter((value) => !conflicts(byId(catalog, value) || {}));
  if (state.itemIds.length >= maxLookItems) return toast(`اختاري حتى ${maxLookItems} قطع للإطلالة.`);
  state.itemIds.push(id);
}

async function loadUpload(event, key) {
  const file = event.target.files[0];
  if (!file) return;
  loading = true;
  $('#next').disabled = true;
  try {
    state[key] = await fileToPngDataUrl(file);
    state.analysis = null;
    state.photoRevision = null;
    poseCanvas = null;
    analysisMessage = '';
    photosDirty = true;
    photoVersion++;
    makeupPreviewWanted = hairPreviewWanted = false;
    toast(
      state.photo && state.bodyPhoto
        ? 'تمت إضافة الصورة. احفظي الصورتين ليبدأ تحليل السمات.'
        : 'تمت إضافة الصورة.',
    );
  } catch (e) {
    toast(e.message);
    event.target.value = '';
  } finally {
    loading = false;
    render();
  }
}

// ------------------------------------------------------------------ local analysis (MediaPipe, in the browser)

/**
 * Extracts pose and face/body features on the device and asks the account module to save them.
 * Runs automatically once per saved photo pair, and on demand from the "re-analyse" button.
 */
async function runAnalysis(manual = false) {
  if (analysing || !state.photo || !state.bodyPhoto || !state.photoRevision || photosDirty) return;
  const { photo: face, bodyPhoto: body, photoRevision: revision } = state;
  analysedRevisions.add(revision);
  analysing = true;
  analysisMessage = '';
  if (state.step === 0) render();
  let result = null;
  let faceResult = { shape: 'unknown', lengthToWidth: null, jawToCheek: null, foreheadToJaw: null };
  let bodyResult = { balance: 'unknown', vertical: 'unknown', shoulderToHip: null, legToTorso: null };
  const problems = [];
  try {
    try {
      const { analyzeBody } = await import('./body-analysis.js');
      const analysed = await analyzeBody(body);
      result = analysed.summary;
      bodyResult = analysed.summary.appearance;
      poseCanvas = analysed.canvas;
    } catch (e) {
      problems.push(/الجسم|أشخاص/.test(e.message) ? e.message : 'تعذر فحص صورة الجسم.');
    }
    try {
      const { analyzeFaceFeatures } = await import('./beauty.js');
      faceResult = await analyzeFaceFeatures(face);
    } catch (e) {
      problems.push(/وجه|وجوه/.test(e.message) ? e.message : 'تعذر تحليل صورة الوجه.');
    }
    if (face !== state.photo || body !== state.bodyPhoto || revision !== state.photoRevision) return;
    analysisMessage = problems.join(' ');
    window.dispatchEvent(
      new CustomEvent('sab-save-analysis', {
        detail: {
          photoRevision: revision,
          result,
          features: { version: 1, face: faceResult, body: bodyResult },
          silent: !manual,
        },
      }),
    );
  } finally {
    analysing = false;
    if (state.step === 0) render();
  }
}

function maybeAutoAnalyse() {
  const done = state.analysis?.features && state.analysis?.model;
  if (!done && state.photoRevision && !photosDirty && !analysedRevisions.has(state.photoRevision))
    runAnalysis();
}

async function runMakeupPreview() {
  const epoch = previewEpoch;
  const button = $('#try-makeup');
  const status = $('#makeup-status');
  if (!button || !state.photo) return;
  button.disabled = true;
  status.textContent = 'نحضّر معاينة المكياج على جهازك…';
  try {
    const { applyMakeup } = await import('./beauty.js');
    const result = await applyMakeup(state.photo, {
      lip: state.lip,
      eye: state.eye,
      blush: state.blush,
      strength: state.strength,
    });
    if (epoch !== previewEpoch) return;
    const canvas = $('#makeup-canvas');
    canvas.width = result.canvas.width;
    canvas.height = result.canvas.height;
    canvas.getContext('2d').drawImage(result.canvas, 0, 0);
    status.textContent = 'المعاينة جاهزة. غيّري الألوان أو القوة لمقارنتها.';
    $('#download-makeup').disabled = false;
  } catch (e) {
    if (epoch === previewEpoch)
      status.textContent = /وجه|وجوه/.test(e.message)
        ? e.message
        : 'تعذر تجهيز معاينة الوجه. أعيدي المحاولة أو اختاري صورة أوضح.';
  } finally {
    if (epoch === previewEpoch) button.disabled = false;
  }
}

async function runHairPreview() {
  const epoch = previewEpoch;
  const button = $('#try-hair');
  const status = $('#hair-status');
  if (!button || !state.photo) return;
  button.disabled = true;
  status.textContent = 'نحضّر معاينة لون الشعر على جهازك…';
  try {
    const { recolorHair } = await import('./beauty.js');
    const result = await recolorHair(state.photo, colorValue(hairColors, state.color));
    if (epoch !== previewEpoch) return;
    $('#hair-comparison').hidden = false;
    const canvas = $('#hair-canvas');
    canvas.width = result.canvas.width;
    canvas.height = result.canvas.height;
    canvas.getContext('2d').drawImage(result.canvas, 0, 0);
    status.textContent = 'معاينة اللون جاهزة. شكل التسريحة لم يتغيّر.';
    $('#download-hair').disabled = false;
  } catch (e) {
    if (epoch === previewEpoch)
      status.textContent = /وجه|وجوه|شعر/.test(e.message)
        ? e.message
        : 'تعذر تجهيز معاينة الشعر. أعيدي المحاولة أو اختاري صورة أوضح.';
  } finally {
    if (epoch === previewEpoch) button.disabled = false;
  }
}

// ------------------------------------------------------------------ exports

function exportJson() {
  const data = {
    version: 2,
    createdAt: new Date().toISOString(),
    occasion: eventInfo
      ? { id: eventInfo.id, type: eventInfo.type, date: eventInfo.date, location: eventInfo.location.name }
      : null,
    garments: chosenItems().map((item) => ({ id: item.id, name: item.name, category: item.category })),
    head: hijab()
      ? { type: 'hijab', wrap: byId(hijabStyles, state.hijabWrap).name, color: state.hijabColor }
      : { type: 'hair', style: byId(hairstyles, state.hair).name, color: state.color },
    makeup: {
      preset: byId(makeupPresets, state.makeup).name,
      lip: state.lip,
      eye: state.eye,
      blush: state.blush,
      strength: state.strength,
    },
    outputType: 'selection-summary',
  };
  saveBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    'smart-ai-beauty-look.json',
  );
  toast('تم تنزيل تفاصيل الإطلالة.');
}

async function downloadBoard() {
  const button = $('#download');
  button.disabled = true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1700;
    const x = canvas.getContext('2d');
    const text = (value, size, right, top, color = '#753750') => {
      x.fillStyle = color;
      x.font = `${size}px Tahoma`;
      x.fillText(value, right, top);
    };
    const contain = (image, left, top, width, height) => {
      const scale = Math.min(width / image.width, height / image.height);
      x.drawImage(
        image,
        left + (width - image.width * scale) / 2,
        top + (height - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
    };
    x.fillStyle = '#fcf8f4';
    x.fillRect(0, 0, canvas.width, canvas.height);
    x.direction = 'rtl';
    x.textAlign = 'right';
    text('لوحة اختيارات · ' + (eventInfo?.type || 'إطلالتي'), 38, 1120, 90);
    if (eventInfo) text(`${eventInfo.date} · ${eventInfo.location.name}`, 22, 1120, 140);
    text('الصورة الأصلية أدناه لم تُعدّل · الملابس والاختيارات مرجعية', 21, 1120, 180);
    x.fillStyle = '#f0e5e6';
    x.fillRect(70, 200, 590, 950);
    if (state.bodyPhoto || state.photo)
      contain(await loadImage(state.bodyPhoto || state.photo), 70, 200, 590, 950);
    const items = chosenItems();
    const images = await Promise.all(items.map((item) => loadImage(item.image)));
    items.forEach((item, i) => {
      const left = 710 + (i % 2) * 220;
      const top = 200 + Math.floor(i / 2) * 270;
      x.fillStyle = '#f0e5e6';
      x.fillRect(left, top, 200, 210);
      contain(images[i], left + 10, top + 10, 180, 190);
      text(item.name.slice(0, 28), 17, left + 200, top + 240);
    });
    text((hijab() ? 'الحجاب: ' : 'التسريحة: ') + headSummary(), 26, 1120, 1300);
    text(`المكياج: ${byId(makeupPresets, state.makeup).name} · ${state.strength}`, 26, 1120, 1360);
    [state.lip, state.eye, state.blush].forEach((color, i) => {
      x.fillStyle = color;
      x.beginPath();
      x.arc(1090 - i * 80, 1430, 27, 0, Math.PI * 2);
      x.fill();
    });
    text('لوحة اختيارات مرجعية · ليست صورة مولدة بملابس مطبّقة', 21, 1120, 1600, '#957c88');
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw Error();
    saveBlob(blob, 'smart-ai-beauty-board.png');
    toast('تم تنزيل لوحة الاختيارات المرجعية.');
  } catch {
    toast('تعذر تنزيل اللوحة. تحققي من صور القطع وحاولي مجدداً.');
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------------ events from the other modules

$('#next').onclick = () => go(Math.min(stepLabels().length - 1, state.step + 1));
$('#back').onclick = () => go(Math.max(0, state.step - 1));

window.addEventListener('sab-notify', (e) => toast(e.detail));

window.addEventListener('sab-user-state', (e) => {
  const user = e.detail;
  const nextId = user?.id || null;
  const wasHijab = hijab();
  profile = user?.profile || null;
  if (nextId !== userId) {
    userId = nextId;
    modestOnly = prefersModest(profile);
    imageResults.hair = imageResults.outfit = null;
    consent.hair = consent.outfit = false;
    generationMessage = '';
  } else if (wasHijab !== hijab()) {
    // Switching the hijab preference re-targets the catalogue filter and invalidates head try-ons.
    modestOnly = prefersModest(profile);
    imageResults.hair = null;
  }
  render();
});

const savedAnalysis = (analysis) => (analysis?.model || analysis?.features ? analysis : null);

window.addEventListener('sab-photos-saved', (e) => {
  photosDirty = false;
  state.photoRevision = e.detail.photoRevision;
  state.analysis = null;
});

window.addEventListener('sab-analysis-state', (e) => {
  // While unsaved photos are on screen, the account's saved analysis does not describe them.
  if (photosDirty) return;
  state.analysis = savedAnalysis(e.detail.analysis);
  state.photoRevision = e.detail.photoRevision || null;
  if (state.step === 0) render();
  maybeAutoAnalyse();
});

window.addEventListener('sab-account-photos', (e) => {
  makeupPreviewWanted = hairPreviewWanted = false;
  state.photo = e.detail.face || null;
  state.bodyPhoto = e.detail.body || null;
  state.analysis = savedAnalysis(e.detail.analysis);
  state.photoRevision = e.detail.photoRevision || null;
  photosDirty = false;
  photoVersion++;
  poseCanvas = null;
  if (!eventInfo) state.step = 0;
  else if (state.step === 0 && state.photo && state.bodyPhoto) state.step = 1;
  render();
  maybeAutoAnalyse();
});

window.addEventListener('sab-account-cleared', () => {
  eventInfo = null;
  catalog = [];
  profile = null;
  poseCanvas = null;
  photosDirty = false;
  analysisMessage = '';
  Object.assign(state, defaultLook(), {
    step: 0,
    photo: null,
    bodyPhoto: null,
    analysis: null,
    photoRevision: null,
  });
  render();
});

window.addEventListener('sab-catalog', (e) => {
  catalog = e.detail;
  state.itemIds = state.itemIds.filter((id) => byId(catalog, id));
  render();
});

window.addEventListener('sab-start-event', async (e) => {
  eventInfo = e.detail.event;
  catalog = e.detail.items;
  Object.assign(state, defaultLook(), eventInfo.look || {});
  state.itemIds = state.itemIds.filter((id) => {
    const item = byId(catalog, id);
    return item && matchesSource(item, eventInfo.source);
  });
  categoryFilter = 'all';
  state.step = state.photo && state.bodyPhoto ? 1 : 0;
  imageResults.hair = imageResults.outfit = null;
  generationMessage = '';
  lastLookJson = JSON.stringify(lookData()); // opening an occasion is not a change to save
  render();
  if (state.step === 0) toast('أكملي صورتَي الملف قبل متابعة معاينات الإطلالة.');

  // Restore the latest generated images of this occasion.
  const eventId = eventInfo.id;
  const requestUser = userId;
  try {
    const response = await fetch('/api/images?eventId=' + encodeURIComponent(eventId));
    if (!response.ok) return;
    const { images } = await response.json();
    if (eventInfo?.id !== eventId || userId !== requestUser) return;
    for (const mode of ['hair', 'outfit']) {
      const item = images.find((image) => image.mode === mode);
      if (item && !imageResults[mode]) imageResults[mode] = { url: item.url, signature: null };
    }
    render();
  } catch {
    // The gallery is a convenience; the editor works without it.
  }
});

window.addEventListener('sab-apply-outfit', (e) => {
  state.itemIds = [];
  e.detail.forEach(toggleOutfit);
  state.step = state.photo && state.bodyPhoto ? 1 : 0;
  render();
});

window.addEventListener('sab-edit-profile', () => {
  eventInfo = null;
  state.step = 0;
  render();
});

render();
