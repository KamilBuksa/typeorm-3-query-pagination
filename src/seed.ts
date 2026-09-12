import { faker } from '@faker-js/faker';
import { DataSource } from 'typeorm';
import { withDataSource } from './data-source';

const PRODUCTS = Number(process.env.PRODUCTS ?? 50000);
const BRANDS = Number(process.env.BRANDS ?? 200);
const CATEGORIES = Number(process.env.CATEGORIES ?? 40);
const BATCH = 1000;

// Fixed seed - the same dataset on every run.
faker.seed(42);

async function bulkInsert(
  ds: DataSource,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  if (!rows.length) return;
  const cols = columns.map((c) => `\`${c}\``).join(', ');
  const placeholders = rows
    .map(() => `(${columns.map(() => '?').join(', ')})`)
    .join(', ');
  await ds.query(
    `INSERT INTO \`${table}\` (${cols}) VALUES ${placeholders}`,
    rows.flat(),
  );
}

void withDataSource(async (ds) => {
  const started = Date.now();

  await ds.query('SET foreign_key_checks = 0');
  await ds.query('SET unique_checks = 0');

  for (const table of [
    'product_categories',
    'reviews',
    'product_images',
    'variants',
    'products',
    'categories',
    'brands',
  ]) {
    await ds.query(`TRUNCATE TABLE \`${table}\``);
  }

  await bulkInsert(
    ds,
    'brands',
    ['id', 'name'],
    Array.from({ length: BRANDS }, (_, i) => [i + 1, faker.company.name()]),
  );

  await bulkInsert(
    ds,
    'categories',
    ['id', 'name'],
    Array.from({ length: CATEGORIES }, (_, i) => [
      i + 1,
      faker.commerce.department() + ' ' + (i + 1),
    ]),
  );

  const counters = { reviews: 0, images: 0, variants: 0, links: 0 };

  for (let offset = 0; offset < PRODUCTS; offset += BATCH) {
    const size = Math.min(BATCH, PRODUCTS - offset);
    const products: unknown[][] = [];
    const reviews: unknown[][] = [];
    const images: unknown[][] = [];
    const variants: unknown[][] = [];
    const links: unknown[][] = [];

    for (let i = 0; i < size; i++) {
      // faker, not crypto.randomUUID: the primary key is clustered, so a fixed
      // id sequence keeps the physical layout identical between seeds too
      const id = faker.string.uuid();

      products.push([
        id,
        faker.commerce.productName(),
        faker.commerce.price({ min: 5, max: 900 }),
        faker.commerce.productDescription(),
        faker.number.int({ min: 1, max: 100 }) <= 90 ? 1 : 0,
        faker.date.past({ years: 2 }),
        faker.number.int({ min: 1, max: BRANDS }),
      ]);

      // ~5 reviews, ~3 images, ~4.5 variants, ~2.5 categories per product on average.
      // Drawn once, before the loop - otherwise the loop condition redraws on every pass.
      const reviewCount = faker.number.int({ min: 0, max: 10 });
      const imageCount = faker.number.int({ min: 1, max: 5 });
      const variantCount = faker.number.int({ min: 1, max: 8 });

      for (let r = 0; r < reviewCount; r++) {
        reviews.push([
          id,
          faker.number.int({ min: 1, max: 5 }),
          faker.lorem.sentence(),
        ]);
      }

      for (let m = 0; m < imageCount; m++) {
        images.push([id, faker.image.url(), m]);
      }

      for (let v = 0; v < variantCount; v++) {
        variants.push([
          id,
          faker.helpers.arrayElement(['XS', 'S', 'M', 'L', 'XL']),
          faker.color.human(),
          faker.number.int({ min: 0, max: 500 }),
        ]);
      }

      const categoryIds = faker.helpers.arrayElements(
        Array.from({ length: CATEGORIES }, (_, c) => c + 1),
        faker.number.int({ min: 1, max: 4 }),
      );
      for (const categoryId of categoryIds) {
        links.push([id, categoryId]);
      }
    }

    await bulkInsert(
      ds,
      'products',
      [
        'id',
        'name',
        'price',
        'description',
        'is_active',
        'created_at',
        'brand_id',
      ],
      products,
    );
    await bulkInsert(ds, 'reviews', ['product_id', 'rating', 'text'], reviews);
    await bulkInsert(
      ds,
      'product_images',
      ['product_id', 'url', 'position'],
      images,
    );
    await bulkInsert(
      ds,
      'variants',
      ['product_id', 'size', 'color', 'stock'],
      variants,
    );
    await bulkInsert(
      ds,
      'product_categories',
      ['product_id', 'category_id'],
      links,
    );

    counters.reviews += reviews.length;
    counters.images += images.length;
    counters.variants += variants.length;
    counters.links += links.length;

    if ((offset + size) % 5000 === 0 || offset + size === PRODUCTS) {
      console.log(`  products: ${offset + size}/${PRODUCTS}`);
    }
  }

  await ds.query('SET foreign_key_checks = 1');
  await ds.query('SET unique_checks = 1');
  await ds.query('ANALYZE TABLE products, reviews, product_images, variants, product_categories');

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log(`products:        ${PRODUCTS}`);
  console.log(`reviews:         ${counters.reviews}`);
  console.log(`images:          ${counters.images}`);
  console.log(`variants:        ${counters.variants}`);
  console.log(`category links:  ${counters.links}`);
  console.log(`took:            ${seconds}s`);
});
