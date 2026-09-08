// GFM pipe tables, described row by row. The document view keeps one .doc-line per source line so
// every row stays commentable, so a table is never parsed into a single block: each source line is
// told which columns it belongs to and CSS puts the rows back together as a table.

const alignment = value => value.startsWith(":") ? (value.endsWith(":") ? "center" : "left") : value.endsWith(":") ? "right" : "";

// Cell text with the offsets it came from, so selections inside a cell still map back to the source.
export function tableCells(line) {
  let offset = 0, text = line;
  const lead = text.match(/^\s*\|/);
  if (lead) {
    offset = lead[0].length;
    text = text.slice(lead[0].length);
  }
  const tail = text.match(/\|\s*$/);
  if (tail) text = text.slice(0, text.length - tail[0].length);
  let cursor = 0;
  return text.split("|").map(raw => {
    const start = offset + cursor + (raw.length - raw.trimStart().length);
    const value = raw.trim();
    cursor += raw.length + 1;
    return { value, start, end: start + value.length };
  });
}

const isRule = line => line.includes("|") && tableCells(line).every(cell => /^:?-+:?$/.test(cell.value));

// One entry per source line: null outside a table, otherwise the row's role, the column alignments
// the delimiter row asked for, and whether the table opens or closes on that line.
export function tableRows(lines) {
  const rows = new Array(lines.length).fill(null);
  let code = false;
  for (let index = 0; index < lines.length; index++) {
    if (/^```/.test(lines[index])) {
      code = !code;
      continue;
    }
    if (code || !lines[index].includes("|") || !isRule(lines[index + 1] ?? "")) continue;
    const align = tableCells(lines[index + 1]).map(cell => alignment(cell.value));
    rows[index] = { role: "head", align, first: true };
    rows[index + 1] = { role: "rule", align };
    let end = index + 2;
    while (end < lines.length && lines[end].trim() && lines[end].includes("|") && !/^```/.test(lines[end])) {
      rows[end] = { role: "body", align };
      end++;
    }
    rows[end - 1].last = true;
    index = end - 1;
  }
  return rows;
}
