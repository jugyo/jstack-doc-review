export function sourceTextForRange(sourceLines, startLine, startOffset, endLine, endOffset) {
  if (startLine === endLine) return (sourceLines[startLine - 1] ?? "").slice(startOffset, endOffset);
  return [
    (sourceLines[startLine - 1] ?? "").slice(startOffset),
    ...sourceLines.slice(startLine, endLine - 1),
    (sourceLines[endLine - 1] ?? "").slice(0, endOffset)
  ].join("\n");
}

export function sourceOffsetForMappedText(mapping, offset) {
  if (offset <= 0) return mapping.sourceTextStart;
  if (offset >= mapping.visibleLength) return mapping.sourceTextEnd;
  return mapping.sourceTextStart + offset;
}
