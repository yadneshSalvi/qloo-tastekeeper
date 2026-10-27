import type { CatalogItem, Signal } from './catalog.ts';
import type { HardConstraints } from './contracts.ts';
export function eligibleCatalog(items: CatalogItem[], constraints: HardConstraints): CatalogItem[] {
  return items.filter(
    (item) =>
      (constraints.maxPrice === undefined || item.price <= constraints.maxPrice) &&
      (!constraints.format || constraints.format === 'any' || item.format === constraints.format) &&
      (constraints.maxMinutes === undefined ||
        (item.minutes !== undefined && item.minutes <= constraints.maxMinutes)) &&
      (!constraints.setting ||
        constraints.setting === 'any' ||
        item.setting === constraints.setting),
  );
}
/** Transparent authored rule. Scores are never affinity/probability claims. */
export function rankSample(
  items: CatalogItem[],
  signals: Signal[],
  constraints: HardConstraints,
): CatalogItem[] {
  if (!signals.some((s) => s.active)) return [];
  const weights: Record<string, number> = {};
  for (const signal of signals.filter((s) => s.active))
    for (const [tag, weight] of Object.entries(signal.tags))
      weights[tag] = (weights[tag] ?? 0) + weight;
  return eligibleCatalog(items, constraints)
    .map((item) => ({
      item,
      score: Object.entries(item.tags).reduce(
        (sum, [tag, weight]) => sum + weight * (weights[tag] ?? 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .map((x) => x.item);
}
