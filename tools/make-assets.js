#!/usr/bin/env node
/**
 * Regenerates the image assets in assets/ from the HTML templates next to this
 * file. Run it only when a template changes — the PNGs are committed, so a
 * normal `node build.js` needs no browser and no network.
 *
 *   node tools/make-assets.js
 *
 * Rasterising uses headless Edge/Chrome, the only thing on a normal machine
 * that turns our CSS into a pixel-exact PNG without adding a dependency.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "assets");

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) {
  console.error("No Edge/Chrome found. assets/ is committed, so this is only needed when a template changes.");
  process.exit(1);
}

const shot = (tpl, out, w, h, transparent) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pipo-assets-"));
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--force-device-scale-factor=1",
    "--user-data-dir=" + profile,
    "--window-size=" + w + "," + h,
    "--screenshot=" + out,
  ];
  if (transparent) args.push("--default-background-color=00000000");
  args.push("file:///" + path.join(__dirname, tpl).replace(/\\/g, "/"));
  execFileSync(browser, args, { stdio: "ignore" });
  fs.rmSync(profile, { recursive: true, force: true });
  console.log("  " + path.relative(ROOT, out).replace(/\\/g, "/") + "  " + (fs.statSync(out).size / 1024).toFixed(1) + " KB");
};

/* ---- just enough PNG to downscale our own icons ------------------------- */
/* One browser render is the single source of truth; the smaller sizes are    */
/* averaged down from it, so every icon is pixel-identical in shape.          */

let CRC_TABLE = null;
const crc32 = (buf) => {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const readPNG = (file) => {
  const buf = fs.readFileSync(file);
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error("unsupported PNG: bitDepth " + bitDepth + ", colorType " + colorType);
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      px[o] = line[x * ch];
      px[o + 1] = line[x * ch + 1];
      px[o + 2] = line[x * ch + 2];
      px[o + 3] = ch === 4 ? line[x * ch + 3] : 255;
    }
    prev = line;
  }
  return { width, height, px };
};

const writePNG = ({ width, height, px }) => {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, "ascii");
    data.copy(b, 8);
    b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// Box filter. Sources are exact multiples of every target, so this averages
// whole blocks with no resampling artefacts. Alpha is premultiplied during the
// average and divided back out, so edges do not darken.
const resize = (src, size) => {
  const px = Buffer.alloc(size * size * 4);
  const f = src.width / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(y * f); sy < Math.floor((y + 1) * f); sy++) {
        for (let sx = Math.floor(x * f); sx < Math.floor((x + 1) * f); sx++) {
          const i = (sy * src.width + sx) * 4;
          const al = src.px[i + 3] / 255;
          r += src.px[i] * al;
          g += src.px[i + 1] * al;
          b += src.px[i + 2] * al;
          a += src.px[i + 3];
          n++;
        }
      }
      const o = (y * size + x) * 4;
      const avgA = a / n;
      const unmul = a > 0 ? (n * 255) / a : 0;
      px[o] = Math.round((r / n) * unmul);
      px[o + 1] = Math.round((g / n) * unmul);
      px[o + 2] = Math.round((b / n) * unmul);
      px[o + 3] = Math.round(avgA);
    }
  }
  return { width: size, height: size, px };
};

// ICO holding PNG frames — read by every browser since IE11, and what a bare
// request for /favicon.ico gets served.
const buildICO = (frames) => {
  const head = Buffer.alloc(6 + frames.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach((f, i) => {
    const e = 6 + i * 16;
    head[e] = f.size >= 256 ? 0 : f.size;      // width  (0 means 256)
    head[e + 1] = f.size >= 256 ? 0 : f.size;  // height
    head.writeUInt16LE(1, e + 4);              // colour planes
    head.writeUInt16LE(32, e + 6);             // bits per pixel
    head.writeUInt32LE(f.data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += f.data.length;
  });
  return Buffer.concat([head, ...frames.map((f) => f.data)]);
};

fs.mkdirSync(OUT, { recursive: true });
console.log("Rendering with " + path.basename(browser) + "…");

shot("og-card.html", path.join(OUT, "social-card.png"), 1200, 630, false);
shot("icon-card.html", path.join(OUT, "icon-512.png"), 512, 512, true);
shot("icon-maskable.html", path.join(OUT, "icon-maskable-512.png"), 512, 512, false);

const src = readPNG(path.join(OUT, "icon-512.png"));
[[192, "icon-192.png"], [180, "apple-touch-icon.png"]].forEach(([size, name]) => {
  fs.writeFileSync(path.join(OUT, name), writePNG(resize(src, size)));
  console.log("  assets/" + name);
});

const ico = buildICO([16, 32, 48].map((size) => ({ size, data: writePNG(resize(src, size)) })));
fs.writeFileSync(path.join(ROOT, "favicon.ico"), ico);
console.log("  favicon.ico  " + (ico.length / 1024).toFixed(1) + " KB");
console.log("done");
