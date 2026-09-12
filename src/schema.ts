import { withDataSource } from './data-source';

void withDataSource(async (ds) => {
  await ds.synchronize(true);
  const version = await ds.query('SELECT VERSION() AS v');
  console.log(`schema created (${version[0].v})`);
});
