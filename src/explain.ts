import { writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { withDataSource } from './data-source';
import { captureLogger } from './lib/capture-logger';
import { DEFAULT_FILTER, ProductFilter } from './queries/filter';
import { singleQuery } from './queries/single-query';
import { threeQuery } from './queries/three-query';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { format } = require('mysql2');

const PAGE = Number(process.env.PAGE ?? 1);
const SCENARIO = process.env.SCENARIO ?? 'broad';

const FILTER: ProductFilter =
  SCENARIO === 'broad'
    ? { ...DEFAULT_FILTER, categoryId: undefined, minRating: undefined, page: PAGE }
    : { ...DEFAULT_FILTER, page: PAGE };

async function captureVariant(
  ds: DataSource,
  run: (ds: DataSource, filter: ProductFilter) => Promise<unknown>,
): Promise<Array<{ sql: string; parameters: unknown[] }>> {
  captureLogger.reset();
  captureLogger.enabled = true;
  try {
    await run(ds, FILTER);
  } finally {
    captureLogger.enabled = false;
  }
  return [...captureLogger.captured];
}

async function analyze(
  ds: DataSource,
  captured: Array<{ sql: string; parameters: unknown[] }>,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const query of captured) {
    if (!/^\s*select/i.test(query.sql)) continue;
    const sql = format(query.sql, query.parameters);
    const started = Date.now();
    // MariaDB: ANALYZE returns the plan with actual row counters (r_rows).
    const rows = await ds.query(`ANALYZE FORMAT=JSON ${sql}`);
    out.push({
      sql: query.sql,
      wallClockMs: Date.now() - started,
      plan: JSON.parse(rows[0].ANALYZE),
    });
  }
  return out;
}

void withDataSource(async (ds) => {
  const single = await analyze(ds, await captureVariant(ds, singleQuery));
  const three = await analyze(ds, await captureVariant(ds, threeQuery));

  const report = {
    generatedAt: new Date().toISOString(),
    page: PAGE,
    scenario: SCENARIO,
    filter: FILTER,
    single,
    three,
  };

  const file = join(__dirname, '..', 'results', `explain-${SCENARIO}-page-${PAGE}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));

  const summarize = (label: string, entries: unknown[]): void => {
    console.log(`\n${label}`);
    entries.forEach((entry, index) => {
      const plan = (entry as { plan: { query_block?: Record<string, unknown> } })
        .plan;
      const block = plan.query_block ?? {};
      console.log(
        `  [${index + 1}] r_total_time_ms=${block.r_total_time_ms ?? '-'} ` +
          `select_id=${block.select_id ?? '-'}`,
      );
    });
  };

  summarize('A - one heavy query:', single);
  summarize('B - three light queries:', three);
  console.log(`\nplans saved: ${file}`);
});
