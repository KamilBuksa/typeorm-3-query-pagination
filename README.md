# Paginated lists over 1:N relations: what actually costs you

A reproducible benchmark. TypeORM 0.3.11, MariaDB 10.5.29 in Docker, 50k products
with four child collections.

A `LEFT JOIN` on a 1:N relation multiplies rows. One product with 5 reviews, 3 images,
4 variants and 2 categories is not one row — it is up to 120. On this dataset the
five-way join turns 50,000 products into **4,279,620 rows**, and every filter, sort,
`LIMIT` and `COUNT` runs on top of that.

The interesting part is not that this is slow. It is *which* part is slow, and how little
you have to change to fix most of it.

## The four variants

All four return identical ids and identical totals on every page — `npm run verify`
asserts it before any measurement is trusted.

- **A** — `getManyAndCount()` with the JOINs. What most code looks like.
  `src/queries/single-query.ts`
- **A2** — same JOINs for fetching, but filters moved to `EXISTS` and the total taken from
  a separate JOIN-free `COUNT`, in parallel. The two-line fix.
  `src/queries/single-query-light-count.ts`
- **B** — filtering and fetching split: page of ids first (`EXISTS`, no JOINs), `COUNT` in
  parallel, then one fetch by id for that page. The hand-written pattern.
  `src/queries/three-query.ts`
- **C** — `relationLoadStrategy: 'query'`, a TypeORM 0.3 find option that loads each
  relation with its own query instead of joining it. One line.
  `src/queries/find-options-query.ts`

## Results

p50 of 20 measured runs after 3 warm-ups, page 1, page size 20, variants interleaved.
Raw numbers: `results/bench-2026-09-12T13-22-26-322Z.json`.

| Filters | A `getManyAndCount()` | A2 light COUNT | B split | C `relationLoadStrategy` |
|---|---|---|---|---|
| broad — `is_active` + price (24,754 match) | 5,708 ms | 501 ms | 115 ms | **72 ms** |
| broad filter on a relation — `rating >= 1` (22,478 match) | 5,773 ms | 952 ms | **191 ms** | 326 ms |
| selective — category + `rating >= 4` (1,204 match) | 127 ms | 520 ms | 51 ms | **39 ms** |

Read it top to bottom and the story is:

**The `COUNT` is the cliff, not the pagination.** `ANALYZE FORMAT=JSON` on variant A,
broad filters (`results/explain-broad-page-1.json`): `COUNT(DISTINCT product.id)` over the
joined set takes 4,803 ms, picking the page of ids takes 401 ms, fetching the 20 entities
takes 6 ms. The count is 92% of the request. Fixing only that — variant A2 — takes 5,708 ms
down to 501 ms without touching how the data is fetched.

**Then the fetch-side JOINs are what is left.** Removing them gets you to 72–115 ms.
`relationLoadStrategy: 'query'` does it in one line and wins wherever it applies.

**Except when a filter sits on a relation.** A join used for *filtering* cannot be removed
by a fetch-side option, and it multiplies just the same: in row two variant C falls to
326 ms while the hand-written split, which filters with `EXISTS`, holds at 191 ms. That
row is the entire justification for writing the pattern yourself.

**Variant A2 can be slower than A** (selective row, 520 ms vs 127 ms) — and that is not a
bug. Variant A filters on the same `LEFT JOIN`s it selects, so MariaDB prunes the join
early *and* returns truncated collections. A2 pays for being correct. See below.

### Indexes do not fix this

Every filter has a dedicated index: `products (is_active, price)`, `products (created_at)`,
`reviews (product_id, rating)`, plus the `product_categories` primary key. All numbers
above are measured with them.

`npm run bench:indexes` re-runs with only the indexes foreign keys force the engine to keep
(p50, 10 runs, `results/bench-indexes-2026-09-12T13-26-08-580Z.json`):

