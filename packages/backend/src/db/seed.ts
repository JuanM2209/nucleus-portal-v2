/**
 * Nucleus Portal - Database seed script
 *
 * Sets a proper bcrypt password hash for the default admin user.
 * Must be run AFTER Docker infrastructure is up.
 *
 * Usage: pnpm run db:seed
 *   (from repo root, or: cd packages/backend && npx tsx src/db/seed.ts)
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import postgres from 'postgres';

// Load .env from repo root (two levels above packages/backend)
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000100';
const ADMIN_EMAIL   = 'admin@nucleus.local';
const ADMIN_PASSWORD = 'Admin123!';
const BCRYPT_ROUNDS  = 10;

async function seed() {
  const connectionString = process.env.DATABASE_URL
    || 'postgres://nucleus:nucleus_dev@localhost:6432/nucleus';

  console.log('[seed] Connecting to database...');
  console.log(`[seed] URL: ${connectionString.replace(/:\/\/.*@/, '://<credentials>@')}`);

  const sql = postgres(connectionString, { max: 1 });

  try {
    // Verify connection
    await sql`SELECT 1`;
    console.log('[seed] Connected.');

    // Check admin user exists
    const [admin] = await sql`
      SELECT id, email, password_hash
      FROM users
      WHERE id = ${ADMIN_USER_ID}
      LIMIT 1
    `;

    if (!admin) {
      console.log('[seed] Admin user not found. Inserting...');

      const [tenant] = await sql`
        SELECT id FROM tenants WHERE slug = 'dev' LIMIT 1
      `;

      if (!tenant) {
        throw new Error('Default tenant (slug=dev) not found. Has init.sql been loaded?');
      }

      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);

      await sql`
        INSERT INTO users (id, tenant_id, email, password_hash, display_name)
        VALUES (
          ${ADMIN_USER_ID},
          ${tenant.id},
          ${ADMIN_EMAIL},
          ${passwordHash},
          'Admin User'
        )
        ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash
      `;

      // Ensure admin role exists and is assigned
      const [adminRole] = await sql`
        SELECT id FROM roles WHERE name = 'admin' AND tenant_id = ${tenant.id} LIMIT 1
      `;

      if (adminRole) {
        await sql`
          INSERT INTO user_roles (user_id, role_id)
          VALUES (${ADMIN_USER_ID}, ${adminRole.id})
          ON CONFLICT DO NOTHING
        `;
      }

      console.log('[seed] Admin user created.');
    } else {
      // Update the password hash (handles placeholder or forced reset)
      console.log(`[seed] Updating password for ${admin.email}...`);
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);

      await sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            updated_at    = NOW()
        WHERE id = ${ADMIN_USER_ID}
      `;

      console.log('[seed] Password updated.');
    }

    console.log('');
    console.log('[seed] Done.');
    console.log(`[seed] Admin credentials:`);
    console.log(`[seed]   Email:    ${ADMIN_EMAIL}`);
    console.log(`[seed]   Password: ${ADMIN_PASSWORD}`);
    console.log('');
  } finally {
    await sql.end();
  }
}

seed().catch((err) => {
  console.error('[seed] Fatal error:', err.message ?? err);
  process.exit(1);
});
