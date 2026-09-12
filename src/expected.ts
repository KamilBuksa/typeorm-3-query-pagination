/**
 * What a correct setup looks like.
 *
 * Every value here is an assertion the article relies on. `npm run verify`
 * checks all of them before any measurement is trusted. Change these only
 * together with a reseed at a different scale.
 */
export const EXPECTED = {
  databaseVersion: '10.5.29-MariaDB',
  typeormVersion: '0.3.11',

  serverVariables: {
    innodb_buffer_pool_size: 1073741824, // 1 GiB
    query_cache_size: 0,
    query_cache_type: 'OFF',
  },

  /** Deterministic output of `npm run seed` with faker seed 42 and PRODUCTS=50000. */
  rowCounts: {
    products: 50000,
    reviews: 250705,
    product_images: 150832,
    variants: 224970,
    product_categories: 124897,
    brands: 200,
    categories: 40,
  },

  /** Rows the five-way join produces for the broad filter set. */
  multipliedRows: 4279620,

  /** Result sizes both query variants must agree on. */
  totals: {
    selective: 1204,
    broad: 24754,
    relationFilter: 22478,
  },

  /** Indexes the 'full' config must have in place. */
  indexes: [
    'products.IDX_products_active_price(is_active,price)',
    'products.IDX_products_created_at(created_at)',
    'reviews.IDX_reviews_product_rating(product_id,rating)',
    'product_categories.PRIMARY(product_id,category_id)',
  ],
} as const;
