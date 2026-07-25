/* eslint-disable @typescript-eslint/no-explicit-any -- concise partial Prisma fixtures */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getStoreById, updateStoreSettings } from "@/lib/services/store-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("getStoreById", () => {
  it("returns the store when found", async () => {
    const fakeStore = { id: "store_1", name: "Test Mağaza" } as any;
    prismaMock.store.findUnique.mockResolvedValue(fakeStore);

    const result = await getStoreById("store_1");

    expect(result).toEqual(fakeStore);
    expect(prismaMock.store.findUnique).toHaveBeenCalledWith({ where: { id: "store_1" } });
  });

  it("returns null when not found", async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);
    const result = await getStoreById("missing");
    expect(result).toBeNull();
  });
});

describe("updateStoreSettings", () => {
  it("updates only the provided fields", async () => {
    const fakeStore = { id: "store_1", name: "Yeni İsim" } as any;
    prismaMock.store.update.mockResolvedValue(fakeStore);

    const result = await updateStoreSettings("store_1", { name: "Yeni İsim" });

    expect(result).toEqual(fakeStore);
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: "store_1" },
      data: { name: "Yeni İsim" },
    });
  });
});
