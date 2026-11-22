// Approximate, image-space appearance features and the styling brief derived from them.
// Shared by the browser (extraction + display) and the server (validation + AI context).
// These are ratios between landmarks in a photo: never garment sizes, weight or medical observations.

export const faceLabels = {
  unknown: 'غير محسوم',
  oval: 'بيضاوي تقريباً',
  round: 'مستدير تقريباً',
  elongated: 'طويل تقريباً',
  angular: 'فك زاوي تقريباً',
};

export const bodyLabels = {
  unknown: 'غير محسوم',
  balanced: 'الكتفان والوركان متقاربان بصرياً',
  shoulders: 'الكتفان أعرض بصرياً',
  hips: 'الوركان أعرض بصرياً',
};

export const verticalLabels = {
  unknown: 'غير محسوم',
  balanced: 'تناسب متوازن بين الجذع والساقين',
  'long-legs': 'الساقان أطول بصرياً',
  'long-torso': 'الجذع أطول بصرياً',
};

const round2 = (value) => +value.toFixed(2);
const ratioOrNull = (value) => (Number.isFinite(value) && value >= 0.1 && value <= 4 ? round2(value) : null);

/** Face geometry from the 478 MediaPipe Face Landmarker points. */
export function faceFeatures(points, width, height) {
  const distance = (a, b) =>
    Math.hypot((points[a].x - points[b].x) * width, (points[a].y - points[b].y) * height);
  const faceWidth = distance(234, 454);
  const faceLength = distance(10, 152);
  if (!faceWidth || !faceLength) throw Error('معالم الوجه غير كافية.');

  const eyeTilt = (Math.abs(points[33].y - points[263].y) * height) / faceWidth;
  const noseOffset = (Math.abs(points[1].x - (points[234].x + points[454].x) / 2) * width) / faceWidth;
  if (eyeTilt > 0.16 || noseOffset > 0.15)
    return {
      shape: 'unknown',
      quality: 'غير مناسب للتصنيف: استخدمي صورة أمامية مستقيمة.',
      lengthToWidth: null,
      jawToCheek: null,
      foreheadToJaw: null,
    };

  const lengthToWidth = faceLength / faceWidth;
  const jawWidth = distance(172, 397);
  const jawToCheek = jawWidth / faceWidth;
  const shape =
    lengthToWidth > 1.55
      ? 'elongated'
      : jawToCheek > 0.86
        ? 'angular'
        : lengthToWidth < 1.23
          ? 'round'
          : 'oval';
  return {
    shape,
    quality: 'تقدير هندسي أولي من الصورة؛ قابل للتصحيح وليس تصنيفاً مؤكداً.',
    lengthToWidth: round2(lengthToWidth),
    jawToCheek: round2(jawToCheek),
    foreheadToJaw: jawWidth ? ratioOrNull(distance(54, 284) / jawWidth) : null,
  };
}

