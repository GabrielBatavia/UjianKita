/**
 * Official Safe Exam Browser (SEB) Verification & Configuration Generator.
 *
 * Implements Safe Exam Browser specification accurately:
 * 1. ConfigKey calculation from `.seb` XML plist dictionary:
 *    - Strip `originatorVersion` at root if present
 *    - Sort dictionary keys lexicographically (ordinal code-unit order)
 *    - Compact JSON with zero whitespace (`SEB-JSON`)
 *    - SHA-256 lowercase hexadecimal digest (64 hex chars)
 * 2. Request Hash verification (ConfigKeyHash & BrowserExamKeyHash):
 *    - Normalize absolute URL by stripping `#fragment` (including `#`)
 *    - Concatenate `normalizedUrl + keyHex` (URL first, UTF-8)
 *    - SHA-256 lowercase hexadecimal digest (64 hex chars)
 *    - Constant-time comparison via `crypto.timingSafeEqual`
 * 3. Honest trust separation:
 *    - `SafeExamBrowser.security.updateKeys` callback and verified headers can
 *      prove matching keys only when expected ConfigKey/BEK hashes exist.
 *    - User-Agent alone NEVER produces verified SEB trust.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { MonitoringTrustLevel } from "@/domain/monitoring/phase4-types";

const HEX_64_PATTERN = /^[a-f0-9]{64}$/i;

export function isValidSha256Hex(value: string | null | undefined): value is string {
  return typeof value === "string" && HEX_64_PATTERN.test(value.trim());
}

/**
 * Normalizes a URL for SEB request hash verification by stripping any `#fragment`
 * while preserving protocol, host, port, path, and query string verbatim.
 */
export function normalizeSebUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("URL SEB tidak boleh kosong.");
  }

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const hashIndex = trimmed.indexOf("#");
    return hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  }
}

