/**
 * Android ExamBro (com.dekikurnia.exambro) Compatibility & Scannable QR Helper.
 *
 * ExamBro on Android wraps a mobile WebView to restrict split-screen,
 * screenshots (FLAG_SECURE), and notifications during a test, and opens exam
 * URLs either via direct link input or QR scan. It provides NO cryptographic
 * backend challenge-response protocol, so any signal from User-Agent or JS
 * client hints MUST strictly be classified as `unverified_client_hint`.
 */

import type { MonitoringBrowserPlatform, MonitoringTrustLevel } from "@/domain/monitoring/phase4-types";

export const EXAMBRO_PACKAGE_ID = "com.dekikurnia.exambro";
export const EXAMBRO_GOOGLE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.dekikurnia.exambro";

export interface ExamBroHintAssessment {
  platform: MonitoringBrowserPlatform;
  trustLevel: MonitoringTrustLevel;
  detectedViaHint: boolean;
  canServeAsCryptographicProof: false;
  label: string;
  explanation: string;
}

export function assessExamBroClientHint(params: {
  userAgent: string | null | undefined;
  declaredPlatform?: MonitoringBrowserPlatform | null;
  exambroDetectedHint?: boolean;
}): ExamBroHintAssessment {
  const ua = (params.userAgent ?? "").toLowerCase();
  const uaLooksLikeExamBro =
    ua.includes("exambro") ||
    ua.includes("dekikurnia") ||
    ua.includes(EXAMBRO_PACKAGE_ID);

  const clientDeclared =
    params.exambroDetectedHint === true ||
    params.declaredPlatform === "ANDROID_EXAMBRO";

  if (uaLooksLikeExamBro || clientDeclared) {
    return {
      platform: "ANDROID_EXAMBRO",
      trustLevel: "unverified_client_hint",
      detectedViaHint: true,
      canServeAsCryptographicProof: false,
      label: "Petunjuk Klien ExamBro (Tidak Terverifikasi Kriptografis)",
      explanation:
        "Perangkat melaporkan sinyal atau User-Agent yang konsisten dengan ExamBro Android, namun aplikasi tidak memiliki protokol bukti kriptografis sehingga status tetap diklasifikasikan sebagai petunjuk klien.",
    };
  }

  return {
    platform: "STANDARD_WEB",
    trustLevel: "standard_browser",
    detectedViaHint: false,
    canServeAsCryptographicProof: false,
    label: "Peramban Web Standar",
    explanation:
      "Siswa mengakses ujian menggunakan peramban web standar tanpa tanda Safe Exam Browser terverifikasi.",
  };
}

// =============================================================================
// Minimal ISO/IEC 18004 Byte-Mode QR Code Generator (Version 1–10, ECC Level L)
// Pure TypeScript, zero external dependencies, deterministic SVG output.
// =============================================================================

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255] ?? 0;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)] ?? 0;
}

function computeRsGenerator(eccCount: number): Uint8Array {
  let poly: Uint8Array = new Uint8Array([1]);
  for (let i = 0; i < eccCount; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i] ?? 1;
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j] ?? 0;
      next[j] = (next[j] ?? 0) ^ p;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(p, factor);
    }
    poly = next;
  }
  return poly;
}

function computeRsEcc(data: Uint8Array, eccCount: number): Uint8Array {
  const gen = computeRsGenerator(eccCount);
  const buffer = new Uint8Array(data.length + eccCount);
  buffer.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = buffer[i] ?? 0;
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        buffer[i + j] = (buffer[i + j] ?? 0) ^ gfMul(gen[j] ?? 0, coef);
      }
    }
  }
  return buffer.slice(data.length);
}

interface QrVersionSpec {
  version: number;
  size: number;
  dataCodewords: number;
  eccCodewordsPerBlock: number;
  blocksGroup1: number;
  dataPerBlock1: number;
  blocksGroup2: number;
  dataPerBlock2: number;
  alignmentCenters: number[];
}

