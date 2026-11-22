import { stylingBrief } from '../public/appearance-features.js';
import { suggest as localSuggest } from './gemma.mjs';
import { validateRecommendations } from './catalog.mjs';

const CATALOG_LIMIT = 60;

const systemInstruction = [
  'أنت مستشارة إطلالات عربية. نسقي إطلالة واحدة من قطع متكاملة للمناسبة والأسلوب والطقس: فستان أو قطعة علوية مع سفلية، وأضيفي حذاء/حقيبة/طبقة متاحة عند الحاجة.',
  'recommendations قطع الإطلالة الواحدة وليست بدائل متعارضة، بحد أقصى 6 قطع. أوصي فقط بمعرفات catalog الحرفية. إن لم تكف القطع لإطلالة متكاملة اذكري النواقص بوضوح دون اختلاق معرفات، وإن لم توجد قطعة مناسبة اتركي recommendations فارغة.',
  'راعي حرارة الطقس والمطر والمكان الداخلي أو الخارجي فقط عندما weather.status=available؛ وإلا اذكري عدم توفر الطقس ولا تختلقيه.',
  'profile.stylingBrief ملخص مدروس لسمات الوجه والجسم: guidance قواعد تنسيق معتمدة مشتقة من السمات، فابني عليها اختيار القصات واقتراح الشعر أو لفة الحجاب والمكياج واذكري السبب باختصار. القيم التي مصدرها image-estimate تقدير هندسي تقريبي من الصورة فاذكري أنها تقريبية، والقيم user-reviewed صححتها المستخدمة فاعتمديها. عند unknown لا تخمني شكل الوجه أو الجسم. لا تصدري أحكام جمال ولا تصنفي الوزن ولا تقترحي تغيير الملامح.',
  'عندما profile.stylingBrief.wearsHijab=true اقترحي إطلالة بحجاب يغطي الشعر والرقبة وملابس طويلة واسعة معتمة بأكمام طويلة، واقترحي لفة حجاب ولونه بدل التسريحة؛ لا تقترحي كشف الشعر. modesty=modest يعني تفضيل الاحتشام دون افتراض الحجاب. لا تعتبري قطعة غير موصوفة بالمحتشمة مناسبة دون توضيح الحاجة لطبقة إضافية.',
  'استخدمي القياسات الاختيارية المقدمة من المستخدمة بحذر ولا تستنتجي مقاس قطعة لا نملك جدول مقاساتها. لم تُرسل لك صور، فلا تدعي رؤيتها أو استنتاج لون البشرة. bodyImageCheck للوضوح والوضعية فقط.',
  'اختمي text باقتراح نصي للشعر أو الحجاب وللمكياج مع سبب الاختيار. لا تدعي توليد صورة.',
].join(' ');

export function provider() {
  return (
    process.env.AI_PROVIDER ||
    (process.env.GEMINI_API_KEY ? 'gemini' : process.env.OLLAMA_MODEL ? 'ollama' : 'none')
  );
}

/** The text-only context sent to the model. Photos, e-mail and coordinates are never included. */
export function recommendationContext(input) {
  const profile = input.profile || {};
  const catalog = (input.catalog || []).slice(0, CATALOG_LIMIT).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    color: item.colorName,
    occasions: item.occasions,
    modest: item.modest === true,
    source: item.source === 'wardrobe' ? 'personal wardrobe' : 'shared catalog',
    attributes: (item.attributeNames || []).slice(0, 8),
  }));
  const analysis = input.analysis;
  return {
    occasion: input.occasion,
    preference: input.preference,
    profile: {
      modesty: profile.modesty || 'standard',
      style: profile.style || '',
      favoriteColors: profile.favoriteColors || '',
      size: profile.size || '',
      userProvidedMeasurementsCm: Object.fromEntries(
        ['heightCm', 'chestCm', 'waistCm', 'hipsCm']
          .filter((key) => Number.isFinite(profile[key]))
          .map((key) => [key, profile[key]]),
      ),
      stylingBrief: stylingBrief(profile, analysis?.features || null),
    },
    bodyImageCheck:
      analysis?.model === 'mediapipe-pose-lite'
        ? { fullBodyVisible: analysis.fullBodyVisible, pose: analysis.pose }
        : null,
    event: input.event || null,
    weather: input.weather || null,
    ...(catalog.length ? { catalog } : {}),
  };
}

export async function suggest(input, { fetchImpl = fetch } = {}) {
  const selected = provider();
  if (selected === 'ollama') return localSuggest(input);
  if (selected !== 'gemini')
    throw new Error('مستشارة الإطلالة غير موصولة حالياً. يمكنك متابعة الاختيار بنفسك.');
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL)
    throw new Error('ربط Gemini ينتظر مفتاح API واسم نموذج متاح ضمن الحصة المجانية.');

  const context = recommendationContext(input);
  const generationConfig = { maxOutputTokens: 1600 };
  if (context.catalog) {
    // The schema only admits ids that exist for this account, so the model cannot invent garments.
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseJsonSchema = {
      type: 'object',
      properties: {
        text: { type: 'string' },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'string', enum: context.catalog.map((item) => item.id) },
              reason: { type: 'string' },
            },
            required: ['itemId', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['text', 'recommendations'],
      additionalProperties: false,
    };
  }

  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(context) }] }],
          generationConfig,
        }),
      },
    );
    if (response.status === 429) throw new Error('quota');
    if (!response.ok) throw new Error('upstream');
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text || '')
      .join('\n')
      .trim();
    if (!text) throw new Error('empty');
    return text;
  } catch (e) {
    if (e.message === 'quota')
      throw new Error('وصلنا إلى حد الاستخدام المتاح. حاولي لاحقاً؛ لن ننتقل تلقائياً إلى خدمة مدفوعة.');
    throw new Error('تعذر الاتصال بـGemini. تحققي من الاتصال والمفتاح والنموذج المتاح لحسابك.');
  }
}

export async function recommend(input, options) {
  const text = await suggest(input, options);
  if (provider() !== 'gemini' || !input.catalog?.length) return { text, recommendations: [] };
  try {
    return validateRecommendations(JSON.parse(text), input.catalog);
  } catch {
    throw new Error('تعذر قراءة اقتراحات الكتالوج. حاولي مجدداً.');
  }
}
