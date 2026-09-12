import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { Brand } from './entities/brand.entity';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { Review } from './entities/review.entity';
import { Variant } from './entities/variant.entity';
import { captureLogger } from './lib/capture-logger';

dotenv.config();

export const AppDataSource = new DataSource({
  // MariaDB is served by the 'mysql' driver (mysql2), same as the source project.
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3308),
  username: process.env.DB_USER ?? 'bench_user',
  password: process.env.DB_PASSWORD ?? 'bench_pass',
  database: process.env.DB_NAME ?? 'bench',
  entities: [Brand, Category, Product, ProductImage, Review, Variant],
  synchronize: false,
  logging: ['query'],
  logger: captureLogger,
  charset: 'utf8mb4',
  extra: { connectionLimit: 10 },
});

export async function withDataSource<T>(
  fn: (ds: DataSource) => Promise<T>,
): Promise<T> {
  await AppDataSource.initialize();
  try {
    return await fn(AppDataSource);
  } finally {
    await AppDataSource.destroy();
  }
}
