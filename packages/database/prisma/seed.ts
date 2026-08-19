import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Minimal dev seed: one organization, one user/member, one project. Enough
 * to exercise the API and web app locally without hand-crafting UUIDs.
 * Extend this as Phase 1 (Core Platform) work adds more entities.
 */
async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'helix-dev' },
    update: {},
    create: { name: 'HELIX Dev Org', slug: 'helix-dev' },
  });

  const user = await prisma.user.upsert({
    where: { email: 'dev@helix.local' },
    update: {},
    create: {
      email: 'dev@helix.local',
      name: 'HELIX Dev User',
      passwordHash: 'not-a-real-hash-replace-in-phase-1',
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: {},
    create: { organizationId: org.id, userId: user.id, role: 'OWNER' },
  });

  await prisma.project.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      organizationId: org.id,
      name: 'Default Project',
      description: 'Seeded default project for local development.',
    },
  });

  console.log('Seed complete:', { organization: org.slug, user: user.email });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