// ISO/IEC 18004 Level L capacities up to Version 10 (up to 271 bytes)
const QR_LEVEL_L_SPECS: readonly QrVersionSpec[] = [
  { version: 1, size: 21, dataCodewords: 19, eccCodewordsPerBlock: 7, blocksGroup1: 1, dataPerBlock1: 19, blocksGroup2: 0, dataPerBlock2: 0, alignmentCenters: [] },
  { version: 2, size: 25, dataCodewords: 34, eccCodewordsPerBlock: 10, blocksGroup1: 1, dataPerBlock1: 34, blocksGroup2: 0, dataPerBlock2: 0, alignmentCenters: [6, 18] },
  { version: 3, size: 29, dataCodewords: 55, eccCodewordsPerBlock: 15, blocksGroup1: 1, dataPerBlock1: 55, blocksGroup2: 0, dataPerBlock2: 0, alignmentCenters: [6, 22] },
  { version: 4, size: 33, dataCodewords: 80, eccCodewordsPerBlock: 20, blocksGroup1: 1, dataPerBlock1: 80, blocksGroup2: 0, dataPerBlock2: 0, alignmentCenters: [6, 26] },
  { version: 5, size: 37, dataCodewords: 108, eccCodewordsPerBlock: 26, blocksGroup1: 1, dataPerBlock1: 108, blocksGroup2: 0, dataPerBlock2: 0, alignmentCenters: [6, 30] },
  { version: 6, size: 41, dataCodewords: 136, eccCodewordsPerBlock: 18, blocksGroup1: 2, dataPerBlock1: 68, blocksGroup2: 0, dataPerBlock2: 0, alignmentCenters: [6, 34] },
  { version: 7, size: 45, dataCodewords: 156, eccCodewordsPerBlock: 20, blocksGroup1: 2, dataPerBlock1: 78, blocksGroup2: 0, dataPerBlock2: 0, alignmentCenters: [6, 22, 38] },
  { version: 8, size: 49, dataCodewords: 194, eccCodewordsPerBlock: 24, blocksGroup1: 2, dataPerBlock1: 97, blocksGroup2: 0, dataPerBlock2: 0, alignmentCenters: [6, 24, 42] },
  { version: 9, size: 53, dataCodewords: 232, eccCodewordsPerBlock: 30, blocksGroup1: 2, dataPerBlock1: 116, blocksGroup2: 0, dataPerBlock2: 0, alignmentCenters: [6, 26, 46] },
  { version: 10, size: 57, dataCodewords: 274, eccCodewordsPerBlock: 18, blocksGroup1: 2, dataPerBlock1: 68, blocksGroup2: 2, dataPerBlock2: 69, alignmentCenters: [6, 28, 50] },
];

function selectQrVersion(byteLen: number): QrVersionSpec {
  for (const spec of QR_LEVEL_L_SPECS) {
    const charCountBits = spec.version <= 9 ? 8 : 16;
    const totalBitsNeeded = 4 + charCountBits + byteLen * 8;
    if (totalBitsNeeded <= spec.dataCodewords * 8) {
      return spec;
    }
  }
  throw new Error("URL terlalu panjang untuk QR Code ExamBro (maksimum 271 byte).");
}

function encodeQrBitStream(bytes: Uint8Array, spec: QrVersionSpec): Uint8Array {
  const bits: number[] = [];
  const pushBits = (val: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // Byte mode indicator (0100)
  pushBits(0b0100, 4);
  pushBits(bytes.length, spec.version <= 9 ? 8 : 16);
  for (const b of bytes) {
    pushBits(b, 8);
  }

  const maxBits = spec.dataCodewords * 8;
  const terminator = Math.min(4, maxBits - bits.length);
  pushBits(0, terminator);
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const data = new Uint8Array(spec.dataCodewords);
  let byteIdx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) {
      val = (val << 1) | (bits[i + j] ?? 0);
    }
    data[byteIdx++] = val;
  }

  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (byteIdx < spec.dataCodewords) {
    data[byteIdx++] = padBytes[padIdx++ % 2] ?? 0xec;
  }

  // Split into RS blocks & interleave
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let b = 0; b < spec.blocksGroup1; b++) {
    const slice = data.slice(offset, offset + spec.dataPerBlock1);
    offset += spec.dataPerBlock1;
    dataBlocks.push(slice);
    eccBlocks.push(computeRsEcc(slice, spec.eccCodewordsPerBlock));
  }
  for (let b = 0; b < spec.blocksGroup2; b++) {
    const slice = data.slice(offset, offset + spec.dataPerBlock2);
    offset += spec.dataPerBlock2;
    dataBlocks.push(slice);
    eccBlocks.push(computeRsEcc(slice, spec.eccCodewordsPerBlock));
  }

  const totalCodewords =
    spec.dataCodewords +
    (spec.blocksGroup1 + spec.blocksGroup2) * spec.eccCodewordsPerBlock;
  const interleaved = new Uint8Array(totalCodewords);
  let outIdx = 0;

  const maxDataBlockLen = Math.max(spec.dataPerBlock1, spec.dataPerBlock2);
  for (let i = 0; i < maxDataBlockLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) interleaved[outIdx++] = blk[i] ?? 0;
    }
  }
  for (let i = 0; i < spec.eccCodewordsPerBlock; i++) {
    for (const ecc of eccBlocks) {
      interleaved[outIdx++] = ecc[i] ?? 0;
    }
  }
  return interleaved;
}

