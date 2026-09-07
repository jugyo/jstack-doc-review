export const ANCHOR_GAP = 12;

// Puts each comment on the line it is anchored to and pushes the active one's neighbours clear.
// Positions only move outwards from the active comment, so the input order is kept. A comment above
// the top of the column reports a negative position; pass floor to hold it inside the top instead.
export function anchorLayout(comments, { activeId = null, gap = ANCHOR_GAP, floor = -Infinity } = {}) {
  const tops = comments.map(comment => comment.target);
  const active = comments.findIndex(comment => comment.id === activeId);
  for (let index = active - 1; index >= 0; index--) {
    tops[index] = Math.min(tops[index], tops[index + 1] - comments[index].height - gap);
  }
  if (tops.length) tops[0] = Math.max(tops[0], floor);
  for (let index = 1; index < tops.length; index++) {
    tops[index] = Math.max(tops[index], tops[index - 1] + comments[index - 1].height + gap);
  }
  return tops;
}

// Room the document leaves above its first line, so the column reaches the lines it starts below.
// `room` caps how much is given back at once — giving it back is only invisible while the page can be
// scrolled the same distance.
export function anchorLeadIn({ leadIn, tops, basePadding, room = Infinity }) {
  const needed = Math.max(basePadding, tops.length ? leadIn - tops[0] : basePadding);
  return Math.max(needed, leadIn - room);
}

// Where to open the page so the lead-in does not hide the document: past it once less than `visible`
// of the document is left, which puts the first line where it sits without a lead-in.
export function anchorOpeningScroll({ firstLineTop, height, visible, leadIn, basePadding }) {
  return firstLineTop > height - visible ? Math.max(0, leadIn - basePadding) : 0;
}

// How far the column reaches below its origin — what the rail reserves to keep the pinned comments
// underneath clear of it.
export function anchorLayoutHeight(comments, tops) {
  return tops.length ? tops[tops.length - 1] + comments[comments.length - 1].height : 0;
}