/** Body proportions from the 33 MediaPipe Pose landmarks of an upright, fully visible body. */
export function bodyFeatures(points, width, height, summary) {
  const unknown = {
    balance: 'unknown',
    vertical: 'unknown',
    shoulderToHip: null,
    legToTorso: null,
    quality: 'تحتاج صورة أمامية كاملة، مستقيمة وواضحة؛ الملابس والوضعية تؤثر في التقدير.',
  };
  if (!summary.fullBodyVisible || summary.pose !== 'upright') return unknown;

  const distance = (a, b) =>
    Math.hypot((points[a].x - points[b].x) * width, (points[a].y - points[b].y) * height);
  const shoulder = distance(11, 12);
  const hip = distance(23, 24);
  const tilted = (a, b, span) => (Math.abs(points[a].y - points[b].y) * height) / span > 0.18;
  if (!hip || !shoulder || tilted(11, 12, shoulder) || tilted(23, 24, hip)) return unknown;
  const shoulderToHip = shoulder / hip;
  if (shoulderToHip < 0.5 || shoulderToHip > 2.5) return unknown;

  const midY = (a, b) => ((points[a].y + points[b].y) / 2) * height;
  const torso = midY(23, 24) - midY(11, 12);
  const legs = midY(27, 28) - midY(23, 24);
  const legToTorso = torso > 0 && legs > 0 ? ratioOrNull(legs / torso) : null;
  const vertical =
    legToTorso === null || legToTorso < 0.9 || legToTorso > 2.6
      ? 'unknown'
      : legToTorso > 1.75
        ? 'long-legs'
        : legToTorso < 1.45
          ? 'long-torso'
          : 'balanced';

  return {
    balance: shoulderToHip > 1.15 ? 'shoulders' : shoulderToHip < 0.9 ? 'hips' : 'balanced',
    vertical,
    shoulderToHip: round2(shoulderToHip),
    legToTorso: vertical === 'unknown' ? null : legToTorso,
    quality: 'نسب معالم الكتفين والوركين والساقين في الصورة، وليست محيطاً أو مقاساً أو تصنيفاً للخصر.',
  };
}

/** Server-side validation of client-extracted features. Throws on anything outside the contract. */
export function validateFeatures(value) {
  if (!value || value.version !== 1) throw Error('بيانات السمات غير صالحة.');
  const { face, body } = value;
  if (!face || !Object.hasOwn(faceLabels, face.shape) || !body || !Object.hasOwn(bodyLabels, body.balance))
    throw Error('تصنيف غير صالح.');
  const vertical = body.vertical ?? 'unknown';
  if (!Object.hasOwn(verticalLabels, vertical)) throw Error('تصنيف غير صالح.');
  const number = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.1 || v > 4) throw Error('نسبة غير صالحة.');
    return Math.round(v * 100) / 100;
  };
  return {
    version: 1,
    face: {
      shape: face.shape,
      lengthToWidth: number(face.lengthToWidth),
      jawToCheek: number(face.jawToCheek),
      foreheadToJaw: number(face.foreheadToJaw),
    },
    body: {
      balance: body.balance,
      vertical,
      shoulderToHip: number(body.shoulderToHip),
      legToTorso: number(body.legToTorso),
    },
    confidence: 'approximate-image-geometry',
  };
}

const faceGuidance = {
  oval: {
    hair: 'الوجه البيضاوي يتقبل معظم التسريحات؛ اختاري ما يناسب المناسبة دون حجم يخفي ملامحه.',
    hijab: 'الوجه البيضاوي يتقبل معظم لفات الحجاب؛ إطار ناعم حول الوجه يبرز توازنه.',
    makeup: 'خدود خفيفة على أعلى الوجنتين تكفي لإبراز التوازن الطبيعي.',
  },
  round: {
    hair: 'للوجه المستدير: طول إضافي وحجم بسيط أعلى الرأس وخصل طولية بجانب الوجه، مع تجنب الحجم العريض عند الخدين.',
    hijab:
      'للوجه المستدير: لفة بارتفاع بسيط عند التاج وإطار بيضاوي مرتخٍ حول الوجه مع انسدال طولي للقماش، وتجنب الشد الدائري الضيق.',
    makeup: 'خدود مائلة نحو الصدغ وتحديد خفيف تحت الوجنة يعطيان امتداداً طولياً.',
  },
  elongated: {
    hair: 'للوجه الطويل: حجم جانبي وتموجات أو غرة ناعمة تقصر الطول بصرياً، مع تجنب الارتفاع الزائد أعلى الرأس.',
    hijab:
      'للوجه الطويل: لفة بحجم جانبي وطيات عرضية تغطي جزءاً من الجبهة، مع تجنب الارتفاع الزائد عند التاج.',
    makeup: 'خدود أفقية على تفاحة الخد تضيف عرضاً متوازناً.',
  },
  angular: {
    hair: 'للفك الزاوي: تموجات ناعمة وطبقات تنسدل حول الفك لتليين الخطوط.',
    hijab:
      'للفك الزاوي: أقمشة ناعمة منسدلة مثل الشيفون أو الجيرسي بطيات مرتخية حول الفك، وتجنب الإطار الحاد المشدود.',
    makeup: 'خدود دائرية ناعمة وألوان مدمجة جيداً تليّن زوايا الوجه.',
  },
};

