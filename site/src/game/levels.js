import { plantMover, randomPlant } from "./plantMover.js";

const BASE = import.meta.env.BASE_URL;

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function loadPixels(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function loadRoundList() {
  return (await fetchJson(`${BASE}levels/index.json`)).rounds;
}

const CHALLENGE_ROUNDS = 8;
const CHALLENGE_REAL = 5;

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Challenge: 8 rounds in a shuffled order, up to 5 real and the rest simulated.
export function buildChallengeRounds(rounds) {
  const real = shuffled(rounds.filter((r) => r.kind === "real")).slice(0, CHALLENGE_REAL);
  const simulated = Array.from({ length: CHALLENGE_ROUNDS - real.length }, (_, i) => ({
    id: `challenge-sim-${i + 1}`, kind: "training", folder: "training-bg", plant: randomPlant(),
    title: { en: "A simulated mover", hi: "एक नकली चलती वस्तु" },
  }));
  return shuffled([...real, ...simulated]);
}

// Everything one round needs: both frames as pixels, the level metadata,
// and the targets the player must find (empty = "Nothing moved" is right).
export async function loadRound(round) {
  const dir = `${BASE}levels/${round.folder}/`;
  const [level, frameA, frameB] = await Promise.all([
    fetchJson(`${dir}level.json`),
    loadPixels(`${dir}frame_a.png`),
    loadPixels(`${dir}frame_b.png`),
  ]);

  if (round.kind === "training") {
    const spot = plantMover(frameA, frameB, round.plant);
    return {
      round, level, frames: [frameA, frameB],
      targets: [{ id: "planted", simulated: true, frames: [spot.a, spot.b] }],
    };
  }

  const movers = level.objects.filter((o) => level.movers.includes(o.name));
  const targets = await Promise.all(
    movers.map(async (o) => {
      let info = null;
      if (o.number) {
        try {
          info = await fetchJson(`${BASE}objects/${o.number}.json`);
        } catch {
          // no info card yet: the round still plays
        }
      }
      return { id: o.name, simulated: false, name: o.name, number: o.number,
               frames: o.frames, motionPx: o.motion_px, motionArcsec: o.motion_arcsec, info };
    })
  );
  return { round, level, frames: [frameA, frameB], targets };
}
