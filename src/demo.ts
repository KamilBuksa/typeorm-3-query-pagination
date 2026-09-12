import { withDataSource } from './data-source';
import { measure } from './lib/stats';
import { DEFAULT_FILTER, ListResult, ProductFilter } from './queries/filter';
import { findOptionsQuery } from './queries/find-options-query';
import { singleQuery } from './queries/single-query';
import { singleQueryLightCount } from './queries/single-query-light-count';
import { threeQuery } from './queries/three-query';

const RUNS = 3;

const VARIANTS = [
  { label: 'A  - getManyAndCount()', run: singleQuery },
  { label: 'A2 - joins + light COUNT', run: singleQueryLightCount },
  { label: 'B  - split filter/fetch', run: threeQuery },
  { label: 'C  - relationLoadStrategy', run: findOptionsQuery },
];

const SCENARIOS: Array<{ title: string; filter: ProductFilter }> = [
  {
    title: 'BROAD FILTERS (is_active + price)',
    filter: {
      ...DEFAULT_FILTER,
      categoryId: undefined,
      minRating: undefined,
      page: 1,
    },
  },
  {
    title: 'BROAD FILTER ON A RELATION (rating >= 1)',
    filter: { ...DEFAULT_FILTER, categoryId: undefined, minRating: 1, page: 1 },
  },
  {
    title: 'SELECTIVE FILTERS (category + rating >= 4)',
    filter: { ...DEFAULT_FILTER, page: 1 },
  },
];

/** Median of a few runs - a single measurement can swing by tens of percent. */
async function median<T>(
  fn: () => Promise<T>,
): Promise<{ ms: number; result: T }> {
  const samples: Array<{ ms: number; result: T }> = [];
  for (let i = 0; i < RUNS; i++) samples.push(await measure(fn));
  samples.sort((a, b) => a.ms - b.ms);
  return samples[Math.floor(RUNS / 2)];
}

void withDataSource(async (ds) => {
  for (const scenario of SCENARIOS) {
    console.log(`\n=== ${scenario.title} ===\n`);

    // warm up every variant before measuring any of them
    for (const variant of VARIANTS) await variant.run(ds, scenario.filter);

    const collections = new Map<string, ListResult>();

    for (const variant of VARIANTS) {
      const { ms, result } = await median(() => variant.run(ds, scenario.filter));
      collections.set(variant.label, result);
      console.log(
        `  ${variant.label.padEnd(26)} ${String(Math.round(ms)).padStart(6)} ms   ` +
          `total ${result.total}`,
      );
    }

    if (scenario.title.startsWith('SELECTIVE')) {
      console.log('\n  Child collections returned for the same 20 products:');
      for (const [label, result] of collections) {
        console.log(`    ${label.padEnd(26)} ${JSON.stringify(result.collections)}`);
      }
      console.log(
        '\n  Variant A filters on LEFT JOINs that also return data, so its\n' +
          '  reviews and categories come back truncated. Same ids, different payload.',
      );
    }
  }
  console.log('');
});
