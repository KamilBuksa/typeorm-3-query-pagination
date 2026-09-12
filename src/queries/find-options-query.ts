import { Between, DataSource, FindOptionsWhere, MoreThanOrEqual } from 'typeorm';
import { Product } from '../entities/product.entity';
import {
  CollectionTotals,
  ListResult,
  ProductFilter,
  getPaginationParams,
} from './filter';

function collectionTotals(products: Product[]): CollectionTotals {
  return products.reduce(
    (acc, product) => ({
      reviews: acc.reviews + (product.reviews?.length ?? 0),
      images: acc.images + (product.images?.length ?? 0),
      variants: acc.variants + (product.variants?.length ?? 0),
      categories: acc.categories + (product.categories?.length ?? 0),
    }),
    { reviews: 0, images: 0, variants: 0, categories: 0 },
  );
}

/**
 * VARIANT C - the one-line answer TypeORM ships with.
 *
 * `relationLoadStrategy: 'query'` (TypeORM 0.3+) loads each relation with its own
 * query instead of joining it, so the main query stops multiplying rows. No hand
 * written pattern, no EXISTS, no manual ordering - just a find option.
 *
 * The open question this variant is here to answer: does it also help when a filter
 * sits on a relation? Filtering still needs a join, and a join still multiplies.
 */
export async function findOptionsQuery(
  ds: DataSource,
  filter: ProductFilter,
): Promise<ListResult> {
  const { limit, skip } = getPaginationParams(filter);

  const where: FindOptionsWhere<Product> = {
    isActive: filter.isActive,
    price: Between(String(filter.minPrice), String(filter.maxPrice)) as never,
  };

  if (filter.categoryId) {
    where.categories = { id: filter.categoryId };
  }

  if (filter.minRating) {
    where.reviews = { rating: MoreThanOrEqual(filter.minRating) };
  }

  const [data, total] = await ds.getRepository(Product).findAndCount({
    relationLoadStrategy: 'query',
    relations: {
      reviews: true,
      images: true,
      variants: true,
      categories: true,
      brand: true,
    },
    where,
    order: { createdAt: 'DESC', id: 'ASC' },
    skip,
    take: limit,
  });

  return {
    ids: data.map((product) => product.id),
    total,
    collections: collectionTotals(data),
  };
}
