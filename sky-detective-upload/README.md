# Sky Detective

NASA Space Apps Challenge 2026 · "Planet X and SPHEREx". Players blink between two real SPHEREx
scans of the same patch of sky and tap whatever moved. Answers are checked against known
asteroids (IMCCE SkyBoT, JPL Horizons) and explained with facts from the JPL Small-Body Database.

```
site/       the game (React + Vite), deployed on Vercel
scripts/    the data pipeline (Python): builds levels from real SPHEREx images
```

## Run the game

Needs Node.js 18 or newer.

```
cd site
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in site/dist
```

**Deploy on Vercel:** import the GitHub repo, set **Root Directory** to `site`. Vercel detects
Vite and runs `npm run build` itself.

## What's in the game now

- Case file: 6 rounds. 2 training rounds (a fake mover planted on a real SPHEREx image),
  (10) Hygiea, (9) Metis, (3) Juno, and an empty field where the right answer is "Nothing moved".
- Practice: unlimited training rounds with a random planted mover.
- Scoring: +100 per find, up to +50 speed bonus within 20 s, +150 for a correct
  "Nothing moved", −25 per wrong tap, ×1.5 after 3 correct in a row. End card shows accuracy,
  movers found, sky searched and the best score on this device.
- Every result card says "Real SPHEREx data" or "Simulated object".
- English / Hindi toggle, remembered on the device. `?lang=hi` opens the site in Hindi.

Not built yet (see the plan doc): Challenge mode (shuffled real + simulated rounds),
classroom mode, the how-to-play animation, levels 5 to 7.

## Where things live

| File | What it does |
| --- | --- |
| `site/public/levels/index.json` | The round list: order, kind (`training` / `real`), titles in both languages |
| `site/public/levels/<folder>/` | `frame_a.png`, `frame_b.png`, `diff.png`, `level.json` from the pipeline |
| `site/public/objects/<number>.json` | Info-card facts from JPL SBDB |
| `site/src/i18n/en.json`, `hi.json` | Every on-screen string. Never type text straight into a component |
| `site/src/game/plantMover.js` | Draws a fake mover into two frames (training, practice) |
| `site/src/game/scoring.js` | Tap radius (12 px) and all point values |
| `site/src/components/Game.jsx` | One round: blink, taps, "Nothing moved", result card |

## Add a level

Needs Python 3.10+ and `pip install -r scripts/requirements.txt`.

1. Find a pair that caught your object (prints the build command):
   `python scripts/find_object_pair.py --target 3 --start 2025-06-28 --stop 2025-07-10`
2. Build it: run the printed `fetch_spherex_pair.py` command.
3. Check `levels/<name>/preview.gif` and `diff.png` by eye. The `movers` list in `level.json`
   is the answer key.
4. Copy `frame_a.png`, `frame_b.png`, `diff.png`, `level.json` into `site/public/levels/<name>/`
   and add the round to `site/public/levels/index.json`.
5. Fetch its info card:
   `python scripts/fetch_object_info.py --levels site/public/levels --out site/public/objects`

## Credits

SPHEREx images: NASA/JPL-Caltech, via the NASA/IPAC Infrared Science Archive (IRSA).
Asteroid positions: IMCCE SkyBoT and JPL Horizons. Facts: JPL Small-Body Database.
