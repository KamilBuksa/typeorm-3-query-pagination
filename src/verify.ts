import { writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { withDataSource } from './data-source';
import { EXPECTED } from './expected';
import { typeormVersion } from './lib/versions';
import { DEFAULT_FILTER, ListResult, ProductFilter } from './queries/filter';
import { findOptionsQuery } from './queries/find-options-query';
import { singleQuery } from './queries/single-query';
import { singleQueryLightCount } from './queries/single-query-light-count';
import { threeQuery } from './queries/three-query';

interface Check {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}

const checks: Check[] = [];

function check(
  name: string,
  expected: unknown,
  actual: unknown,
  pass = String(expected) === String(actual),
): void {
  checks.push({
    name,
    expected: String(expected),
    actual: String(actual),
    pass,
  });
}

async function serverVariable(ds: DataSource, name: string): Promise<string> {
  const rows = await ds.query(`SELECT @@${name} AS v`);
  return String(rows[0].v);
}

async function rowCount(ds: DataSource, table: string): Promise<number> {
  const rows = await ds.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
  return Number(rows[0].c);
}

async function multipliedRows(ds: DataSource): Promise<number> {
  const rows = await ds.query(
    `SELECT COUNT(*) AS c
     FROM products product
     INNER JOIN brands brand ON brand.id = product.brand_id
     LEFT JOIN reviews reviews ON reviews.product_id = product.id
     LEFT JOIN product_images images ON images.product_id = product.id
     LEFT JOIN product_categories pc ON pc.product_id = product.id
     LEFT JOIN categories categories ON categories.id = pc.category_id
     LEFT JOIN variants variants ON variants.product_id = product.id
     WHERE product.is_active = 1 AND product.price BETWEEN ? AND ?`,
    [DEFAULT_FILTER.minPrice, DEFAULT_FILTER.maxPrice],
  );
  return Number(rows[0].c);
}

async function indexSignature(ds: DataSource): Promise<Set<string>> {
  const rows = await ds.query(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS i,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
     GROUP BY TABLE_NAME, INDEX_NAME`,
  );
  return new Set(rows.map((row: any) => `${row.t}.${row.i}(${row.cols})`));
}

const BROAD: ProductFilter = {
  ...DEFAULT_FILTER,
  categoryId: undefined,
  minRating: undefined,
  page: 1,
};

void withDataSource(async (ds) => {
  // --- environment -------------------------------------------------------
  const [{ v: dbVersion }] = await ds.query('SELECT VERSION() AS v');
  check('database version', EXPECTED.databaseVersion, dbVersion, String(dbVersion).startsWith(EXPECTED.databaseVersion));
  check('typeorm version', EXPECTED.typeormVersion, typeormVersion());

  for (const [name, expected] of Object.entries(EXPECTED.serverVariables)) {
    check(`server ${name}`, expected, await serverVariable(ds, name));
  }

  const threadsRunning = await ds
    .query(`SHOW STATUS LIKE 'Threads_running'`)
    .then((rows) => Number(rows[0].Value));
  check('server idle (threads running <= 2)', '<= 2', threadsRunning, threadsRunning <= 2);

  // --- dataset -----------------------------------------------------------
  for (const [table, expected] of Object.entries(EXPECTED.rowCounts)) {
    check(`rows ${table}`, expected, await rowCount(ds, table));
  }

  check('rows after the five-way join', EXPECTED.multipliedRows, await multipliedRows(ds));

  // --- indexes -----------------------------------------------------------
  const present = await indexSignature(ds);
  for (const index of EXPECTED.indexes) {
    check(`index ${index}`, 'present', present.has(index) ? 'present' : 'MISSING');
  }

  // --- every variant returns the same list ------------------------------
  const VARIANTS: Array<[string, (ds: DataSource, f: ProductFilter) => Promise<ListResult>]> = [
    ['A', singleQuery],
    ['A2', singleQueryLightCount],
    ['B', threeQuery],
    ['C', findOptionsQuery],
  ];

  const SCENARIOS: Array<[string, ProductFilter, number]> = [
    ['selective', { ...DEFAULT_FILTER, page: 1 }, EXPECTED.totals.selective],
    ['broad', BROAD, EXPECTED.totals.broad],
    [
      'relation-filter',
      { ...DEFAULT_FILTER, categoryId: undefined, minRating: 1, page: 1 },
      EXPECTED.totals.relationFilter,
    ],
  ];

  for (const [scenarioName, filter, expectedTotal] of SCENARIOS) {
    for (const page of [1, 7, 50]) {
      const results: ListResult[] = [];
      for (const [, run] of VARIANTS) {
        results.push(await run(ds, { ...filter, page }));
      }

      const reference = results[0];
      const same = results.every(
        (result) =>
          result.total === reference.total &&
          JSON.stringify(result.ids) === JSON.stringify(reference.ids),
      );
      check(
        `parity ${scenarioName} page ${page} (A/A2/B/C)`,
        'identical',
        same ? 'identical' : 'MISMATCH',
        same,
      );

      if (page === 1) {
        check(`total ${scenarioName}`, expectedTotal, reference.total);
      }
    }
  }

  // --- report ------------------------------------------------------------
  const failed = checks.filter((entry) => !entry.pass);
  const width = Math.max(...checks.map((entry) => entry.name.length));

  console.log('');
  for (const entry of checks) {
    const status = entry.pass ? 'PASS' : 'FAIL';
    const detail = entry.pass
      ? entry.actual
      : `expected ${entry.expected}, got ${entry.actual}`;
    console.log(`  ${status}  ${entry.name.padEnd(width)}  ${detail}`);
  }

  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed`,
  );

  const file = join(__dirname, '..', 'results', 'verify.json');
  writeFileSync(
    file,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), checks, failed: failed.length },
      null,
      2,
    ),
  );
  console.log(`report saved: ${file}`);

  if (failed.length) {
    console.error('\nSetup is not what the article assumes - do not trust any measurement.');
    process.exitCode = 1;
  }
});
