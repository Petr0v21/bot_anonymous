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

  const room = await prisma.room.upsert({
    where: {
      id: '4af695fd-8771-4a1e-9341-ab5a0c835923',
    },
    update: {},
    create: {
      title: 'Test Room',
      description: 'Test description about room!',
      code: 'TEST_CODE_1',
    },
  });
  console.log('Room created!\n', room);
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
