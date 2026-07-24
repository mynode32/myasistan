import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { registerStoreWithOwner, loginWithCredentials } from "@/lib/services/auth-service";
import { hashPassword } from "@/lib/auth/password";

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("registerStoreWithOwner", () => {
  it("creates a store and an owner user inside a transaction", async () => {
    const fakeStore = { id: "store_1", name: "Test Mağaza" } as any;
    const fakeUser = { id: "user_1", storeId: "store_1", email: "owner@example.com" } as any;

    prismaMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        store: { create: vi.fn().mockResolvedValue(fakeStore) },
        user: { create: vi.fn().mockResolvedValue(fakeUser) },
      }),
    );

    const result = await registerStoreWithOwner({
      storeName: "Test Mağaza",
      email: "owner@example.com",
      password: "supersecret1",
    });

    expect(result.store).toEqual(fakeStore);
    expect(result.user).toEqual(fakeUser);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("loginWithCredentials", () => {
  it("returns store and user when the password matches", async () => {
    const passwordHash = await hashPassword("supersecret1");
    const fakeUser = {
      id: "user_1",
      storeId: "store_1",
      email: "owner@example.com",
      passwordHash,
    } as any;
    const fakeStore = { id: "store_1", name: "Test Mağaza" } as any;

    prismaMock.user.findUnique.mockResolvedValue(fakeUser);
    prismaMock.store.findUnique.mockResolvedValue(fakeStore);

    const result = await loginWithCredentials("owner@example.com", "supersecret1");

    expect(result?.user.id).toBe("user_1");
    expect(result?.store.id).toBe("store_1");
  });

  it("returns null when the user does not exist", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await loginWithCredentials("nobody@example.com", "whatever");

    expect(result).toBeNull();
  });

  it("returns null when the password is wrong", async () => {
    const passwordHash = await hashPassword("supersecret1");
    const fakeUser = {
      id: "user_1",
      storeId: "store_1",
      email: "owner@example.com",
      passwordHash,
    } as any;

    prismaMock.user.findUnique.mockResolvedValue(fakeUser);

    const result = await loginWithCredentials("owner@example.com", "wrong-password");

    expect(result).toBeNull();
  });
});
