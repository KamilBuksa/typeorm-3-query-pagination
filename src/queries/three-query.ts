import { DataSource } from 'typeorm';
import { Product } from '../entities/product.entity';
import {
  ListResult,
  ProductFilter,
  CollectionTotals,
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
 * VARIANT B - three lightweight queries.
 * 1a: filter and paginate on IDs only (EXISTS instead of JOIN)
 * 1b: COUNT on the same lightweight query, in parallel
 * 2:  full data with JOINs for one page of IDs only
 */
export async function threeQuery(
  ds: DataSource,
  filter: ProductFilter,
): Promise<ListResult> {
  const { limit, skip } = getPaginationParams(filter);
  const repository = ds.getRepository(Product);

  const idsQuery = repository
    .createQueryBuilder('product')
    // EXISTS, not innerJoin: any join here would switch getCount() from
    // COUNT(1) to COUNT(DISTINCT id). See npm run sql-proof, section 4.
    .andWhere('EXISTS (SELECT 1 FROM brands b WHERE b.id = product.brand_id)')
    .andWhere('product.isActive = :isActive', { isActive: filter.isActive })
    .andWhere('product.price BETWEEN :minPrice AND :maxPrice', {
      minPrice: filter.minPrice,
      maxPrice: filter.maxPrice,
    });

  if (filter.categoryId) {
    idsQuery.andWhere(
      `EXISTS (SELECT 1 FROM product_categories pc
               WHERE pc.product_id = product.id
                 AND pc.category_id = :categoryId)`,
      { categoryId: filter.categoryId },
    );
  }

  if (filter.minRating) {
    idsQuery.andWhere(
      `EXISTS (SELECT 1 FROM reviews r
               WHERE r.product_id = product.id
                 AND r.rating >= :minRating)`,
      { minRating: filter.minRating },
    );
  }

  const [paginatedIds, total] = await Promise.all([
    // offset/limit, not skip/take - with a join present, skip/take are ignored
    // by getRawMany(). Proof: npm run sql-proof
    idsQuery
      .clone()
      .select('product.id', 'id')
      .offset(skip)
      .orderBy('product.createdAt', 'DESC')
      .addOrderBy('product.id', 'ASC')
      .limit(limit)
      .getRawMany<{ id: string }>(),

    idsQuery.clone().getCount(),
  ]);

  const ids = paginatedIds.map((row) => row.id);

  if (!ids.length) {
    return { ids: [], total };
  }

  const data = await repository
    .createQueryBuilder('product')
    .leftJoinAndSelect('product.reviews', 'reviews')
    .leftJoinAndSelect('product.images', 'images')
    .leftJoinAndSelect('product.categories', 'categories')
    .leftJoinAndSelect('product.variants', 'variants')
    .innerJoinAndSelect('product.brand', 'brand')
    .whereInIds(ids)
    .getMany();

  // SQL does not guarantee order for WHERE IN (...) - restore it in JS
  const orderPosition = new Map(ids.map((id, index) => [id, index]));
  data.sort(
    (a, b) =>
      (orderPosition.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderPosition.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    ids: data.map((product) => product.id),
    total,
    collections: collectionTotals(data),
  };
}
