import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  // Create default admin user
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error(
      'SEED_ADMIN_PASSWORD environment variable is required for seeding. ' +
      'Set it before running the seed script.',
    );
  }
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: 'admin@boldervibes.local' },
    update: {},
    create: {
      email: 'admin@boldervibes.local',
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
    },
  });

  console.log('Seed completed: admin user created');

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
