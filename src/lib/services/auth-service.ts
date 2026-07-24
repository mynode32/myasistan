import type { Store, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { RegisterInput } from "@/lib/validation/auth";

export async function registerStoreWithOwner(
  input: RegisterInput,
): Promise<{ store: Store; user: User }> {
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const store = await tx.store.create({
      data: { name: input.storeName },
    });
    const user = await tx.user.create({
      data: { storeId: store.id, email: input.email, passwordHash },
    });
    return { store, user };
  });
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
