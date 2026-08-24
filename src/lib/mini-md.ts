/**
 * Just enough markdown for chat replies.
 *
 * A full parser is 40kB in the client bundle to render bold text and the
 * occasional link. The model's output here is short prose with the odd code
 * span and bullet list, so this covers it — and because everything is escaped
 * before any tag is introduced, model output can never inject markup.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(
      /(?<!["=(])\b(https?:\/\/[^\s<]+|\/p\/[a-z0-9-]+(?:\?[^\s<]*)?)/g,
      '<a href="$1" target="_blank" rel="noreferrer">$1</a>',
    );
}

export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let list: string[] = [];

  const flush = () => {
    if (list.length) {
      out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      list.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    out.push(heading ? `<p><strong>${inline(heading[1])}</strong></p>` : `<p>${inline(line)}</p>`);
  }
  flush();
  return out.join("");
}
