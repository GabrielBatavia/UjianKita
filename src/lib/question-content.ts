import katex from "katex";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEscapedProse(escaped: string): string {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+?)`/g, '<code class="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">$1</code>')
    .replace(/\r?\n/g, "<br />");
}

/**
 * Renders question stems, options, and explanations safely with KaTeX math support
 * (`$$...$$` display and `$...$` inline). All non-math text is strictly HTML-escaped
 * first and KaTeX runs with `trust: false` to prevent XSS.
 */
export function renderSafeQuestionHtml(rawInput: string): string {
  const input = rawInput ?? "";
  if (!input.trim()) return "";

  const tokenPattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  let lastIndex = 0;
  let output = "";

  for (const match of input.matchAll(tokenPattern)) {
    const matchText = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      output += formatEscapedProse(escapeHtml(input.slice(lastIndex, start)));
    }

    const isDisplay = matchText.startsWith("$$") && matchText.endsWith("$$");
    const tex = isDisplay ? matchText.slice(2, -2).trim() : matchText.slice(1, -1).trim();

    if (tex.length > 0) {
      try {
        output += katex.renderToString(tex, {
          displayMode: isDisplay,
          throwOnError: false,
          strict: false,
          trust: false,
        });
      } catch {
        output += formatEscapedProse(escapeHtml(matchText));
      }
    } else {
      output += formatEscapedProse(escapeHtml(matchText));
    }

    lastIndex = start + matchText.length;
  }

  if (lastIndex < input.length) {
    output += formatEscapedProse(escapeHtml(input.slice(lastIndex)));
  }

  return output;
}

export function sanitizePlainQuestionText(raw: string): string {
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}
