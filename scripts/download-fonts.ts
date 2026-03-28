/**
 * Downloads Google Fonts for self-hosting.
 *
 * For each font URL, fetches the CSS from Google Fonts (with woff2 User-Agent),
 * filters to latin-only @font-face blocks, downloads the woff2 files,
 * and generates a local fonts.css with rewritten paths.
 *
 * Usage: bun run scripts/download-fonts.ts
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const FONTS_DIR = join(import.meta.dirname, "../src/web/fonts");
const CSS_OUTPUT = join(import.meta.dirname, "../src/web/style/fonts.css");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface FontGroup {
  theme: string;
  urls: string[];
}

const FONT_GROUPS: FontGroup[] = [
  {
    theme: "Default",
    urls: [
      "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap",
      "https://fonts.googleapis.com/css2?family=Libertinus+Mono&display=swap",
    ],
  },
  {
    theme: "Noir",
    urls: [
      "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap",
      "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap",
    ],
  },
  {
    theme: "Botanical",
    urls: [
      "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap",
      "https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap",
    ],
  },
  {
    theme: "Sunset",
    urls: [
      "https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap",
      "https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800&display=swap",
      "https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500;600;700&display=swap",
    ],
  },
  {
    theme: "Candy",
    urls: [
      "https://fonts.googleapis.com/css2?family=Fredoka:wght@300;400;500;600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800&display=swap",
    ],
  },
  {
    theme: "Cyberpunk",
    urls: [
      "https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;500;600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800&display=swap",
    ],
  },
  {
    theme: "Pastel",
    urls: [
      "https://fonts.googleapis.com/css2?family=Quicksand:wght@300;400;500;600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,opsz,wght@0,6..12,300;0,6..12,400;0,6..12,500;0,6..12,600;0,6..12,700;1,6..12,300;1,6..12,400;1,6..12,500;1,6..12,600;1,6..12,700&display=swap",
    ],
  },
  {
    theme: "Brutalist",
    urls: [
      "https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap",
      "https://fonts.googleapis.com/css2?family=Work+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800&display=swap",
    ],
  },
  {
    theme: "Chalk",
    urls: [
      "https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap",
      "https://fonts.googleapis.com/css2?family=Karla:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800&display=swap",
    ],
  },
  {
    theme: "Ocean",
    urls: [
      "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap",
      "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700&display=swap",
    ],
  },
  {
    theme: "Ember",
    urls: [
      "https://fonts.googleapis.com/css2?family=Bitter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800&display=swap",
      "https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800&display=swap",
    ],
  },
  {
    theme: "Luxe",
    urls: [
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap",
      "https://fonts.googleapis.com/css2?family=Jost:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap",
    ],
  },
  {
    theme: "Deco",
    urls: [
      "https://fonts.googleapis.com/css2?family=Josefin+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap",
      "https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap",
    ],
  },
  {
    theme: "Sakura",
    urls: [
      "https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,500;1,600;1,700;1,800&display=swap",
      "https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap",
    ],
  },
];

/**
 * Parse Google Fonts CSS response into individual @font-face blocks.
 * Only keeps blocks for the "latin" unicode range subset.
 */
function parseLatinFontFaces(css: string): string[] {
  const blocks: string[] = [];
  // Google Fonts CSS has comments like /* latin */ before each block
  // Split on @font-face and check the preceding comment
  const parts = css.split("@font-face");

  for (let i = 1; i < parts.length; i++) {
    const preceding = parts[i - 1];
    const block = parts[i];

    // Check if the preceding text ends with /* latin */
    const isLatin = /\/\*\s*latin\s*\*\/\s*$/.test(preceding);
    if (isLatin) {
      // Extract the block content between { and }
      const braceStart = block.indexOf("{");
      const braceEnd = block.lastIndexOf("}");
      if (braceStart !== -1 && braceEnd !== -1) {
        blocks.push("@font-face " + block.substring(0, braceEnd + 1));
      }
    }
  }
  return blocks;
}

/**
 * Extract font-family, weight, style, and woff2 URL from an @font-face block.
 */
function parseFontFace(block: string) {
  const familyMatch = block.match(/font-family:\s*'([^']+)'/);
  const weightMatch = block.match(/font-weight:\s*(\d+(?:\s+\d+)?)/);
  const styleMatch = block.match(/font-style:\s*(\w+)/);
  const urlMatch = block.match(/url\((https:\/\/[^)]+\.woff2)\)/);

  return {
    family: familyMatch?.[1] ?? "",
    weight: weightMatch?.[1] ?? "400",
    style: styleMatch?.[1] ?? "normal",
    url: urlMatch?.[1] ?? "",
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

async function downloadFont(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  writeFileSync(dest, Buffer.from(buffer));
}

async function main() {
  const cssOutput: string[] = [];
  let totalFiles = 0;

  for (const group of FONT_GROUPS) {
    console.log(`\n--- ${group.theme} theme ---`);
    cssOutput.push(`/* === ${group.theme} theme fonts === */\n`);

    for (const url of group.urls) {
      console.log(`Fetching CSS: ${url.substring(0, 80)}...`);
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) {
        console.error(`  FAILED: ${res.status}`);
        continue;
      }
      const css = await res.text();
      const latinBlocks = parseLatinFontFaces(css);
      console.log(`  Found ${latinBlocks.length} latin @font-face blocks`);

      for (const block of latinBlocks) {
        const info = parseFontFace(block);
        if (!info.url || !info.family) {
          console.error(`  Skipping block with missing data`);
          continue;
        }

        const dirName = slugify(info.family);
        const dir = join(FONTS_DIR, dirName);
        mkdirSync(dir, { recursive: true });

        // Build filename: family-weight-style.woff2
        // For variable fonts with weight ranges like "100 900", use "variable"
        const weightPart = info.weight.includes(" ") ? "variable" : info.weight;
        const fileName = `${dirName}-${weightPart}-${info.style}.woff2`;
        const filePath = join(dir, fileName);

        console.log(`  Downloading: ${dirName}/${fileName}`);
        await downloadFont(info.url, filePath);
        totalFiles++;

        // Rewrite the @font-face block with local path
        const localBlock = block.replace(
          /url\(https:\/\/[^)]+\.woff2\)/,
          `url('../fonts/${dirName}/${fileName}')`
        );
        // Remove unicode-range since we're only serving latin
        const cleanBlock = localBlock
          .replace(/\s*unicode-range:[^;]+;/, "")
          .replace(/font-display:\s*swap;/, "font-display: swap;");
        cssOutput.push(cleanBlock + "\n");
      }
    }
  }

  writeFileSync(CSS_OUTPUT, cssOutput.join("\n"));
  console.log(`\nDone! Downloaded ${totalFiles} woff2 files.`);
  console.log(`Generated ${CSS_OUTPUT}`);
}

main().catch(console.error);
