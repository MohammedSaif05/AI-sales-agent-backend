import { PrismaClient, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PhoneNormalizer } from '../common/utils/phone-normalizer.util';

const prisma = new PrismaClient();

async function main() {
  const superAdminPhone = process.env.SUPER_ADMIN_PHONE;
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;
  const superAdminName =
    process.env.SUPER_ADMIN_NAME || 'Platform Administrator';

  if (!superAdminPhone || !superAdminPassword) {
    console.warn(
      '⚠️ SUPER_ADMIN_PHONE or SUPER_ADMIN_PASSWORD not set in environment. Skipping Super Admin seeding.',
    );
    return;
  }

  const phoneResult = PhoneNormalizer.normalize(superAdminPhone);
  if (!phoneResult.isValid || !phoneResult.normalized) {
    console.error(
      `❌ SUPER_ADMIN_PHONE (${superAdminPhone}) is not a valid phone number: ${phoneResult.error}`,
    );
    return;
  }

  const existingSuperAdmin = await prisma.user.findUnique({
    where: { phone: phoneResult.normalized },
  });

  if (existingSuperAdmin) {
    console.log(
      `ℹ️ Super Admin user with phone ${phoneResult.normalized} already exists (ID: ${existingSuperAdmin.id}).`,
    );
    return;
  }

  const passwordHash = await argon2.hash(superAdminPassword);

  const superAdmin = await prisma.user.create({
    data: {
      phone: phoneResult.normalized,
      passwordHash,
      name: superAdminName,
      systemRole: SystemRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  console.log(
    `✅ Super Admin seeded successfully: Phone ${superAdmin.phone} (ID: ${superAdmin.id})`,
  );
}

main()
  .catch((e) => {
    console.error('❌ Error during database seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
