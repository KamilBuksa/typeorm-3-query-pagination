import { writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { withDataSource } from './data-source';
import { readDataset, readEnvironment } from './lib/environment';
import { measure, stats } from './lib/stats';
import { DEFAULT_FILTER, ListResult, ProductFilter } from './queries/filter';
import { findOptionsQuery } from './queries/find-options-query';
import { singleQuery } from './queries/single-query';
import { singleQueryLightCount } from './queries/single-query-light-count';
import { threeQuery } from './queries/three-query';

const WARMUP = Number(process.env.WARMUP ?? 3);
const RUNS = Number(process.env.RUNS ?? 10);
const PAGES = (process.env.PAGES ?? '1,10,50')
  .split(',')
  .map((page) => Number(page.trim()));

const SCENARIOS = [
  {
    key: 'selective',
    label: 'selective filters (category + rating)',
    filter: DEFAULT_FILTER,
  },
  {
    key: 'broad',
    label: 'broad filters (is_active + price)',
    filter: {
      ...DEFAULT_FILTER,
      categoryId: undefined,
      minRating: undefined,
    } as ProductFilter,
  },
  {
    // A filter that sits on a relation and excludes almost nothing: the join is
    // needed for filtering, so no fetch-side fix can remove it.
    key: 'relation-filter',
    label: 'broad filter on a relation (rating >= 1)',
    filter: {
      ...DEFAULT_FILTER,
      categoryId: undefined,
      minRating: 1,
    } as ProductFilter,
  },
];

const VARIANTS = [
  { key: 'single', label: 'A - getManyAndCount()', run: singleQuery },
  {
    key: 'single-light-count',
    label: 'A2 - joins + light COUNT',
    run: singleQueryLightCount,
  },
  { key: 'three', label: 'B - split filter/fetch', run: threeQuery },
  {
    key: 'strategy',
    label: 'C - relationLoadStrategy',
    run: findOptionsQuery,
  },
];

void withDataSource(async (ds: DataSource) => {
  const environment = await readEnvironment(ds);
  const dataset = await readDataset(ds);

  console.log(`database:  ${environment.database}`);
  console.log(`products:  ${dataset.products}`);
  console.log(`rows after the five-way join: ${dataset.multipliedRows}`);
  console.log('');

  const results: unknown[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`--- ${scenario.label}`);

    for (const page of PAGES) {
      const filter: ProductFilter = { ...scenario.filter, page };
      const samples = new Map<string, number[]>(
        VARIANTS.map((variant) => [variant.key, []]),
      );
      const last = new Map<string, ListResult>();

      for (const variant of VARIANTS) {
        for (let i = 0; i < WARMUP; i++) await variant.run(ds, filter);
      }

      // Variants are interleaved on purpose: measuring all of A and then all of B
      // would fold any drift in machine load into the comparison.
      for (let i = 0; i < RUNS; i++) {
        // order is rotated every iteration: running one variant always first
        // would let it warm the buffer pool for the next one
        const order = i % 2 === 0 ? VARIANTS : [...VARIANTS].reverse();
        for (const variant of order) {
          const { ms, result } = await measure(() => variant.run(ds, filter));
          samples.get(variant.key)!.push(ms);
          last.set(variant.key, result);
        }
      }

      for (const variant of VARIANTS) {
        const summary = stats(samples.get(variant.key)!);
        const result = last.get(variant.key);

        results.push({
          scenario: scenario.key,
          page,
          variant: variant.key,
          label: variant.label,
          total: result?.total,
          returned: result?.ids.length,
          collections: result?.collections,
          ...summary,
        });

        console.log(
          `page ${String(page).padStart(4)} | ${variant.label.padEnd(24)} | ` +
            `p50 ${String(summary.p50).padStart(9)} ms | max ${String(summary.max).padStart(9)} ms | ` +
            `total ${result?.total}`,
        );
      }
      console.log('');
    }
  }

  const file = join(
    __dirname,
    '..',
    'results',
    `bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        environment,
        dataset,
        warmup: WARMUP,
        runs: RUNS,
        interleaved: true,
        scenarios: SCENARIOS.map(({ key, label, filter }) => ({
          key,
          label,
          filter,
        })),
        results,
      },
      null,
      2,
    ),
  );
  console.log(`report saved: ${file}`);
});
