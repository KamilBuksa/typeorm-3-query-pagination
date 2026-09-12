import { withDataSource } from './data-source';
import { Product } from './entities/product.entity';
import { Review } from './entities/review.entity';

/**
 * Does `relationLoadStrategy: 'query'` see uncommitted data from the transaction
 * it is called in?
 *
 * The concern: relations are loaded by separate queries, and if those run on a
 * different query runner they would sit outside the transaction. Recommending
 * the flag without knowing this would be careless, so this probe inserts a row
 * inside a transaction and asks both strategies whether they can see it.
 *
 * Everything is rolled back - the dataset the benchmark asserts stays untouched.
 */
class Rollback extends Error {}

void withDataSource(async (ds) => {
  try {
    await ds.transaction(async (manager) => {
      const product = await manager.getRepository(Product).findOne({
        where: {},
        order: { id: 'ASC' },
      });
      if (!product) throw new Error('no products - seed the database first');

      const before = await manager
        .getRepository(Review)
        .count({ where: { product: { id: product.id } } });

      await manager.query(
        'INSERT INTO reviews (product_id, rating, text) VALUES (?, 5, ?)',
        [product.id, 'transaction probe'],
      );

      const load = async (strategy: 'query' | 'join'): Promise<number> => {
        const row = await manager.getRepository(Product).findOne({
          where: { id: product.id },
          relations: { reviews: true },
          relationLoadStrategy: strategy,
        });
        return row?.reviews.length ?? -1;
      };

      const viaQuery = await load('query');
      const viaJoin = await load('join');

      console.log(`\nproduct ${product.id}`);
      console.log(`  reviews before the insert:        ${before}`);
      console.log(`  inserted inside the transaction:  1`);
      console.log(`  seen by relationLoadStrategy join:  ${viaJoin}`);
      console.log(`  seen by relationLoadStrategy query: ${viaQuery}`);

      const querySees = viaQuery === before + 1;
      const joinSees = viaJoin === before + 1;
      console.log(
        `\n  verdict: 'query' strategy ${querySees ? 'DOES' : 'does NOT'} see uncommitted rows ` +
          `(join strategy ${joinSees ? 'does' : 'does not'})`,
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log('  transaction rolled back, dataset untouched\n');
  }
});
