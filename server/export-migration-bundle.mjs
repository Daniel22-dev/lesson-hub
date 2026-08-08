#!/usr/bin/env node
import path from 'node:path';
import { JsonStore } from './lib/store.mjs';
import { exportMigrationBundle } from './lib/persistence.mjs';

const source = path.resolve(process.argv[2] || process.env.LESSON_HUB_DATA_FILE || './data/lesson-hub.json');
const output = path.resolve(process.argv[3] || `./migration-export-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const store = await new JsonStore(source).open();
const manifest = await exportMigrationBundle(store.snapshot(), output);
console.log(JSON.stringify({ source, output, manifest }, null, 2));
