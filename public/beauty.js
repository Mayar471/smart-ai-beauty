import { faceFeatures } from './appearance-features.js';
import { FaceLandmarker, FilesetResolver, ImageSegmenter } from './vendor/mediapipe/vision_bundle.mjs';
export async function composeLook(src, { hairColor, makeup }) {
  let result;
  if (hairColor) {
    result = await recolorHair(src, hairColor);
    src = result.canvas.toDataURL('image/png');
  }
  if (makeup) result = await applyMakeup(src, makeup);
  if (!result) throw new Error('اختاري لون الشعر أو المكياج لإضافته إلى القميص.');
  return result;
}
let modelPromise, cache, hairModelPromise, hairCache;
async function model() {
  if (!modelPromise)
    modelPromise = FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm')
      .then((files) =>
        FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/vendor/mediapipe/face_landmarker.task', delegate: 'CPU' },
          runningMode: 'IMAGE',
          numFaces: 2,
        }),
      )
      .catch((e) => {
        modelPromise = null;
        throw e;
      });
  return modelPromise;
}
function image(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
async function getFace(src) {
  let current = cache;
  if (!current || current.src !== src) {
    const img = await image(src);
    const task = await model();
    const found = task.detect(img).faceLandmarks;
    if (!found?.length) throw new Error('لم نتمكن من تحديد وجه واضح. استخدمي صورة أمامية أوضح للوجه.');
    if (found.length !== 1) throw new Error('ظهرت عدة وجوه. استخدمي صورة يظهر فيها وجهك فقط.');
    current = { src, img, points: found[0] };
    cache = current;
  }
  return current;
}
export async function applyMakeup(src, { lip, eye, blush, strength }) {
  const { img, points } = await getFace(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const x = canvas.getContext('2d');
  x.drawImage(img, 0, 0);
  const w = canvas.width,
    h = canvas.height;
  const factor = { ناعم: 0.24, متوسط: 0.4, بارز: 0.58 }[strength] || 0.24;
  const path = (indices) => {
    const p = new Path2D();
    indices.forEach((i, j) => {
      const q = points[i];
      if (j === 0) p.moveTo(q.x * w, q.y * h);
      else p.lineTo(q.x * w, q.y * h);
    });
    p.closePath();
    return p;
  };
  // Lip ring excludes the mouth opening, so teeth are preserved.
  const outer = [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91];
  const inner = [78, 81, 13, 311, 308, 402, 14, 178];
  const lips = path(outer);
  lips.addPath(path(inner));
  x.save();
  x.globalAlpha = factor;
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = lip;
  x.fill(lips, 'evenodd');
  x.restore();
  // Upper eyelid bands use eye and brow landmarks, avoiding the eyeball.
  const shadow = (eyeIndices, browIndices) => {
    const p = new Path2D();
    eyeIndices.forEach((i, j) => {
      const q = points[i];
      j ? p.lineTo(q.x * w, q.y * h) : p.moveTo(q.x * w, q.y * h);
    });
    browIndices
      .slice()
      .reverse()
      .forEach((i, j) => {
        const b = points[i],
          e = points[eyeIndices[eyeIndices.length - 1 - j]];
        p.lineTo((e.x * 0.6 + b.x * 0.4) * w, (e.y * 0.6 + b.y * 0.4) * h);
      });
    p.closePath();
    x.save();
    x.filter = `blur(${Math.max(1, w * 0.0015)}px)`;
    x.globalAlpha = factor * 0.7;
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = eye;
    x.fill(p);
    x.restore();
  };
  shadow([33, 160, 159, 158, 133], [70, 63, 105, 66, 107]);
  shadow([263, 387, 386, 385, 362], [300, 293, 334, 296, 336]);
  const faceWidth = Math.hypot((points[234].x - points[454].x) * w, (points[234].y - points[454].y) * h);
  for (const index of [205, 425]) {
    const p = points[index],
      r = faceWidth * 0.12;
    const g = x.createRadialGradient(p.x * w, p.y * h, 0, p.x * w, p.y * h, r);
    g.addColorStop(0, blush);
    g.addColorStop(1, blush + '00');
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.globalAlpha = factor * 0.6;
    x.fillStyle = g;
    x.fillRect(p.x * w - r, p.y * h - r, r * 2, r * 2);
    x.restore();
  }
  return { canvas, landmarkCount: points.length, faceCount: 1 };
}
export async function recolorHair(src, color) {
  const { img, points } = await getFace(src);
  if (!hairModelPromise)
    hairModelPromise = FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm')
      .then((files) =>
        ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/vendor/mediapipe/hair_segmenter.tflite', delegate: 'CPU' },
          runningMode: 'IMAGE',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        }),
      )
      .catch((e) => {
        hairModelPromise = null;
        throw e;
      });
  const segmenter = await hairModelPromise;
  if (!hairCache || hairCache.src !== src) {
    const result = segmenter.segment(img);
    try {
      const mask = result.confidenceMasks?.[1];
      if (!mask) throw new Error('تعذر تحديد منطقة الشعر.');
      hairCache = {
        src,
        width: mask.width,
        height: mask.height,
        values: new Float32Array(mask.getAsFloat32Array()),
      };
    } finally {
      result.close();
    }
  }
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, c.width, c.height),
    pixels = data.data;
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const { width: mw, height: mh, values } = hairCache;
  const minX = Math.min(points[234].x, points[454].x),
    maxX = Math.max(points[234].x, points[454].x),
    fw = maxX - minX,
    top = points[10].y,
    fh = Math.abs(points[152].y - top);
  let changed = 0;
  for (let y = 0; y < c.height; y++) {
    const ny = y / c.height;
    if (ny < top - fh || ny > top + fh * 2.8) continue;
    for (let xx = 0; xx < c.width; xx++) {
      const nx = xx / c.width;
      if (nx < minX - fw * 0.75 || nx > maxX + fw * 0.75) continue;
      const confidence =
        values[Math.min(mh - 1, Math.floor(ny * mh)) * mw + Math.min(mw - 1, Math.floor(nx * mw))];
      const alpha = Math.max(0, Math.min(1, (confidence - 0.5) / 0.4)) * 0.72;
      if (alpha <= 0) continue;
      const p = (y * c.width + xx) * 4;
      const luminance = (pixels[p] * 0.2126 + pixels[p + 1] * 0.7152 + pixels[p + 2] * 0.0722) / 255;
      for (let k = 0; k < 3; k++)
        pixels[p + k] = Math.round(pixels[p + k] * (1 - alpha) + rgb[k] * (0.4 + luminance * 0.8) * alpha);
      changed++;
    }
  }
  if (changed < 100) throw new Error('لم تظهر منطقة شعر واضحة. جرّبي صورة تظهر الشعر بالكامل.');
  x.putImageData(data, 0, 0);
  return { canvas: c, changedPixels: changed };
}

export async function analyzeFaceFeatures(src) {
  const { img, points } = await getFace(src);
  return faceFeatures(points, img.naturalWidth, img.naturalHeight);
}
