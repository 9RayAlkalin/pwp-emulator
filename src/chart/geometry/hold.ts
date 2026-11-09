// Distances run from the head centre toward the authored tail, in line-local
// coordinates. Caps must follow a reversing span, not just the body position.
export function chartHoldLayout(length: number, headHeight: number, tailHeight: number, showHead: boolean) {
  const direction = length < 0 ? -1 : 1, span = Math.abs(length);
  // Keep an unhit head readable even at zero speed. Hide a tail buried inside
  // that head, and shorten only the tail when there is not enough body span.
  const head = showHead ? headHeight : 0;
  const tail = Math.min(tailHeight, Math.max(0, span * 2 - head));
  const bodyStart = head / 2, bodyEnd = span - tail / 2;
  return { direction, headHeight: head, tailHeight: tail, tailCenter: length,
    bodyCenter: direction * (bodyStart + bodyEnd) / 2, bodyHeight: Math.max(0, bodyEnd - bodyStart) };
}
