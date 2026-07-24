import type { Store } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { UpdateStoreInput } from "@/lib/validation/store";

export async function getStoreById(storeId: string): Promise<Store | null> {
  return prisma.store.findUnique({ where: { id: storeId } });
}

export async function updateStoreSettings(
  storeId: string,
  input: UpdateStoreInput,
): Promise<Store> {
  return prisma.store.update({ where: { id: storeId }, data: input });
}