const balanceGuidance = {
  shoulders:
    'الكتفان أعرض بصرياً: قصات A-line وتنانير أو بناطيل واسعة تضيف حجماً للجزء السفلي، وخطوط طولية أو ياقة V في الأعلى، وتجنب الأكتاف المبطنة.',
  hips: 'الوركان أعرض بصرياً: تفاصيل أو لون أفتح أو طبقة منظمة في الجزء العلوي، مع قطع سفلية منسدلة بلون أغمق.',
  balanced: 'الكتفان والوركان متقاربان: قصة مستقيمة أو تحديد خفيف للخصر يحافظ على التوازن.',
};

const verticalGuidance = {
  'long-legs': 'الساقان أطول بصرياً: قطعة علوية أطول قليلاً أو خصر متوسط يوازن النسب.',
  'long-torso': 'الجذع أطول بصرياً: خصر مرتفع وحذاء بلون القطعة السفلية يطيلان الساقين بصرياً.',
  balanced: null,
};

/**
 * Turns saved features and the user's manual corrections into a compact, deterministic styling brief.
 * The brief is shown to the user and sent to the language model so its advice follows reviewed rules
 * instead of improvising from raw numbers.
 */
export function stylingBrief(profile = {}, features = null) {
  const hijab = profile.hijabStyle === 'hijab';
  const reviewedFace = profile.faceShape && profile.faceShape !== 'auto' ? profile.faceShape : null;
  const reviewedBody = profile.bodyBalance && profile.bodyBalance !== 'auto' ? profile.bodyBalance : null;
  const faceShape = reviewedFace || features?.face?.shape || 'unknown';
  const bodyBalance = reviewedBody || features?.body?.balance || 'unknown';
  const vertical = features?.body?.vertical || 'unknown';

  const guidance = [];
  const face = faceGuidance[faceShape];
  if (face) guidance.push(hijab ? face.hijab : face.hair, face.makeup);
  if (balanceGuidance[bodyBalance]) guidance.push(balanceGuidance[bodyBalance]);
  if (verticalGuidance[vertical]) guidance.push(verticalGuidance[vertical]);
  if (hijab)
    guidance.push('الإطلالة بالحجاب: قطع طويلة واسعة غير شفافة بأكمام طويلة، ولون الحجاب منسق مع الإطلالة.');
  else if (profile.modesty === 'modest') guidance.push('تفضيل الاحتشام: قطع طويلة وواسعة بأكمام طويلة.');

  return {
    wearsHijab: hijab,
    faceShape,
    faceShapeLabel: faceLabels[faceShape],
    faceShapeSource: reviewedFace ? 'user-reviewed' : faceShape === 'unknown' ? 'unknown' : 'image-estimate',
    bodyBalance,
    bodyBalanceLabel: bodyLabels[bodyBalance],
    bodyBalanceSource: reviewedBody
      ? 'user-reviewed'
      : bodyBalance === 'unknown'
        ? 'unknown'
        : 'image-estimate',
    verticalProportion: vertical,
    verticalProportionLabel: verticalLabels[vertical],
    ratios: features
      ? {
          faceLengthToWidth: features.face?.lengthToWidth ?? null,
          jawToCheek: features.face?.jawToCheek ?? null,
          foreheadToJaw: features.face?.foreheadToJaw ?? null,
          shoulderToHip: features.body?.shoulderToHip ?? null,
          legToTorso: features.body?.legToTorso ?? null,
        }
      : null,
    guidance,
  };
}
