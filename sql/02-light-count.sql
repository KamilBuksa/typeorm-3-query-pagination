-- What variant B runs for its total: no joins at all, so the engine can use
-- COUNT(1) instead of COUNT(DISTINCT id). Same result as 01-heavy-count.sql.
SELECT COUNT(1) AS cnt
FROM products product
WHERE product.is_active = 1
  AND product.price BETWEEN 10 AND 500
  AND EXISTS (SELECT 1 FROM brands b WHERE b.id = product.brand_id);
