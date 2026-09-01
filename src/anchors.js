export function contextFor(lines, startLine, endLine) {
  return { prefix: lines.slice(Math.max(0,startLine-3),startLine-1).join("\n"), suffix: lines.slice(endLine, endLine+2).join("\n") };
}

export function reanchor(anchor, content) {
  const lines = content.split("\n");
  const selected = anchor.selectedText.trim();
  if (selected) {
    const indexes=[]; let at=0;
    while ((at=content.indexOf(selected,at))>=0) { indexes.push(at); at += Math.max(1,selected.length); }
    if (indexes.length) {
      const scored=indexes.map(index=>{
        const line=content.slice(0,index).split("\n").length;
        const proximity=Math.abs(line-anchor.startLine);
        const before=content.slice(Math.max(0,index-500),index);
        const after=content.slice(index+selected.length,index+selected.length+500);
        const context=(anchor.prefix&&before.endsWith(anchor.prefix)?1000:0)+(anchor.suffix&&after.startsWith(anchor.suffix)?1000:0);
        return {index,line,score:context-proximity};
      }).sort((a,b)=>b.score-a.score)[0];
      const endLine=scored.line+selected.split("\n").length-1;
      return {...anchor,startLine:scored.line,endLine,...contextFor(lines,scored.line,endLine)};
    }
  }
  const from=Math.max(1,anchor.startLine-5), to=Math.min(lines.length,anchor.endLine+5);
  const needle=selected.toLowerCase();
  for(let line=from;line<=to;line++) if(needle && similarity(lines[line-1].toLowerCase(),needle)>0.65)
    return {...anchor,startLine:line,endLine:line,...contextFor(lines,line,line)};
  return null;
}

function similarity(a,b) {
  if(!a||!b)return 0; const words=new Set(b.split(/\s+/)); let hit=0;
  for(const word of a.split(/\s+/)) if(words.has(word)) hit++; return hit/Math.max(words.size,a.split(/\s+/).length);
}
