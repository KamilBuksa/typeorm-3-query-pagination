import { DataSource } from 'typeorm';
import { withDataSource } from './data-source';

/**
 * Index configurations for the benchmark.
 *
 * 'full'    - dedicated indexes for every filter the queries use
 * 'minimal' - only what foreign keys force the engine to keep
 *
 * A foreign key needs an index on its column, so reviews(product_id) cannot be
 * dropped outright - the composite (product_id, rating) is swapped for a plain
 * (product_id) instead, which removes the rating part from the index.
 */
export type IndexConfig = 'full' | 'minimal';

interface IndexDef {
  table: string;
  name: string;
  columns: string;
}

const OPTIONAL: IndexDef[] = [
  {
    table: 'products',
    name: 'IDX_products_active_price',
    columns: '(is_active, price)',
  },
  {
    table: 'products',
    name: 'IDX_products_created_at',
    columns: '(created_at)',
  },
];

const REVIEWS_FULL: IndexDef = {
  table: 'reviews',
  name: 'IDX_reviews_product_rating',
  columns: '(product_id, rating)',
};

const REVIEWS_MINIMAL: IndexDef = {
  table: 'reviews',
  name: 'IDX_reviews_product',
  columns: '(product_id)',
};

const ANALYZED_TABLES =
  'products, reviews, product_images, variants, product_categories';

async function exists(ds: DataSource, index: IndexDef): Promise<boolean> {
  const rows = await ds.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [index.table, index.name],
  );
  return Number(rows[0].c) > 0;
}

export interface IndexTiming {
  index: string;
  action: 'create' | 'drop';
  ms: number;
}

async function create(
  ds: DataSource,
  index: IndexDef,
  timings: IndexTiming[],
): Promise<void> {
  if (await exists(ds, index)) return;
  const started = Date.now();
  await ds.query(
    `CREATE INDEX \`${index.name}\` ON \`${index.table}\` ${index.columns}`,
  );
  const ms = Date.now() - started;
  timings.push({
    index: `${index.table}.${index.name}${index.columns}`,
    action: 'create',
    ms,
  });
  console.log(
    `  + ${index.table}.${index.name} ${index.columns} (${ms} ms)`,
  );
}

async function drop(
  ds: DataSource,
  index: IndexDef,
  timings: IndexTiming[],
): Promise<void> {
  if (!(await exists(ds, index))) return;
  const started = Date.now();
  await ds.query(`DROP INDEX \`${index.name}\` ON \`${index.table}\``);
  const ms = Date.now() - started;
  timings.push({
    index: `${index.table}.${index.name}${index.columns}`,
    action: 'drop',
    ms,
  });
  console.log(`  - ${index.table}.${index.name} (${ms} ms)`);
}

export async function applyIndexConfig(
  ds: DataSource,
  config: IndexConfig,
): Promise<IndexTiming[]> {
  console.log(`index config: ${config}`);
  const timings: IndexTiming[] = [];

  if (config === 'full') {
    // create the replacement before dropping the other one, so the FK on
    // reviews.product_id always has an index behind it
    await create(ds, REVIEWS_FULL, timings);
    await drop(ds, REVIEWS_MINIMAL, timings);
    for (const index of OPTIONAL) await create(ds, index, timings);
  } else {
    await create(ds, REVIEWS_MINIMAL, timings);
    await drop(ds, REVIEWS_FULL, timings);
    for (const index of OPTIONAL) await drop(ds, index, timings);
  }

  await ds.query(`ANALYZE TABLE ${ANALYZED_TABLES}`);
  return timings;
}

export async function listIndexes(ds: DataSource): Promise<void> {
  const rows = await ds.query(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS i,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
     GROUP BY TABLE_NAME, INDEX_NAME
     ORDER BY TABLE_NAME, INDEX_NAME`,
  );
  for (const row of rows) {
    console.log(`  ${row.t}.${row.i} (${row.cols})`);
  }
}

if (require.main === module) {
  const arg = (process.argv[2] ?? 'status') as IndexConfig | 'status';

  void withDataSource(async (ds) => {
    if (arg === 'status') {
      await listIndexes(ds);
      return;
    }
    if (arg !== 'full' && arg !== 'minimal') {
      console.error("usage: ts-node src/indexes.ts [full|minimal|status]");
      process.exitCode = 1;
      return;
    }
    await applyIndexConfig(ds, arg);
    console.log('');
    await listIndexes(ds);
  });
}
