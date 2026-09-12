import { DataSource } from 'typeorm';
import { typeormVersion } from './versions';

export interface Environment {
  database: string;
  node: string;
  typeorm: string;
  innodbBufferPoolSize: number;
  queryCacheType: string;
  queryCacheSize: number;
}

export interface Dataset {
  products: number;
  reviews: number;
  productImages: number;
  variants: number;
  productCategories: number;
  multipliedRows: number;
  indexes: string[];
}

async function scalar(ds: DataSource, sql: string): Promise<string> {
  const rows = await ds.query(sql);
  return String(rows[0][Object.keys(rows[0])[0]]);
}

/** Stamped into every report, so a number can never outlive the setup that produced it. */
export async function readEnvironment(ds: DataSource): Promise<Environment> {
  return {
    database: await scalar(ds, 'SELECT VERSION() AS v'),
    node: process.version,
    typeorm: typeormVersion(),
    innodbBufferPoolSize: Number(
      await scalar(ds, 'SELECT @@innodb_buffer_pool_size AS v'),
    ),
    queryCacheType: await scalar(ds, 'SELECT @@query_cache_type AS v'),
    queryCacheSize: Number(await scalar(ds, 'SELECT @@query_cache_size AS v')),
  };
}

export async function readDataset(ds: DataSource): Promise<Dataset> {
  const count = async (table: string): Promise<number> =>
    Number(await scalar(ds, `SELECT COUNT(*) AS c FROM \`${table}\``));

  const multiplied = await ds.query(
    `SELECT COUNT(*) AS c
     FROM products product
     INNER JOIN brands brand ON brand.id = product.brand_id
     LEFT JOIN reviews reviews ON reviews.product_id = product.id
     LEFT JOIN product_images images ON images.product_id = product.id
     LEFT JOIN product_categories pc ON pc.product_id = product.id
     LEFT JOIN categories categories ON categories.id = pc.category_id
     LEFT JOIN variants variants ON variants.product_id = product.id
     WHERE product.is_active = 1 AND product.price BETWEEN 10 AND 500`,
  );

  const indexRows = await ds.query(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS i,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
     GROUP BY TABLE_NAME, INDEX_NAME
     ORDER BY TABLE_NAME, INDEX_NAME`,
  );

  return {
    products: await count('products'),
    reviews: await count('reviews'),
    productImages: await count('product_images'),
    variants: await count('variants'),
    productCategories: await count('product_categories'),
    multipliedRows: Number(multiplied[0].c),
    indexes: indexRows.map((row: any) => `${row.t}.${row.i}(${row.cols})`),
  };
}
