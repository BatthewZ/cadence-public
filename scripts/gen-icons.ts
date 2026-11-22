/**
 * Regenerates the PWA's PNG icons from the logo master, src/web/public/image.png.
 * Run after changing the logo:
 *
 *   bun scripts/gen-icons.ts
 *
 * Renders in headless Chromium (canvas, high-quality smoothing) through `playwright-core`,
 * resolved from the project or from the global bun install that ships `playwright-cli`.
 *
 * The master is opaque on an uneven off-white vignette that the logo's own highlights share,
 * so the background can't be keyed out, and a flat fill around it shows the master's square
 * edge. Each icon instead shifts the master by (flat colour − local background estimate), which
 * flattens the vignette and the highlights alike, then pads it with that flat colour.
 *
 * - pwa-192 / pwa-512: rounded tile, transparent outside it ("any" purpose).
 * - maskable-512: full bleed, the whole logo inside the safe zone (a circle of radius 40%).
 * - apple-touch-icon-180: full bleed and opaque (iOS turns transparency black and rounds the
 *   corners itself).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PUBLIC = join(import.meta.dirname, "../src/web/public");
const MASTER = "image.png";

interface Variant {
  file: string;
  size: number;
  /** Distance from the logo's centre to its farthest pixel, as a fraction of `size`. */
  logoRadius: number;
  /** Corner radius of a transparent-cornered tile, as a fraction of `size`; null = full bleed. */
  tileRadius: number | null;
}

const MASKABLE_SAFE_RADIUS = 0.4;

const VARIANTS: Variant[] = [
  { file: "pwa-192.png", size: 192, logoRadius: 0.4, tileRadius: 0.2 },
  { file: "pwa-512.png", size: 512, logoRadius: 0.4, tileRadius: 0.2 },
  {
    file: "maskable-512.png",
    size: 512,
    logoRadius: MASKABLE_SAFE_RADIUS * 0.95,
    tileRadius: null,
  },
  { file: "apple-touch-icon-180.png", size: 180, logoRadius: 0.4, tileRadius: null },
];

interface Chromium {
  launch(options: { executablePath?: string; headless: boolean }): Promise<Browser>;
}
interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Page {
  evaluate<A, R>(fn: (arg: A) => Promise<R>, arg: A): Promise<R>;
}

const PLAYWRIGHT_CORE = [
  "playwright-core",
  join(homedir(), ".bun/install/global/node_modules/playwright-core/index.mjs"),
];

async function loadChromium(): Promise<Chromium> {
  for (const specifier of PLAYWRIGHT_CORE) {
    try {
      const mod = (await import(specifier)) as { chromium: Chromium };
      return mod.chromium;
    } catch {
      continue;
    }
  }
  throw new Error(
    `playwright-core not found (tried: ${PLAYWRIGHT_CORE.join(", ")}). Install playwright-cli globally with bun.`
  );
}

/** A cached Chromium build: `chromium.launch()` alone looks for its own pinned revision. */
function chromiumExecutable(): string | undefined {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = join(homedir(), ".cache/ms-playwright");
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter((d) => d.startsWith("chromium"))
    .sort()
    .reverse();
  for (const build of builds) {
    for (const rel of [
      "chrome-headless-shell-linux64/chrome-headless-shell",
      "chrome-linux64/chrome",
      "chrome-linux/chrome",
    ]) {
      const path = join(root, build, rel);
      if (existsSync(path)) return path;
    }
  }
  return undefined;
}

interface ComposeInput {
  src: string;
  variants: Variant[];
}
interface ComposeOutput {
  file: string;
  png: string;
  opaque: boolean;
}

