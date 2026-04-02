import * as path from 'path';
import * as dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Load .env from repo root when running drizzle-kit from packages/backend
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: './src/database/schema.ts',
  out:    './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL
      || 'postgres://nucleus:nucleus_dev@localhost:6432/nucleus',
  },
  verbose: true,
  strict:  true,
});
