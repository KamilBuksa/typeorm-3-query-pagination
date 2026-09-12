import { writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { withDataSource } from './data-source';
import { IndexConfig, IndexTiming, applyIndexConfig } from './indexes';
import { readDataset, readEnvironment } from './lib/environment';
import { measure, stats } from './lib/stats';
import { DEFAULT_FILTER, ListResult, ProductFilter } from './queries/filter';
import { findOptionsQuery } from './queries/find-options-query';
import { singleQuery } from './queries/single-query';
import { singleQueryLightCount } from './queries/single-query-light-count';
import { threeQuery } from './queries/three-query';

const WARMUP = Number(process.env.WARMUP ?? 2);
const RUNS = Number(process.env.RUNS ?? 5);
const PAGE = Number(process.env.PAGE ?? 1);

const CONFIGS: IndexConfig[] = ['full', 'minimal'];

const SCENARIOS = [
  {
    key: 'selective',
    filter: { ...DEFAULT_FILTER, page: PAGE },
  },
  {
    key: 'broad',
    filter: {
      ...DEFAULT_FILTER,
      categoryId: undefined,
      minRating: undefined,
      page: PAGE,
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
  { key: 'strategy', label: 'C - relationLoadStrategy', run: findOptionsQuery },
];

void withDataSource(async (ds: DataSource) => {
  const environment = await readEnvironment(ds);
  const results: unknown[] = [];
  const indexTimings: Record<string, IndexTiming[]> = {};

  for (const config of CONFIGS) {
    indexTimings[config] = await applyIndexConfig(ds, config);
    console.log('');

    for (const scenario of SCENARIOS) {
      const samples = new Map<string, number[]>(
        VARIANTS.map((variant) => [variant.key, []]),
      );
      const last = new Map<string, ListResult>();

      for (const variant of VARIANTS) {
        for (let i = 0; i < WARMUP; i++) await variant.run(ds, scenario.filter);
      }

      for (let i = 0; i < RUNS; i++) {
        const order = i % 2 === 0 ? VARIANTS : [...VARIANTS].reverse();
        for (const variant of order) {
          const { ms, result } = await measure(() =>
            variant.run(ds, scenario.filter),
          );
          samples.get(variant.key)!.push(ms);
          last.set(variant.key, result);
        }
      }

      for (const variant of VARIANTS) {
        const summary = stats(samples.get(variant.key)!);
        results.push({
          indexes: config,
          scenario: scenario.key,
          variant: variant.key,
          total: last.get(variant.key)?.total,
          ...summary,
        });

        console.log(
          `${config.padEnd(8)} | ${scenario.key.padEnd(9)} | ${variant.label.padEnd(24)} | ` +
            `p50 ${String(summary.p50).padStart(9)} ms`,
        );
      }
    }
    console.log('');
  }

  // leave the database in the documented state
  indexTimings['restore'] = await applyIndexConfig(ds, 'full');
  const dataset = await readDataset(ds);

  const file = join(
    __dirname,
    '..',
    'results',
    `bench-indexes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        environment,
        dataset,
        page: PAGE,
        warmup: WARMUP,
        runs: RUNS,
        interleaved: true,
        indexTimings,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nreport saved: ${file}`);
});
