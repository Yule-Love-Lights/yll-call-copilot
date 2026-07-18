// One rule for every screen: glance surfaces (lists, boards, tiles) show a
// whole number; detail surfaces show the stored one-decimal value. The
// pre-launch audit found three pages rounding three different ways.

export function formatOverallGlance(overall: number): string {
  return String(Math.round(overall));
}

export function formatOverallExact(overall: number): string {
  return overall.toFixed(1);
}
