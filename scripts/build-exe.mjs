// Builds dist/GrindTracker.exe: one file, no Node install needed, no console window.
//
//   1. bundle server.js + dependencies into one CommonJS file (esbuild)
//   2. pack it with the dashboard files into a Node "single executable application" blob
//   3. copy this machine's node.exe, give it our icon + version info, inject the blob
//   4. flip the exe to the Windows GUI subsystem so no black console window opens
//
// Run on Windows with the same Node version you want to ship: npm run build:exe
import { build } from "esbuild";
import { inject } from "postject";
import { rcedit } from "rcedit";
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("The exe can only be built on Windows");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const { version } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const EXE = path.join(DIST, "GrindTracker.exe");
const step = (msg) => console.log(`\n▸ ${msg}`);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);

step("Bundling server");
await build({
  entryPoints: [path.join(ROOT, "server.js")],
  outfile: path.join(DIST, "bundle.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "process.env.GT_VERSION": JSON.stringify(version) },
  // desktop.js only reads import.meta.url when *not* packaged
  logOverride: { "empty-import-meta": "silent" },
  logLevel: "warning",
});

step("Collecting dashboard files");
const assets = { ".env.example": path.join(ROOT, ".env.example") };
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name !== ".gitkeep") assets[path.relative(ROOT, full).split(path.sep).join("/")] = full;
  }
})(path.join(ROOT, "public"));
console.log(`  ${Object.keys(assets).length} files`);

step("Creating the app blob");
const seaConfig = path.join(DIST, "sea-config.json");
const blob = path.join(DIST, "sea-prep.blob");
writeFileSync(seaConfig, JSON.stringify({ main: path.join(DIST, "bundle.cjs"), output: blob, disableExperimentalSEAWarning: true, useCodeCache: true, assets }, null, 2));
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

step("Preparing the exe");
copyFileSync(process.execPath, EXE);
stripSignature(EXE); // node.exe's signature breaks once we change it; a broken one looks worse than none

const icon = path.join(DIST, "icon.ico");
writeFileSync(icon, makeIco(readFileSync(path.join(ROOT, "public/img/logo.png")), [16, 24, 32, 48, 64, 128, 256]));
await rcedit(EXE, {
  icon,
  "file-version": version,
  "product-version": version,
  "version-string": {
    ProductName: "Grind Tracker",
    FileDescription: "Grind Tracker - study + gaming stats on your Discord profile",
    OriginalFilename: "GrindTracker.exe",
    InternalName: "GrindTracker",
    CompanyName: "Grind Tracker",
    LegalCopyright: "github.com/jjtjtyt6644/Discord-study-grind-tracker",
  },
});

step("Injecting the app");
await inject(EXE, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2" });
setGuiSubsystem(EXE);

for (const f of ["bundle.cjs", "sea-config.json", "sea-prep.blob"]) rmSync(path.join(DIST, f));
console.log(`\n✓ ${path.relative(ROOT, EXE)} (${(statSync(EXE).size / 1048576).toFixed(1)} MB, v${version})`);

// ---------- PE helpers ----------

// PE header offsets: e_lfanew at 0x3C → "PE\0\0" + 20-byte COFF header → optional header
function peOptionalHeader(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x4550) throw new Error("not a PE file");
  return pe + 24;
}

// Remove the Authenticode certificate (data directory #4) - same as `signtool remove /s`.
function stripSignature(file) {
  let buf = readFileSync(file);
  const opt = peOptionalHeader(buf);
  const isPE32Plus = buf.readUInt16LE(opt) === 0x20b;
  const certDir = opt + (isPE32Plus ? 112 : 96) + 4 * 8;
  const offset = buf.readUInt32LE(certDir);
  const size = buf.readUInt32LE(certDir + 4);
  if (!offset || !size) return;
  buf.writeUInt32LE(0, certDir);
  buf.writeUInt32LE(0, certDir + 4);
  if (offset + size >= buf.length - 8) buf = buf.subarray(0, offset); // the certificate is the file's tail
  writeFileSync(file, buf);
}

// Subsystem lives at optional header + 68 for both PE32 and PE32+: 2 = Windows GUI, 3 = console.
function setGuiSubsystem(file) {
  const buf = readFileSync(file);
  buf.writeUInt16LE(2, peOptionalHeader(buf) + 68);
  writeFileSync(file, buf);
}

// .ico with PNG-compressed images (supported since Windows Vista)
function makeIco(png, sizes) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><image href="data:image/png;base64,${png.toString("base64")}" width="1024" height="1024"/></svg>`;
  const images = sizes.map((s) => new Resvg(svg, { fitTo: { mode: "width", value: s } }).render().asPng());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s >= 256 ? 0 : s, e); // 0 means 256
    header.writeUInt8(s >= 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(images[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}
