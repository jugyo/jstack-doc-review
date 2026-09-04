import { Marked } from "./vendor/marked.esm.js";

export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));

function safeUrl(href) {
  const value = String(href ?? "").trim();
  return /^(https?:\/\/|mailto:|#)/i.test(value) ? value : null;
}

// Comments are rendered with innerHTML, so raw HTML stays text and only vetted URLs survive.
const renderer = {
  html(token) {
    return escapeHtml(token.text);
  },
  code({ text, lang }) {
    const language = String(lang ?? "").match(/^[\w-]+/)?.[0];
    return `<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHtml(text)}\n</code></pre>\n`;
  },
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const url = safeUrl(href);
    if (!url) return text;
    return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noreferrer">${text}</a>`;
  },
  image({ href, title, text }) {
    const url = safeUrl(href);
    if (!url) return escapeHtml(text);
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`;
  }
};

const marked = new Marked({ gfm: true, breaks: true }, { renderer });

export function renderMarkdown(value) {
  return marked.parse(String(value ?? ""));
}
