import { prisma } from "./client.js";

async function main() {
  const users = await prisma.user.count();
  console.log("Users:", users);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
