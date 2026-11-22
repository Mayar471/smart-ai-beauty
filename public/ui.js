// Small DOM, network and image helpers shared by every front-end module.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => htmlEntities[c]);

let toastTimer;
export function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  // Re-opening the popover moves it to the top of the top layer, above any dialog opened meanwhile.
  if (element.showPopover) {
    if (element.matches(':popover-open')) element.hidePopover();
    element.showPopover();
  }
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.classList.remove('visible');
    if (element.hidePopover && element.matches(':popover-open')) element.hidePopover();
  }, 4500);
}

/** Lets any module show a toast without importing this one's state. */
export const notify = (message) => window.dispatchEvent(new CustomEvent('sab-notify', { detail: message }));

/**
 * JSON request helper. `api(url)` is a GET, `api(url, body)` a POST, and `api(url, null, 'DELETE')` a delete.
 * Rejects with the server's Arabic error message.
 */
export async function api(url, body, method = body === undefined ? 'GET' : 'POST') {
  const options = { method };
  if (body !== undefined && body !== null) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw Error('تعذر الاتصال بالخادم. تحققي من أنه يعمل ومن اتصالك.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'تعذر إكمال الطلب.');
  return data;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error('تعذرت قراءة الصورة.'));
    image.src = src;
  });
}

/** Validates an upload and re-encodes it as a PNG data URL no larger than `maxSide` pixels. */
export async function fileToPngDataUrl(file, maxSide = 1600) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)
    throw Error('اختاري صورة JPG أو PNG أو WEBP بحجم أقل من 10 ميغابايت.');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    throw Error('تعذرت قراءة الصورة. جرّبي ملفاً آخر.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
