import { DataSource } from 'typeorm';
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
 * VARIANT A2 - the informed single query.
 *
 * Same JOINs for fetching as variant A, but two things fixed:
 *   - filters use EXISTS, so the returned collections are complete
 *     (variant A truncates them) and the JOINs stay pure fetch JOINs
 *   - the total is a separate JOIN-free COUNT, running in parallel,
 *     instead of getManyAndCount()'s COUNT(DISTINCT) over the joined set
 *
 * This is the fair baseline: everything a careful developer would fix without
 * restructuring the query. What remains is the fetch-side multiplication.
 */
export async function singleQueryLightCount(
  ds: DataSource,
  filter: ProductFilter,
): Promise<ListResult> {
  const { limit, skip } = getPaginationParams(filter);
  const repository = ds.getRepository(Product);

  const conditions = (qb: ReturnType<typeof repository.createQueryBuilder>) => {
    qb.where('product.isActive = :isActive', { isActive: filter.isActive })
      .andWhere('product.price BETWEEN :minPrice AND :maxPrice', {
        minPrice: filter.minPrice,
        maxPrice: filter.maxPrice,
      })
      .andWhere(
        'EXISTS (SELECT 1 FROM brands b WHERE b.id = product.brand_id)',
      );

    if (filter.categoryId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM product_categories pc
                 WHERE pc.product_id = product.id
                   AND pc.category_id = :categoryId)`,
        { categoryId: filter.categoryId },
      );
    }

    if (filter.minRating) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM reviews r
                 WHERE r.product_id = product.id
                   AND r.rating >= :minRating)`,
        { minRating: filter.minRating },
      );
    }

    return qb;
  };

  const dataQuery = conditions(
    repository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.reviews', 'reviews')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('product.categories', 'categories')
      .leftJoinAndSelect('product.variants', 'variants')
      .innerJoinAndSelect('product.brand', 'brand'),
  )
    .orderBy('product.createdAt', 'DESC')
    .addOrderBy('product.id', 'ASC')
    .skip(skip)
    .take(limit);

  const countQuery = conditions(repository.createQueryBuilder('product'));

  const [data, total] = await Promise.all([
    dataQuery.getMany(),
    countQuery.getCount(),
  ]);

  return {
    ids: data.map((product) => product.id),
    total,
    collections: collectionTotals(data),
  };
}