function buildQrMatrix(text: string): { size: number; modules: boolean[][] } {
  const bytes = new TextEncoder().encode(text);
  const spec = selectQrVersion(bytes.length);
  const codewords = encodeQrBitStream(bytes, spec);
  const size = spec.size;

  const modules: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false)
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false)
  );

  const getFn = (row: number, col: number): boolean =>
    Boolean(isFunction[row]?.[col]);

  const setModule = (row: number, col: number, dark: boolean) => {
    const r = modules[row];
    if (r && col >= 0 && col < size) r[col] = dark;
  };

  const setFn = (row: number, col: number, dark: boolean) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    setModule(row, col, dark);
    const f = isFunction[row];
    if (f) f[col] = true;
  };

  // Finder patterns + separators
  const drawFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inBorder =
          dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6);
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFn(r, c, inBorder || inCenter);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Alignment patterns
  const centers = spec.alignmentCenters;
  for (const r of centers) {
    for (const c of centers) {
      if (
        (r === 6 && c === 6) ||
        (r === 6 && c === size - 7) ||
        (r === size - 7 && c === 6)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark =
            Math.max(Math.abs(dr), Math.abs(dc)) === 2 || (dr === 0 && dc === 0);
          setFn(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    if (!getFn(6, i)) setFn(6, i, dark);
    if (!getFn(i, 6)) setFn(i, 6, dark);
  }

  // Dark module & reserve format info areas
  setFn(4 * spec.version + 9, 8, true);
  for (let i = 0; i <= 8; i++) {
    if (!getFn(8, i)) setFn(8, i, false);
    if (!getFn(i, 8)) setFn(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!getFn(8, size - 1 - i)) setFn(8, size - 1 - i, false);
    if (i < 7 && !getFn(size - 1 - i, 8)) setFn(size - 1 - i, 8, false);
  }

  // Reserve version info for version >= 7
  if (spec.version >= 7) {
    let rem = spec.version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const verBits = (spec.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((verBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  // Place data bits in zig-zag order
  const bitQueue: boolean[] = [];
  for (const byte of codewords) {
    for (let b = 7; b >= 0; b--) {
      bitQueue.push(((byte >> b) & 1) === 1);
    }
  }
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (!getFn(row, col)) {
          const dataBit = bitIdx < bitQueue.length ? Boolean(bitQueue[bitIdx++]) : false;
          // Apply mask pattern 0: (row + col) % 2 === 0
          setModule(row, col, dataBit !== ((row + col) % 2 === 0));
        }
      }
    }
  }

  // Format bits for Error Correction Level L (01) + Mask 0 (000) -> data = 0b01000 = 8
  const formatData = (0b01 << 3) | 0;
  let rem = formatData;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  const formatBits = ((formatData << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) setFn(8, i, ((formatBits >>> i) & 1) === 1);
  setFn(8, 7, ((formatBits >>> 6) & 1) === 1);
  setFn(8, 8, ((formatBits >>> 7) & 1) === 1);
  setFn(7, 8, ((formatBits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) {
    setFn(14 - i, 8, ((formatBits >>> i) & 1) === 1);
  }
  for (let i = 0; i < 8; i++) {
    setFn(8, size - 1 - i, ((formatBits >>> i) & 1) === 1);
  }
  for (let i = 8; i < 15; i++) {
    setFn(size - 15 + i, 8, ((formatBits >>> i) & 1) === 1);
  }

  return { size, modules };
}

/**
 * Generates an accessible, scannable ISO/IEC 18004 QR Code SVG for an exam URL
 * so proctors/students can scan directly using Android ExamBro.
 */
export function generateQrCodeSvg(
  text: string,
  options?: { sizePx?: number; quietZone?: number; ariaLabel?: string }
): string {
  const { size, modules } = buildQrMatrix(text);
  const quiet = options?.quietZone ?? 4;
  const viewSize = size + quiet * 2;
  const sizePx = options?.sizePx ?? 220;
  const label = (options?.ariaLabel ?? "Kode QR tautan ujian untuk ExamBro")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const rects: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r]?.[c]) {
        rects.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="${sizePx}" height="${sizePx}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#ffffff"/><path d="${rects.join("")}" fill="#0f172a"/></svg>`;
}
