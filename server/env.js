// Loads .env before anything else runs. Import this FIRST in every entry point
// (index.js, seed.js). ES module imports are hoisted and evaluated depth-first
// in source order, so importing this module first guarantees process.env is
// populated before any downstream module reads it at top level.
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });
