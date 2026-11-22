import { bodyFeatures } from './appearance-features.js';
import { FilesetResolver, PoseLandmarker } from './vendor/mediapipe/vision_bundle.mjs';
import { summarizePose } from './pose-metrics.js';
let taskPromise, cache;
export async function analyzeBody(src) {
  if (cache?.src === src) return cache.result;
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  if (!taskPromise)
    taskPromise = FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm')
      .then((files) =>
        PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/vendor/mediapipe/pose_landmarker_lite.task', delegate: 'CPU' },
          runningMode: 'IMAGE',
          numPoses: 2,
          outputSegmentationMasks: false,
        }),
      )
      .catch((error) => {
        taskPromise = null;
        throw error;
      });
  const task = await taskPromise;
  const result = task.detect(image);
  if (!result.landmarks?.length)
    throw new Error('لم نتمكن من تحديد الجسم. اختاري صورة أوضح يظهر فيها جسمك بالكامل.');
  if (result.landmarks.length !== 1) throw new Error('ظهرت عدة أشخاص. اختاري صورة يظهر فيها جسمك وحدك.');
  const points = result.landmarks[0],
    summary = summarizePose(points, image.naturalWidth, image.naturalHeight);
  summary.appearance = bodyFeatures(points, image.naturalWidth, image.naturalHeight, summary);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const x = canvas.getContext('2d');
  x.drawImage(image, 0, 0);
  x.strokeStyle = '#ab416b';
  x.lineWidth = Math.max(2, canvas.width / 300);
  for (const [a, b] of [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28],
  ]) {
    if (points[a].visibility < 0.6 || points[b].visibility < 0.6) continue;
    x.beginPath();
    x.moveTo(points[a].x * canvas.width, points[a].y * canvas.height);
    x.lineTo(points[b].x * canvas.width, points[b].y * canvas.height);
    x.stroke();
  }
  x.fillStyle = '#ffdab5';
  for (const p of points)
    if (p.visibility >= 0.6 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) {
      x.beginPath();
      x.arc(p.x * canvas.width, p.y * canvas.height, Math.max(3, canvas.width / 160), 0, 2 * Math.PI);
      x.fill();
    }
  cache = { src, result: { summary, canvas } };
  return cache.result;
}
