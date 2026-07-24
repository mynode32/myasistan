import type { Store, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { RegisterInput } from "@/lib/validation/auth";

export async function registerStoreWithOwner(
  input: RegisterInput,
): Promise<{ store: Store; user: User }> {
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(
    async (tx) => {
      const store = await tx.store.create({
        data: { name: input.storeName },
      });
      const user = await tx.user.create({
        data: { storeId: store.id, email: input.email, passwordHash },
      });
      return { store, user };
    },
    // Supabase's pgbouncer pool (transaction mode, port 6543) plus network
    // latency can exceed Prisma's 2s/5s defaults for acquiring a
    // transaction-pinned connection, intermittently throwing P2028
    // ("Unable to start a transaction in the given time"). Raised both
    // well above observed latency.
    { maxWait: 10000, timeout: 10000 },
  );
}

export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<{ store: Store; user: User } | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return null;
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  const store = await prisma.store.findUnique({ where: { id: user.storeId } });
  if (!store) {
    return null;
  }

  return { store, user };
}
