export interface ColorSelectionOptions {
  tolerance: number;
  maxPoints: number;
}

export interface ColorSelectionResult {
  path: [number, number][];
  pixelCount: number;
}

const COLOR_CHANNELS = 3;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const colorDistance = (
  data: Uint8ClampedArray,
  pixelIndex: number,
  seedR: number,
  seedG: number,
  seedB: number
) => {
  const offset = pixelIndex * 4;
  const dr = data[offset] - seedR;
  const dg = data[offset + 1] - seedG;
  const db = data[offset + 2] - seedB;

  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(255 * 255 * COLOR_CHANNELS);
};

const simplifyBoundary = (
  points: Array<{ x: number; y: number }>,
  maxPoints: number
) => {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = points.length / maxPoints;
  const simplified: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < maxPoints; i += 1) {
    simplified.push(points[Math.floor(i * step)]);
  }

  return simplified;
};

export const createMaskFromColorSelection = (
  imageData: ImageData,
  normalizedX: number,
  normalizedY: number,
  options: ColorSelectionOptions
): ColorSelectionResult | null => {
  const width = imageData.width;
  const height = imageData.height;
  const pixelCount = width * height;

  if (pixelCount === 0) {
    return null;
  }

  const seedX = clamp(Math.floor(normalizedX * width), 0, width - 1);
  const seedY = clamp(Math.floor(normalizedY * height), 0, height - 1);
  const seedIndex = seedY * width + seedX;

  const data = imageData.data;
  const seedOffset = seedIndex * 4;
  const seedR = data[seedOffset];
  const seedG = data[seedOffset + 1];
  const seedB = data[seedOffset + 2];

  const threshold = clamp(options.tolerance, 0, 1);

  const selected = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);

  const queueX = new Int32Array(pixelCount * 4 + 4);
  const queueY = new Int32Array(pixelCount * 4 + 4);
  let queueStart = 0;
  let queueEnd = 0;

  queueX[queueEnd] = seedX;
  queueY[queueEnd] = seedY;
  queueEnd += 1;

  while (queueStart < queueEnd) {
    const x = queueX[queueStart];
    const y = queueY[queueStart];
    queueStart += 1;

    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    const index = y * width + x;
    if (visited[index]) {
      continue;
    }

    visited[index] = 1;

    if (colorDistance(data, index, seedR, seedG, seedB) > threshold) {
      continue;
    }

    selected[index] = 1;

    queueX[queueEnd] = x + 1;
    queueY[queueEnd] = y;
    queueEnd += 1;

    queueX[queueEnd] = x - 1;
    queueY[queueEnd] = y;
    queueEnd += 1;

    queueX[queueEnd] = x;
    queueY[queueEnd] = y + 1;
    queueEnd += 1;

    queueX[queueEnd] = x;
    queueY[queueEnd] = y - 1;
    queueEnd += 1;
  }

  let selectedCount = 0;
  const boundaryPoints: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!selected[index]) {
        continue;
      }

      selectedCount += 1;

      const left = x > 0 ? selected[index - 1] : 0;
      const right = x < width - 1 ? selected[index + 1] : 0;
      const top = y > 0 ? selected[index - width] : 0;
      const bottom = y < height - 1 ? selected[index + width] : 0;

      if (!left || !right || !top || !bottom) {
        boundaryPoints.push({ x, y });
      }
    }
  }

  if (selectedCount < 9 || boundaryPoints.length < 3) {
    return null;
  }

  const centroid = boundaryPoints.reduce(
    (acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 }
  );

  centroid.x /= boundaryPoints.length;
  centroid.y /= boundaryPoints.length;

  const sortedBoundary = [...boundaryPoints].sort((a, b) => {
    const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
    const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
    return angleA - angleB;
  });

  const simplified = simplifyBoundary(
    sortedBoundary,
    clamp(Math.round(options.maxPoints), 6, 128)
  );

  const path: [number, number][] = simplified.map((point) => [
    clamp(point.x / width, 0, 1),
    clamp(point.y / height, 0, 1),
  ]);

  return {
    path,
    pixelCount: selectedCount,
  };
};
