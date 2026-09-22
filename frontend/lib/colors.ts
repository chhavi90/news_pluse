// One colour per outlet, assigned in a stable order so an outlet keeps its colour across filters.
const PALETTE = ["#2f6fed", "#d9822b", "#1f9d8a", "#c2415d", "#7a5bd0", "#6f8f2a", "#a0692f", "#3f8fb5"];

export function buildSourceColors(names: string[]): (name: string) => string {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const map = new Map(sorted.map((n, i) => [n, PALETTE[i % PALETTE.length]]));
  return (name: string) => map.get(name) ?? "#7b8798";
}
