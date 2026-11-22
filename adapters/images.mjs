import { hairstyles, hairColors, hijabStyles, hijabColors, makeupStrengths } from '../public/options.js';
import { AppError } from './errors.mjs';
import { readPngDataUrl, isPng, isJpeg } from './png.mjs';

const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const hexColor = /^#[a-f0-9]{6}$/i;

export const imageConfigured = () =>
  !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);

/**
 * Validates a generation request and builds the prompt.
 * The prompt is assembled only from whitelisted options: no user-written text ever reaches the image model.
 * `input.hijab` and `input.modest` are set by the server from the saved profile, never by the browser.
 */
export function validateImageRequest(input) {
  if (input?.consent !== true) throw new AppError(400, 'وافقي على إرسال الصور إلى Cloudflare أولاً.');
  if (!['hair', 'outfit'].includes(input.mode)) throw new AppError(400, 'اختيارات التوليد غير صالحة.');
  if (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > 4)
    throw new AppError(400, 'الطلب يحتاج من صورة إلى أربع صور.');
  const images = input.images.map((value) =>
    readPngDataUrl(value, { maxBytes: 1_500_000, maxSide: 480, message: 'الصورة المرجعية غير صالحة.' }),
  );
  if (input.mode === 'outfit' && images.length !== 3)
    throw new AppError(400, 'يلزم الجسم والوجه ولوحة قطع الملابس.');

  let headInstruction;
  if (input.hijab) {
    const wrap = hijabStyles.find((h) => h.id === (input.hijabWrap || 'classic'));
    const color = hijabColors.find((c) => c.name === (input.hijabColor || 'بيج'));
    if (!wrap || !color) throw new AppError(400, 'اختيارات الحجاب غير صالحة.');
    headInstruction = `She wears ${wrap.prompt}, in opaque ${color.prompt} fabric. The hijab fully covers all hair, the ears and the neck. No exposed hair.`;
  } else {
    const style = hairstyles.find((h) => h.id === input.hair);
    const color = hairColors.find((c) => c.name === input.color);
    if (!style) throw new AppError(400, 'اختيارات التوليد غير صالحة.');
    if (!color) throw new AppError(400, 'لون الشعر غير صالح.');
    headInstruction = `Change the hairstyle visibly to ${style.prompt}, colored ${color.prompt}.`;
  }

  const palette = ['lip', 'eye', 'blush'].map((key) => (hexColor.test(input[key] || '') ? input[key] : null));
  if (palette.some((color) => !color)) throw new AppError(400, 'ألوان المكياج غير صالحة.');
  const strength = makeupStrengths[input.strength || 'ناعم'];
  if (!strength) throw new AppError(400, 'قوة المكياج غير صالحة.');

  const identity =
    'Preserve the exact identity, facial features, natural skin tone and body proportions of the person.';
  const quality = 'Photorealistic coherent photograph, natural anatomy, no collage, no text, no panels.';
  const modest = input.modest
    ? 'Outfit must be loose fitting, opaque, long sleeved, ankle length, no exposed neckline or midriff; use a modest adaptation of referenced garments.'
    : '';

  const prompt =
    input.mode === 'hair'
      ? `Edit image 0. ${identity} ${headInstruction} ${quality} Change only the ${input.hijab ? 'head covering' : 'hair shape and color'}, preserving the face, clothing, pose and background.`
      : `Image 0 is the full-body person; image 1 is the same person's face identity reference. Image 2 is a reference board of the selected garments. Create a photorealistic photograph, never a cartoon or illustration. Dress the person from image 0 in the garments shown in image 2. Keep garment colors, cuts and distinctive details. ${identity} ${headInstruction} ${modest} Makeup intensity must be ${strength}: lips ${palette[0]}, eyeshadow ${palette[1]}, blush ${palette[2]}. ${quality} Keep the entire person inside the frame from top of the head to feet, with space above the head and below the feet. Show one full-body photograph of the person wearing the outfit, not the garment board.`;

  return { images, prompt, mode: input.mode };
}

/** Sends the references to Cloudflare Workers AI and returns the generated PNG/JPEG bytes. */
export async function generateImage(input) {
  const { images, prompt } = validateImageRequest(input);
  if (!imageConfigured()) throw new AppError(503, 'محرك الصور غير مهيأ على الخادم.');
  try {
    const form = new FormData();
    form.set('prompt', prompt);
    form.set('width', '768');
    form.set('height', input.mode === 'hair' ? '768' : '1024');
    images.forEach((data, i) =>
      form.set(`input_image_${i}`, new Blob([data], { type: 'image/png' }), `reference-${i}.png`),
    );
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
        body: form,
        signal: AbortSignal.timeout(120000),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      if ([401, 403].includes(response.status))
        throw new AppError(
          503,
          'رفض Cloudflare صلاحية المفتاح أو أذوناته. يلزم فحص إعدادات المحرك على الخادم.',
        );
      if (response.status === 429)
        throw new AppError(429, 'نفدت الحصة أو وصلنا لحد الطلبات. أعيدي المحاولة لاحقاً.');
      if ([400, 413, 422].includes(response.status))
        throw new AppError(
          422,
          'رفض المحرك صيغة الصور أو أبعادها. احفظي صور الملف مجدداً ثم أعيدي المحاولة.',
        );
      throw new AppError(503, 'خدمة توليد الصور غير متاحة الآن. هذا لا يعني انتهاء صلاحية المفتاح.');
    }
    const value = data.result?.image;
    if (typeof value !== 'string' || value.length > 24_000_000)
      throw new AppError(503, 'لم يُرجع المحرك صورة صالحة.');
    const bytes = Buffer.from(value.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    if (!isPng(bytes) && !isJpeg(bytes)) throw new AppError(503, 'تنسيق الصورة الناتجة غير مدعوم.');
    return bytes;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (['TimeoutError', 'AbortError'].includes(e.name))
      throw new AppError(
        504,
        'انتهت مهلة انتظار الصورة؛ هذا ليس انتهاء صلاحية المفتاح. أعيدي المحاولة لاحقاً.',
      );
    throw new AppError(503, 'تعذر الاتصال بمحرك الصور. تحققي من اتصال الإنترنت ثم أعيدي المحاولة.');
  }
}