function compareOrdinal(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Recursively canonicalizes a dictionary/value into compact SEB-JSON
 * with lexicographically sorted keys and zero extra whitespace.
 */
export function canonicalizeSebJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeSebJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((key) => {
        const val = obj[key];
        if (val === undefined) return false;
        // Per SEB Config Key specification, empty dictionaries are omitted recursively.
        if (
          val !== null &&
          typeof val === "object" &&
          !Array.isArray(val) &&
          !(val instanceof Date) &&
          canonicalizeSebJson(val) === "{}"
        ) {
          return false;
        }
        return true;
      })
      .sort(compareOrdinal);
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalizeSebJson(obj[key])}`
    );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").toLowerCase();
}

/**
 * Computes SEB ConfigKey from a parsed root configuration object.
 * Per SEB specification, `originatorVersion` is stripped from the root dict.
 */
export function computeSebConfigKeyFromObject(
  config: Record<string, unknown>
): string {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "originatorVersion") continue;
    sanitized[key] = value;
  }
  return sha256Hex(canonicalizeSebJson(sanitized));
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXmlEntities(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface XmlToken {
  type: "open" | "close" | "self" | "text";
  tag?: string;
  value?: string;
}

function tokenizePlistBody(xml: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  const cleaned = xml
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  let cursor = 0;
  while (cursor < cleaned.length) {
    const lt = cleaned.indexOf("<", cursor);
    if (lt < 0) {
      const trailing = cleaned.slice(cursor);
      if (trailing.trim()) {
        tokens.push({ type: "text", value: decodeXmlEntities(trailing) });
      }
      break;
    }
    if (lt > cursor) {
      const between = cleaned.slice(cursor, lt);
      tokens.push({ type: "text", value: decodeXmlEntities(between) });
    }
    const gt = cleaned.indexOf(">", lt);
    if (gt < 0) {
      throw new Error("Format XML plist SEB tidak valid.");
    }
    const inner = cleaned.slice(lt + 1, gt).trim();
    if (inner.startsWith("/")) {
      tokens.push({ type: "close", tag: inner.slice(1).trim().split(/\s+/)[0] });
    } else if (inner.endsWith("/")) {
      tokens.push({
        type: "self",
        tag: inner.slice(0, -1).trim().split(/\s+/)[0],
      });
    } else {
      tokens.push({ type: "open", tag: inner.split(/\s+/)[0] });
    }
    cursor = gt + 1;
  }
  return tokens;
}

function parsePlistValue(tokens: XmlToken[], indexRef: { idx: number }): unknown {
  while (indexRef.idx < tokens.length) {
    const token = tokens[indexRef.idx];
    if (!token) break;
    if (token.type === "text" && !(token.value ?? "").trim()) {
      indexRef.idx++;
      continue;
    }
    if (token.type === "self") {
      indexRef.idx++;
      if (token.tag === "true") return true;
      if (token.tag === "false") return false;
      if (token.tag === "dict") return {};
      if (token.tag === "array") return [];
      if (token.tag === "string") return "";
      if (token.tag === "data") return "";
      return null;
    }
    if (token.type === "open") {
      const tag = token.tag;
      indexRef.idx++;

      if (tag === "dict") {
        const result: Record<string, unknown> = {};
        while (indexRef.idx < tokens.length) {
          const next = tokens[indexRef.idx];
          if (!next) break;
          if (next.type === "text" && !(next.value ?? "").trim()) {
            indexRef.idx++;
            continue;
          }
          if (next.type === "close" && next.tag === "dict") {
            indexRef.idx++;
            return result;
          }
          if (next.type !== "open" || next.tag !== "key") {
            throw new Error("Struktur <dict> plist SEB tidak valid: diharapkan <key>.");
          }
          indexRef.idx++;
          let keyName = "";
          while (indexRef.idx < tokens.length) {
            const innerTok = tokens[indexRef.idx];
            if (!innerTok) break;
            if (innerTok.type === "close" && innerTok.tag === "key") break;
            if (innerTok.type === "text") {
              keyName += innerTok.value ?? "";
            }
            indexRef.idx++;
          }
          indexRef.idx++; // consume </key>
          result[keyName] = parsePlistValue(tokens, indexRef);
        }
        throw new Error("Tag </dict> tidak ditemukan pada plist SEB.");
      }

      if (tag === "array") {
        const items: unknown[] = [];
        while (indexRef.idx < tokens.length) {
          const next = tokens[indexRef.idx];
          if (!next) break;
          if (next.type === "text" && !(next.value ?? "").trim()) {
            indexRef.idx++;
            continue;
          }
          if (next.type === "close" && next.tag === "array") {
            indexRef.idx++;
            return items;
          }
          items.push(parsePlistValue(tokens, indexRef));
        }
        throw new Error("Tag </array> tidak ditemukan pada plist SEB.");
      }

      // Scalar element
      let text = "";
      while (indexRef.idx < tokens.length) {
        const innerTok = tokens[indexRef.idx];
        if (!innerTok) break;
        if (innerTok.type === "close" && innerTok.tag === tag) break;
        if (innerTok.type === "text") {
          text += innerTok.value ?? "";
        }
        indexRef.idx++;
      }
      if (indexRef.idx < tokens.length) {
        indexRef.idx++; // consume close tag
      }

      if (tag === "integer" || tag === "real") {
        const num = Number(text.trim());
        return Number.isFinite(num) ? num : text.trim();
      }
      if (tag === "data") {
        return text.replace(/\s+/g, "");
      }
      return text;
    }

    indexRef.idx++;
  }
  return {};
}

export function parseSebPlistXml(plistXml: string): Record<string, unknown> {
  const tokens = tokenizePlistBody(plistXml);
  const indexRef = { idx: 0 };

  while (indexRef.idx < tokens.length) {
    const token = tokens[indexRef.idx];
    if (token && token.type === "open" && token.tag === "plist") {
      indexRef.idx++;
      const parsed = parsePlistValue(tokens, indexRef);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throw new Error("Elemen akar plist SEB harus berupa <dict>.");
    }
    indexRef.idx++;
  }
  throw new Error("Tag <plist> tidak ditemukan.");
}

export function computeSebConfigKeyFromPlistXml(plistXml: string): string {
  const dict = parseSebPlistXml(plistXml);
  return computeSebConfigKeyFromObject(dict);
}

/**
 * Official SEB Request Hash computation:
 * SHA-256(normalizedUrl + keyHex) in UTF-8, lowercase hex.
 */
export function computeSebRequestHash(
  normalizedUrl: string,
  keyHex: string
): string {
  const cleanUrl = normalizeSebUrl(normalizedUrl);
  const cleanKey = keyHex.trim().toLowerCase();
  if (!isValidSha256Hex(cleanKey)) {
    throw new Error("Kunci SEB harus berupa 64 karakter heksadesimal SHA-256.");
  }
  return sha256Hex(`${cleanUrl}${cleanKey}`);
}

export function constantTimeHexEquals(a: string, b: string): boolean {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (!isValidSha256Hex(normA) || !isValidSha256Hex(normB)) {
    return false;
  }
  const bufA = Buffer.from(normA, "utf8");
  const bufB = Buffer.from(normB, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export interface SebVerificationInput {
  requestUrl: string;
  expectedOrigin: string;
  examId: string;
  expectedConfigKeyHex: string | null;
  expectedBrowserExamKeyHex: string | null;
  submittedConfigKeyHash?: string | null;
  submittedBrowserExamKeyHash?: string | null;
  headerConfigKeyHash?: string | null;
  headerRequestHash?: string | null;
}

export interface SebVerificationOutcome {
  verified: boolean;
  trustLevel: MonitoringTrustLevel;
  matchedConfigKey: boolean;
  matchedBrowserExamKey: boolean;
  normalizedUrl: string | null;
  reason: string;
}

/**
 * Validates that the URL used in a SEB proof belongs to our origin and the
 * target exam namespace so proofs cannot be replayed from arbitrary URLs.
 */
export function isAllowedSebProofUrl(
  rawUrl: string,
  expectedOrigin: string,
  examId: string
): boolean {
  try {
    const parsed = new URL(normalizeSebUrl(rawUrl));
    const expected = new URL(expectedOrigin);
    if (parsed.origin !== expected.origin) {
      return false;
    }
    const allowedPrefix = `/student/exams/${examId}`;
    const apiPrefix = `/api/student/exams/${examId}`;
    return (
      parsed.pathname.startsWith(allowedPrefix) ||
      parsed.pathname.startsWith(apiPrefix)
    );
  } catch {
    return false;
  }
}

export function verifySebKeyProof(
  input: SebVerificationInput
): SebVerificationOutcome {
  if (!input.expectedConfigKeyHex && !input.expectedBrowserExamKeyHex) {
    return {
      verified: false,
      trustLevel: "standard_browser",
      matchedConfigKey: false,
      matchedBrowserExamKey: false,
      normalizedUrl: null,
      reason: "Kunci ConfigKey atau Browser Exam Key belum dikonfigurasi pada ujian ini.",
    };
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeSebUrl(input.requestUrl);
  } catch {
    return {
      verified: false,
      trustLevel: "standard_browser",
      matchedConfigKey: false,
      matchedBrowserExamKey: false,
      normalizedUrl: null,
      reason: "URL verifikasi SEB tidak valid.",
    };
  }

  if (!isAllowedSebProofUrl(normalizedUrl, input.expectedOrigin, input.examId)) {
    return {
      verified: false,
      trustLevel: "standard_browser",
      matchedConfigKey: false,
      matchedBrowserExamKey: false,
      normalizedUrl,
      reason: "URL bukti SEB tidak cocok dengan origin atau identitas ujian aktif.",
    };
  }

  let matchedConfigKey = false;
  let matchedBrowserExamKey = false;
  let viaHeader = false;
  let viaJsApi = false;

  if (isValidSha256Hex(input.expectedConfigKeyHex)) {
    const expectedHash = computeSebRequestHash(
      normalizedUrl,
      input.expectedConfigKeyHex
    );
    if (
      input.headerConfigKeyHash &&
      constantTimeHexEquals(input.headerConfigKeyHash, expectedHash)
    ) {
      matchedConfigKey = true;
      viaHeader = true;
    }
    if (
      input.submittedConfigKeyHash &&
      constantTimeHexEquals(input.submittedConfigKeyHash, expectedHash)
    ) {
      matchedConfigKey = true;
      viaJsApi = true;
    }
  }

  if (isValidSha256Hex(input.expectedBrowserExamKeyHex)) {
    const expectedHash = computeSebRequestHash(
      normalizedUrl,
      input.expectedBrowserExamKeyHex
    );
    if (
      input.headerRequestHash &&
      constantTimeHexEquals(input.headerRequestHash, expectedHash)
    ) {
      matchedBrowserExamKey = true;
      viaHeader = true;
    }
    if (
      input.submittedBrowserExamKeyHash &&
      constantTimeHexEquals(input.submittedBrowserExamKeyHash, expectedHash)
    ) {
      matchedBrowserExamKey = true;
      viaJsApi = true;
    }
  }

  const requiresConfig = isValidSha256Hex(input.expectedConfigKeyHex);
  const requiresBek = isValidSha256Hex(input.expectedBrowserExamKeyHex);

  const verified =
    (!requiresConfig || matchedConfigKey) && (!requiresBek || matchedBrowserExamKey);

  if (!verified) {
    return {
      verified: false,
      trustLevel: "standard_browser",
      matchedConfigKey,
      matchedBrowserExamKey,
      normalizedUrl,
      reason:
        "Hash ConfigKey atau Browser Exam Key SEB tidak cocok dengan konfigurasi ujian.",
    };
  }

  return {
    verified: true,
    trustLevel: viaHeader
      ? "verified_seb_header_and_key"
      : viaJsApi
        ? "verified_seb_js_key"
        : "standard_browser",
    matchedConfigKey,
    matchedBrowserExamKey,
    normalizedUrl,
    reason: "Bukti kunci Safe Exam Browser terverifikasi.",
  };
}

export interface SebProfileXmlResult {
  plistXml: string;
  configObject: Record<string, unknown>;
  configKeyHex: string;
}

/**
 * Generates an official `.seb` XML plist profile and computes its exact
 * ConfigKey SHA-256 digest using SEB-JSON canonicalization.
 */
export function buildSebExamProfile(params: {
  startUrl: string;
  examTitle: string;
  allowReload?: boolean;
}): SebProfileXmlResult {
  const cleanStartUrl = normalizeSebUrl(params.startUrl);
  const allowReload = params.allowReload ?? true;

  const configObject: Record<string, unknown> = {
    allowQuit: true,
    allowSpellCheck: false,
    browserWindowAllowReload: allowReload,
    examSessionClearCookiesOnEnd: false,
    examSessionClearCookiesOnStart: false,
    quitURLConfirm: true,
    sendBrowserExamKey: true,
    showReloadButton: allowReload,
    showTaskBar: true,
    startURL: cleanStartUrl,
    startURLAllowReload: allowReload,
    URLFilterEnable: false,
  };

  const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<!-- UjianKita SEB Profile: ${encodeXmlEntities(params.examTitle)} -->
<dict>
  <key>URLFilterEnable</key>
  <false/>
  <key>allowQuit</key>
  <true/>
  <key>allowSpellCheck</key>
  <false/>
  <key>browserWindowAllowReload</key>
  <${allowReload ? "true" : "false"}/>
  <key>examSessionClearCookiesOnEnd</key>
  <false/>
  <key>examSessionClearCookiesOnStart</key>
  <false/>
  <key>quitURLConfirm</key>
  <true/>
  <key>sendBrowserExamKey</key>
  <true/>
  <key>showReloadButton</key>
  <${allowReload ? "true" : "false"}/>
  <key>showTaskBar</key>
  <true/>
  <key>startURL</key>
  <string>${encodeXmlEntities(cleanStartUrl)}</string>
  <key>startURLAllowReload</key>
  <${allowReload ? "true" : "false"}/>
</dict>
</plist>
`;

  const configKeyHex = computeSebConfigKeyFromPlistXml(plistXml);
  return { plistXml, configObject, configKeyHex };
}

export function buildSebLaunchLinks(origin: string, examId: string): {
  configDownloadUrl: string;
  launchUrl: string;
} {
  const configPath = `/api/student/exams/${examId}/seb-config`;
  const parsedOrigin = new URL(origin);
  const protocol = parsedOrigin.protocol === "http:" ? "seb:" : "sebs:";
  return {
    configDownloadUrl: `${parsedOrigin.origin}${configPath}`,
    launchUrl: `${protocol}//${parsedOrigin.host}${configPath}`,
  };
}
