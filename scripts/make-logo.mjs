// Builds public/img/logo.png (1024x1024) from public/img/logo-source.jpg: face crop + neon ring.
// Upload the result as your Discord app icon and as a Rich Presence art asset named "logo".
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(ROOT, "public/img/logo-source.jpg")).toString("base64");

// crop window in the 735px source image, mapped onto the 880px circle
const crop = { x: 125, y: 20, size: 540 };
const scale = 880 / crop.size;
const img = { x: 72 - crop.x * scale, y: 72 - crop.y * scale, size: 735 * scale };

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%">
      <stop offset="0" stop-color="#2a1d5c"/><stop offset="1" stop-color="#05060f"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#f472b6"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".6" stop-color="#7c3aed" stop-opacity="0"/><stop offset="1" stop-color="#4c1d95" stop-opacity=".55"/>
    </linearGradient>
    <clipPath id="circle"><circle cx="512" cy="512" r="440"/></clipPath>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <g clip-path="url(#circle)">
    <image href="data:image/jpeg;base64,${src}" x="${img.x}" y="${img.y}" width="${img.size}" height="${img.size}"/>
    <rect width="1024" height="1024" fill="url(#fade)"/>
  </g>
  <circle cx="512" cy="512" r="452" fill="none" stroke="url(#ring)" stroke-width="26" filter="url(#glow)" opacity=".9"/>
  <circle cx="512" cy="512" r="452" fill="none" stroke="url(#ring)" stroke-width="14"/>
  <g transform="translate(838 838)">
    <circle r="92" fill="#05060f" stroke="url(#ring)" stroke-width="10"/>
    <path d="M0,-50 L34,0 L0,50 L-34,0 Z" fill="url(#ring)"/>
  </g>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
writeFileSync(path.join(ROOT, "public/img/logo.png"), png);
console.log("✓ wrote public/img/logo.png");