| Filters | Variant | Full indexes | Minimal indexes |
|---|---|---|---|
| broad | A | 6,005 ms | 5,830 ms |
| broad | A2 | 579 ms | 498 ms |
| broad | B | 114 ms | 185 ms |
| broad | C | 68 ms | 42 ms |

Dropping the indexes does not move variant A at all. No index removes rows a `LEFT JOIN`
invents — an index makes *finding* rows cheaper, and the problem here is how many rows
exist after they are found.

Switching configurations needs no second database: creating these indexes on 50k products
takes 64–644 ms and `bench:indexes` restores the full set when it finishes.

### One silent correctness bug

Variant A filters on `reviews.rating >= 4` and `categories.id = 1` on `LEFT JOIN`s that
also feed the returned entities. Same 20 products, `npm run demo`:

| Collection | A | A2 | B | C |
|---|---|---|---|---|
| reviews | 57 | 133 | 133 | 133 |
| categories | 20 | 65 | 65 | 65 |
| images | 67 | 67 | 67 | 67 |
| variants | 79 | 79 | 79 | 79 |

A product reaches the list because it has one review rated 4+, and then comes back carrying
only that review. The list looks right, the total is right, and the payload is wrong.
Splitting filtering from fetching fixes a correctness bug, not only a performance one.

## Run it

```bash
cp .env.example .env
npm install
npm run db:up      # MariaDB on port 3308
npm run schema
npm run seed       # 50k products + ~750k child rows, deterministic (faker seed 42)

npm run verify     # 30 assertions about the setup - run this first
npm run demo       # all four variants, three filter shapes, ~40 s
```

Then, for the numbers behind the tables:

```bash
npm run bench          # p50/p90/max per variant, writes results/bench-*.json
npm run bench:indexes  # the same with and without the filter indexes
npm run explain        # ANALYZE FORMAT=JSON plans, per statement
npm run sql-proof      # the SQL TypeORM actually emits, writes results/sql-proof.md
npm run indexes -- status
```

Scale is configurable: `PRODUCTS=200000 npm run seed` (then `verify` will report the new
counts as mismatches — update `src/expected.ts` if you want it to pass).

## Verify before you trust

`npm run verify` refuses to let a number outlive its setup. It asserts the MariaDB version,
buffer pool size, that the query cache is off, that the server is idle, every table's row
count, the size of the multiplied join, the presence of each index, and that all four
variants return identical ids and totals across three filter shapes and three page depths.
30 checks, `results/verify.json`, non-zero exit on the first failure.

## Two gotchas worth knowing

**`skip`/`take` with a join and `getRawMany()` emits no `LIMIT`.** `npm run sql-proof`
prints the statement. `createLimitOffsetExpression()` maps `skip`/`take` onto `OFFSET`/`LIMIT`
only when `joinAttributes.length === 0`; with a join present, pagination is handled by the
entity path, and `getRawMany()` does not take it. Nothing fails — you just get every row.
Use `offset`/`limit` there.

**`getCount()` is `COUNT(1)` only with zero joins.** Any `innerJoin` in the counting query,
even on a relation that multiplies nothing, switches it to `COUNT(DISTINCT id)`. That is why
variant B checks the brand with `EXISTS` instead of joining it.

## Method

- Variants are interleaved within each measurement loop and their order is rotated every
  iteration, so no variant is always the one that warms the buffer pool.
- Reported figures are p50 of 20 runs after 3 warm-ups. `p90` and `max` are in the JSON;
  with n=20 treat them as spread, not as tail latency.
- Warm cache on purpose: `innodb_buffer_pool_size=1G`, query cache off, dataset fits in RAM.
  This is the state a busy list endpoint runs in.
- The seed is deterministic — fixed faker seed, faker-generated uuids — so the dataset,
  the totals and the physical row order are the same on every machine.
- The `minimal` index configuration keeps the indexes foreign keys require, because a real
  schema cannot drop those either. `reviews (product_id, rating)` is swapped for
  `reviews (product_id)` rather than removed.
