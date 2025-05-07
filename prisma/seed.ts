import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
async function main() {
  const root = await prisma.user.upsert({
    where: {
      id: '772526893',
    },
    update: {},
    create: {
      id: '772526893',
      isAdmin: true,
      firstName: 'admin',
      username: 'admin',
    },
  });
  console.log('Root user created!\n', root);
}
main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
