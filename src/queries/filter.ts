export interface ProductFilter {
  isActive: boolean;
  minPrice: number;
  maxPrice: number;
  categoryId?: number;
  minRating?: number;
  page: number;
  limit: number;
}

/** Child collection totals for the whole result page. */
export interface CollectionTotals {
  reviews: number;
  images: number;
  variants: number;
  categories: number;
}

export interface ListResult {
  ids: string[];
  total: number;
  /** Child collection totals - they expose the trap of filtering on a LEFT JOIN. */
  collections?: CollectionTotals;
}

export const DEFAULT_FILTER: ProductFilter = {
  isActive: true,
  minPrice: 10,
  maxPrice: 500,
  categoryId: 1,
  minRating: 4,
  page: 1,
  limit: Number(process.env.PAGE_LIMIT ?? 20),
};

export function getPaginationParams(filter: ProductFilter): {
  limit: number;
  skip: number;
} {
  return { limit: filter.limit, skip: (filter.page - 1) * filter.limit };
}
