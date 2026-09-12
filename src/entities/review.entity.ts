import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('reviews')
@Index('IDX_reviews_product_rating', ['product', 'rating'])
export class Review {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @ManyToOne(() => Product, (product) => product.reviews)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'tinyint' })
  rating: number;

  @Column({ length: 500 })
  text: string;
}
