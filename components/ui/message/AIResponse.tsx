"use client";

import { useState } from "react";

/**
 * AIResponse — renders the /ai bot reply with ChatGPT-style formatting.
 *
 * Supports a lightweight subset of Markdown without external deps:
 *   - fenced code blocks (```lang ... ```) with a copy button
 *   - inline code (`code`)
 *   - bold (**text**)
 *   - italic (*text*)
 *   - links ([text](url))
 *   - unordered (- / * item) and ordered (1. item) lists
 *   - ### headings
 *   - paragraphs and line breaks
 */

// ---- Inline tokenizer (bold / italic / inline-code / links) ----

interface InlineToken {
  type: "text" | "bold" | "italic" | "code" | "link";
  value: string;
  href?: string;
}

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;

  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, m.index) });
    }
    const [full, code, bold, italic, link] = m;
    if (code) tokens.push({ type: "code", value: code.slice(1, -1) });
    else if (bold) tokens.push({ type: "bold", value: bold.slice(2, -2) });
    else if (italic) tokens.push({ type: "italic", value: italic.slice(1, -1) });
    else if (link) {
      const bar = full.indexOf("](");
      const label = full.slice(1, bar);
      const href = full.slice(bar + 2, -1);
      tokens.push({ type: "link", value: label, href });
    }
    lastIndex = m.index + full.length;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }
  return tokens;
}

function renderInline(tokens: InlineToken[], keyBase: string) {
  return tokens.map((t, i) => {
    const key = `${keyBase}-${i}`;
    switch (t.type) {
      case "bold":
        return (
          <strong key={key} style={{ fontWeight: 700 }}>
            {renderInline(parseInline(t.value), key)}
          </strong>
        );
      case "italic":
        return <em key={key}>{renderInline(parseInline(t.value), key)}</em>;
      case "code":
        return (
          <code
            key={key}
            style={{
              background: "rgba(175,184,193,0.2)",
              padding: "1px 5px",
              borderRadius: 4,
              fontFamily: "var(--font-mono, 'SF Mono', Menlo, Monaco, monospace)",
              fontSize: "0.9em",
            }}
          >
            {t.value}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#10a37f", textDecoration: "underline" }}
          >
            {renderInline(parseInline(t.value), key)}
          </a>
        );
      default:
        return <span key={key}>{t.value}</span>;
    }
  });
}

// ---- Code blocks (dark ChatGPT-style with copy button) ----

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <div
      style={{
        background: "#0d1117",
        borderRadius: 8,
        overflow: "hidden",
        margin: "8px 0",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 10px",
          background: "#161b22",
          fontSize: 11,
          color: "#8b949e",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        <span>{lang || "code"}</span>
        <button
          onClick={copy}
          style={{
            border: "none",
            background: "transparent",
            color: "#8b949e",
            cursor: "pointer",
            fontSize: 11,
            padding: "2px 6px",
          }}
        >
          {copied ? "✓ Copied" : "⧉ Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          overflowX: "auto",
          color: "#e6edf3",
          fontSize: 12.5,
          lineHeight: 1.5,
          fontFamily: "var(--font-mono, 'SF Mono', Menlo, Monaco, monospace)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function CodeFenceBlock({ block }: { block: string }) {
  const firstLineEnd = block.indexOf("\n");
  const firstLine =
    firstLineEnd === -1 ? block.trim() : block.slice(0, firstLineEnd).trim();
  const body =
    firstLineEnd === -1 ? "" : block.slice(firstLineEnd + 1).replace(/\n$/, "");
  const lang = firstLine.replace(/^```/, "").trim();
  return <CodeBlock code={body} lang={lang} />;
}

function renderInlineText(text: string, keyBase: string) {
  return renderInline(parseInline(text), keyBase);
}


export default function AIResponse({ text }: { text: string }) {
  // Split into blocks: fenced code blocks and everything else.
  const parts: { type: "code" | "text"; value: string }[] = [];
  const fenceRe = /```[\s\S]*?```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    parts.push({ type: "code", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });

  let blockIndex = 0;
  return (
    <div style={{ fontSize: 14, lineHeight: 1.6, color: "#1f2328" }}>
      {parts.map((part, i) => {
        if (part.type === "code") {
          return <CodeFenceBlock key={`cb-${i}`} block={part.value} />;
        }

        const lines = part.value.split("\n");
        const elements: React.ReactNode[] = [];
        let para: string[] = [];
        let listType: "ul" | "ol" | null = null;
        let listItems: { marker: string; content: string }[] = [];

        const flushPara = () => {
          if (para.length) {
            elements.push(
              <p key={`p-${blockIndex++}`} style={{ margin: "6px 0" }}>
                {renderInlineText(para.join(" "), `p-${blockIndex}`)}
              </p>
            );
            para = [];
          }
        };
        const flushList = () => {
          if (!listType || !listItems.length) return;
          const isUl = listType === "ul";
          elements.push(
            <div key={`l-${blockIndex++}`} style={{ margin: "4px 0", paddingLeft: 8 }}>
              {listItems.map((it, idx) => (
                <div
                  key={`li-${idx}`}
                  style={{ display: "flex", gap: 8, margin: "2px 0" }}
                >
                  <span style={{ flexShrink: 0, color: "#10a37f" }}>
                    {isUl ? "•" : `${it.marker}.`}
                  </span>
                  <span>{renderInlineText(it.content, `li-${idx}-${blockIndex}`)}</span>
                </div>
              ))}
            </div>
          );
          listType = null;
          listItems = [];
        };

        for (const rawLine of lines) {
          const line = rawLine.trimEnd();

          // Heading
          const heading = line.match(/^(#{1,4})\s+(.*)$/);
          if (heading) {
            flushPara();
            flushList();
            const level = heading[1].length;
            const size = level === 1 ? 18 : level === 2 ? 16 : 15;
            elements.push(
              <div
                key={`h-${blockIndex++}`}
                style={{ fontWeight: 700, fontSize: size, margin: "10px 0 4px" }}
              >
                {renderInlineText(heading[2], `h-${blockIndex}`)}
              </div>
            );
            continue;
          }

          // Unordered list
          const ul = line.match(/^\s*[-*+]\s+(.*)$/);
          if (ul) {
            flushPara();
            if (listType !== "ul") flushList();
            listType = "ul";
            listItems.push({ marker: "", content: ul[1] });
            continue;
          }

          // Ordered list
          const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
          if (ol) {
            flushPara();
            if (listType !== "ol") flushList();
            listType = "ol";
            listItems.push({ marker: ol[1], content: ol[2] });
            continue;
          }

          // Blank line — flush pending blocks
          if (line.trim() === "") {
            flushPara();
            flushList();
            continue;
          }

          // Regular paragraph line
          flushList();
          para.push(line);
        }
        flushPara();
        flushList();

        if (elements.length === 0) return null;
        return (
          <div key={`blk-${i}`} style={{ margin: "2px 0" }}>
            {elements}
          </div>
        );
      })}
    </div>
  );
}

