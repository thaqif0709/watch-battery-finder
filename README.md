# Watch Battery Finder

Take a photo of a watch (dial, then caseback) and the app tells you:

- **What it is:** brand, model, reference, movement (calibre)
- **Quartz or automatic:** from photo clues, plus an optional 8-second second-hand test (ticks once a second = quartz, sweeps = mechanical, jumps every 2 s = battery nearly flat)
- **Which battery to buy** for quartz watches, with every name it's sold under (SR626SW = 377 = SR66), its size, and **the sources it came from**
- **Movement specs** for automatics (jewels, beat rate, power reserve, hacking, hand-winding)
- **Warnings** for Solar / Eco-Drive / Kinetic watches: they use rechargeable cells, so don't fit a normal SR battery

It also keeps a **"to open" list** that adds up the batteries you need to order across all the watches you've scanned, and a **database** that learns from every watch you open.

## How it decides the battery

The AI only *reads* things (photos and web pages). It never picks the battery from memory. Order of trust:

1. **✅ Confirmed by you.** You opened this watch, or another watch with the same movement, and saved what you found. The answer is instant, with no AI or search.
2. **✅ Read off the watch.** A battery code visible in a photo (e.g. the old cell) or one you typed.
3. **🔎 Suggested from the web.** The movement code is looked up on:
   - [Caliber Corner](https://calibercorner.com), a movement database built from manufacturer spec sheets. Always used, no key needed.
   - a general web search (see below).

   Each page is read, and a claim only counts if its quote is **actually on that page**: invented quotes are rejected. Sources are weighted by trust: manufacturer (3) > movement database / trade supplier (2) > forum or other site (1) > marketplace listing (0.5). One website counts once. The battery most independent, trustworthy sources agree on wins, with a high / medium / low confidence.
4. **⚠️ AI guess.** What the AI "remembers" counts for very little and is labelled as such.
5. **❓ Unknown: open it.** Then save what you find, and next time it's instant.

The most useful photo is the **caseback**. Seiko-group casebacks (`7N43-0AA0`), Citizen (`E168-S081234`) and Casio (module number in a box, e.g. `3229`) all give away the movement, and the movement decides the battery.

## Run it on your computer

```bash
npm install
cp .dev.vars.example .dev.vars        # put your Gemini key in here
npm run db:migrate:local
npm run dev                           # http://localhost:8787
npm test                              # unit + pipeline tests
```

Without a Gemini key the app still works if you **type** what's on the caseback (e.g. `Miyota 2035`, `Pulsar VX42-X020`). It just can't read photos.

> Phone cameras only work on **https** (or localhost), so for real use on your phone, deploy it (below).

## Free hosting on Cloudflare (about 10 minutes)

Everything fits in Cloudflare's free plan: Workers (app + API) and D1 (database).

1. Make a free account at <https://dash.cloudflare.com/sign-up>.
2. Get a free Gemini API key at <https://aistudio.google.com/apikey>.
3. In this folder:

   ```bash
   npx wrangler login
   npx wrangler d1 create watch-battery-finder
   # copy the "database_id" it prints into wrangler.toml (replace the 0000… one)
   npm run db:migrate:remote
   npx wrangler secret put GEMINI_API_KEY      # paste the key
   npx wrangler secret put APP_PASSCODE        # pick any passcode; stops strangers using your quota
   npm run deploy
   ```

4. Open the `https://watch-battery-finder.<you>.workers.dev` URL it prints, on your phone. In **Settings**, enter the passcode and your ring's outer diameter.
5. iPhone: Share → *Add to Home Screen*. Android: menu → *Install app*. It then opens like a normal app.

### Better web search (optional, recommended)

With no search key the app uses Caliber Corner plus DuckDuckGo's free HTML page. **DuckDuckGo often blocks automated requests**, so only Caliber Corner may get through. For reliable searching, add one of these:

| Provider | Setup | Notes |
|---|---|---|
| Tavily | `npx wrangler secret put TAVILY_API_KEY` | free credits each month at tavily.com, no card |
| Brave Search | `npx wrangler secret put BRAVE_API_KEY` | small free monthly credit |
| Google Programmable Search | `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` | 100 free queries/day |

Search results are cached for 30 days, so each movement only uses quota once.

## Using it

1. **Start camera.** Lay the watch flat. Hold the phone flat above it; the circle and bubble go green when level.
2. **① Dial.** Put your ring next to the watch if you want the case size.
3. **② Caseback.** Flip it over. Get close, with light from the side so the engraving shows. If the in-app camera is blurry up close, use **Phone cam**, which uses your phone's own camera app with macro and focus.
4. Optional: **More clues**. Use the second-hand test, and *Measure on dial photo*: tap both edges of the case, then both edges of the ring.
5. **Identify watch.**
6. When you open the watch: **"Opened it: save what I found"**. Type the battery printed on the old cell and the movement number if you can see it. That's what makes the database smart.

The **To open** tab shows everything you've scanned but not opened yet, plus a combined shopping list ("2× SR626SW, 1× SR920SW"). **Copy list** puts it on your clipboard for ordering.

## Project layout

```
public/            the web app (no build step)
  app.js           screens, API calls
  camera.js        camera, spirit level, zoom, capture
  tick.js          second-hand test (tick vs sweep)
  measure.js       tap-to-measure case size with a ring/coin
src/
  worker.js        API routes (/api/identify, /api/confirm, /api/shopping, ...)
  lib/identify.js  the pipeline: photos -> movement -> battery
  lib/gemini.js    Gemini calls (reading photos, reading web snippets)
  lib/search.js    web search providers, Caliber Corner, page fetching
  lib/evidence.js  verifying quotes, trust weights, scoring
  lib/normalize.js caseback code -> calibre, calibre matching
  lib/db.js        D1 queries
  data/batteries.js  battery cross-reference (SR/CR codes, 3xx numbers, AG equivalents, sizes)
  data/movements.js  specs of common automatic movements
migrations/        D1 schema
test/              node --test
```

## Known limits

- Faint caseback engravings are the hardest part. If the AI can't read them, it says so and suggests a retake. You can also just type the code.
- The quartz movement → battery table starts **empty on purpose**. It's filled only by web evidence (shown with sources) and by what you confirm. Nothing is "remembered" that could be wrong.
- Case size from a ring is roughly ±0.5–1 mm, and only if the photo is taken flat (that's what the level is for).
- The second-hand test needs the phone held still (rest it on a cup) and won't work on a stopped watch, which most watches needing a battery are. A stopped hand is reported as "stopped".
- Gemini's free tier has rate limits. If you hit one, the app tells you to wait a minute.
