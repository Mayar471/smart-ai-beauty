// Image-space observations only. These are not garment sizes or physical measurements.
export function summarizePose(points, width, height) {
  if (!Array.isArray(points) || points.length !== 33)
    throw new Error('لم نتمكن من تحديد الجسم. اختاري صورة أوضح يظهر فيها جسمك بالكامل.');
  const visible = (i) => {
    const p = points[i];
    return p.visibility >= 0.6 && p.x >= 0.015 && p.x <= 0.985 && p.y >= 0.015 && p.y <= 0.985;
  };
  const fullBodyVisible = [0, 11, 12, 23, 24, 25, 26, 27, 28].every(visible);
  const shoulderY = (points[11].y + points[12].y) / 2,
    hipY = (points[23].y + points[24].y) / 2,
    ankleY = (points[27].y + points[28].y) / 2;
  const pose = fullBodyVisible && shoulderY < hipY && hipY < ankleY ? 'upright' : 'other';
  const upperBodyBand =
    pose === 'upright'
      ? { top: Math.min(points[11].y, points[12].y), bottom: Math.min(points[23].y, points[24].y) }
      : null;
  return {
    version: 1,
    model: 'mediapipe-pose-lite',
    width,
    height,
    landmarkCount: 33,
    visibleLandmarks: points.filter((_, i) => visible(i)).length,
    fullBodyVisible,
    pose,
    upperBodyBand,
  };
}
