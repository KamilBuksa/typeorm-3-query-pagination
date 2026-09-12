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
 * VARIANT A - one heavy query.
 * Four LEFT JOINs on 1:N relations + getManyAndCount().
 */
export async function singleQuery(
  ds: DataSource,
  filter: ProductFilter,
): Promise<ListResult> {
  const { limit, skip } = getPaginationParams(filter);

  const qb = ds
    .getRepository(Product)
    .createQueryBuilder('product')
    .leftJoinAndSelect('product.reviews', 'reviews')
    .leftJoinAndSelect('product.images', 'images')
    .leftJoinAndSelect('product.categories', 'categories')
    .leftJoinAndSelect('product.variants', 'variants')
    .innerJoinAndSelect('product.brand', 'brand')
    .where('product.isActive = :isActive', { isActive: filter.isActive })
    .andWhere('product.price BETWEEN :minPrice AND :maxPrice', {
      minPrice: filter.minPrice,
      maxPrice: filter.maxPrice,
    });

  if (filter.categoryId) {
    qb.andWhere('categories.id = :categoryId', {
      categoryId: filter.categoryId,
    });
  }

  if (filter.minRating) {
    qb.andWhere('reviews.rating >= :minRating', {
      minRating: filter.minRating,
    });
  }

  const [data, total] = await qb
    .orderBy('product.createdAt', 'DESC')
    .addOrderBy('product.id', 'ASC')
    .skip(skip)
    .take(limit)
    .getManyAndCount();

  return {
    ids: data.map((product) => product.id),
    total,
    collections: collectionTotals(data),
  };
}
