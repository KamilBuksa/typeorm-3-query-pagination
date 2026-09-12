import { readFileSync } from 'fs';
import { join } from 'path';

/** typeorm ships an exports map, so require('typeorm/package.json') does not resolve. */
export function typeormVersion(): string {
  const file = join(
    __dirname,
    '..',
    '..',
    'node_modules',
    'typeorm',
    'package.json',
  );
  return JSON.parse(readFileSync(file, 'utf8')).version as string;
}
