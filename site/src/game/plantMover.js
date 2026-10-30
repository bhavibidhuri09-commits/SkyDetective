// Draws a fake moving object into two real SPHEREx frames (training + practice).
// The dot sits at one spot in frame A and `jump` pixels away in frame B, on a
// part of the sky with no bright star nearby.

export function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function medianLevel(img) {
  const counts = new Uint32Array(256);
  for (let i = 0; i < img.data.length; i += 4) counts[img.data[i]]++;
  let seen = 0;
  const half = img.data.length / 8;
  for (let v = 0; v < 256; v++) {
    seen += counts[v];
    if (seen >= half) return v;
  }
  return 128;
}

function brightestNear(img, x, y, radius) {
  let max = 0;
  for (let j = Math.floor(y - radius); j <= y + radius; j++) {
    for (let i = Math.floor(x - radius); i <= x + radius; i++) {
      if (i < 0 || j < 0 || i >= img.width || j >= img.height) continue;
      max = Math.max(max, img.data[(j * img.width + i) * 4]);
    }
  }
  return max;
}

function stamp(img, x, y, peak, sigma) {
  const reach = Math.ceil(sigma * 4);
  for (let j = Math.floor(y - reach); j <= y + reach; j++) {
    for (let i = Math.floor(x - reach); i <= x + reach; i++) {
      if (i < 0 || j < 0 || i >= img.width || j >= img.height) continue;
      const d2 = (i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2;
      const add = peak * Math.exp(-d2 / (2 * sigma * sigma));
      const k = (j * img.width + i) * 4;
      for (let c = 0; c < 3; c++) img.data[k + c] = Math.min(255, img.data[k + c] + add);
    }
  }
}

// frameA, frameB: ImageData of the same size, changed in place.
// Returns the dot's position in each frame, in image pixels.
export function plantMover(frameA, frameB, { seed, peak, sigma, jump }) {
  const random = seededRandom(seed);
  const margin = 40;
  const clearA = medianLevel(frameA) + 60;
  const clearB = medianLevel(frameB) + 60;
  const { width, height } = frameA;
  for (let tries = 0; tries < 1000; tries++) {
    const angle = random() * 2 * Math.PI;
    const x = margin + random() * (width - 2 * margin);
    const y = margin + random() * (height - 2 * margin);
    const x2 = x + Math.cos(angle) * jump;
    const y2 = y + Math.sin(angle) * jump;
    if (x2 < margin || x2 > width - margin || y2 < margin || y2 > height - margin) continue;
    if (brightestNear(frameA, x, y, 10) > clearA || brightestNear(frameB, x2, y2, 10) > clearB) continue;
    stamp(frameA, x, y, peak, sigma);
    stamp(frameB, x2, y2, peak, sigma);
    return { a: { x, y }, b: { x: x2, y: y2 } };
  }
  throw new Error("No clear spot for the planted mover");
}

export function randomPlant() {
  return {
    seed: 1 + Math.floor(Math.random() * 2e9),
    peak: 80 + Math.random() * 120,
    sigma: 2 + Math.random() * 0.8,
    jump: 25 + Math.random() * 55,
  };
}
