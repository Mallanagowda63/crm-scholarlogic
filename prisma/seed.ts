import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { DEMO_PASSWORD, DEMO_USERS } from "../src/lib/demo-users";

const db = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo accounts in production.");
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  for (const user of DEMO_USERS) {
    await db.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, passwordHash, isActive: true },
      create: { ...user, passwordHash },
    });
  }
  console.log(`Seeded ${DEMO_USERS.length} users.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