/** Runs in the page. Flattens the master's background, then draws every variant onto it. */
async function compose({ src, variants }: ComposeInput): Promise<ComposeOutput[]> {
  /** Background pixels: every channel at least this bright, and nearly grey. */
  const BACKGROUND_MIN = 225;
  const BACKGROUND_MAX_CHROMA = 12;
  /** A channel this far from the flattened background marks a logo pixel. */
  const LOGO_THRESHOLD = 48;
  /** Blur radius of the background estimate, as a fraction of the master's width. */
  const BACKGROUND_BLUR = 0.05;

  const img = new Image();
  img.src = src;
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas2d = (width: number, height: number) => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return { canvas: c, ctx: c.getContext("2d", { willReadFrequently: true })! };
  };

  const master = canvas2d(w, h);
  master.ctx.drawImage(img, 0, 0);
  const pixels = master.ctx.getImageData(0, 0, w, h);
  const { data } = pixels;

  const isBackground = (i: number) => {
    const lo = Math.min(data[i], data[i + 1], data[i + 2]);
    const hi = Math.max(data[i], data[i + 1], data[i + 2]);
    return lo >= BACKGROUND_MIN && hi - lo <= BACKGROUND_MAX_CHROMA;
  };

  // Blurring the background-only layer and un-premultiplying (getImageData does) averages
  // only background pixels: an estimate of the vignette behind the logo too.
  const backgroundOnly = canvas2d(w, h);
  const masked = backgroundOnly.ctx.createImageData(w, h);
  const flat = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!isBackground(i)) continue;
    for (let c = 0; c < 3; c++) {
      masked.data[i + c] = data[i + c];
      flat[c] += data[i + c];
    }
    masked.data[i + 3] = 255;
    count++;
  }
  for (let c = 0; c < 3; c++) flat[c] = Math.round(flat[c] / count);
  backgroundOnly.ctx.putImageData(masked, 0, 0);
  const blurred = canvas2d(w, h);
  blurred.ctx.filter = `blur(${Math.round(w * BACKGROUND_BLUR)}px)`;
  blurred.ctx.drawImage(backgroundOnly.canvas, 0, 0);
  const vignette = blurred.ctx.getImageData(0, 0, w, h).data;

  // Weighted by coverage: deep inside the logo the estimate is mostly rounding noise.
  for (let i = 0; i < data.length; i += 4) {
    const coverage = vignette[i + 3] / 255;
    for (let c = 0; c < 3; c++) data[i + c] += coverage * (flat[c] - vignette[i + c]);
  }
  master.ctx.putImageData(pixels, 0, 0);

  const isLogo = (i: number) =>
    Math.max(
      Math.abs(data[i] - flat[0]),
      Math.abs(data[i + 1] - flat[1]),
      Math.abs(data[i + 2] - flat[2])
    ) > LOGO_THRESHOLD;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isLogo((y * w + x) * 4)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX <= minX || maxY <= minY) throw new Error("no logo found in the master image");
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let reach = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (isLogo((y * w + x) * 4)) reach = Math.max(reach, Math.hypot(x - cx, y - cy));
    }
  }

  return variants.map((v) => {
    const out = canvas2d(v.size, v.size);
    const { ctx } = out;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (v.tileRadius !== null) {
      ctx.beginPath();
      ctx.roundRect(0, 0, v.size, v.size, v.tileRadius * v.size);
      ctx.clip();
    }
    ctx.fillStyle = `rgb(${flat[0]}, ${flat[1]}, ${flat[2]})`;
    ctx.fillRect(0, 0, v.size, v.size);
    const scale = (v.logoRadius * v.size) / reach;
    ctx.drawImage(
      master.canvas,
      v.size / 2 - cx * scale,
      v.size / 2 - cy * scale,
      w * scale,
      h * scale
    );
    const result = ctx.getImageData(0, 0, v.size, v.size).data;
    let opaque = true;
    for (let i = 3; i < result.length; i += 4) {
      if (result[i] !== 255) {
        opaque = false;
        break;
      }
    }
    return { file: v.file, png: out.canvas.toDataURL("image/png"), opaque };
  });
}

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true });
try {
  const page = await browser.newPage();
  const src = `data:image/png;base64,${readFileSync(join(PUBLIC, MASTER)).toString("base64")}`;
  const results = await page.evaluate(compose, { src, variants: VARIANTS });
  for (const r of results) {
    const variant = VARIANTS.find((v) => v.file === r.file)!;
    if (variant.tileRadius === null && !r.opaque) {
      throw new Error(`${r.file} must be opaque (iOS renders transparency black)`);
    }
    writeFileSync(join(PUBLIC, r.file), Buffer.from(r.png.split(",")[1], "base64"));
    console.log(`wrote ${r.file}`);
  }
} finally {
  await browser.close();
}
