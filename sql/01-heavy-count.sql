-- What getManyAndCount() runs under the hood: COUNT over 1:N joins.
SELECT COUNT(DISTINCT product.id) AS cnt
FROM products product
INNER JOIN brands brand ON brand.id = product.brand_id
LEFT JOIN reviews reviews ON reviews.product_id = product.id
LEFT JOIN product_images images ON images.product_id = product.id
LEFT JOIN product_categories pc ON pc.product_id = product.id
LEFT JOIN variants variants ON variants.product_id = product.id
WHERE product.is_active = 1
  AND product.price BETWEEN 10 AND 500;
