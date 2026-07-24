import { beforeAll, describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "@/lib/auth/jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
});

describe("session JWT", () => {
  const payload = { userId: "user_1", storeId: "store_1", email: "owner@example.com" };

  it("round-trips a valid token", async () => {
    const token = await signSessionToken(payload);
    const decoded = await verifySessionToken(token);
    expect(decoded).toEqual(payload);
  });

  it("returns null for a tampered token", async () => {
    const token = await signSessionToken(payload);
    const tampered = token.slice(0, -2) + "xx";
    const decoded = await verifySessionToken(tampered);
    expect(decoded).toBeNull();
  });

  it("returns null for garbage input", async () => {
    const decoded = await verifySessionToken("not-a-real-token");
    expect(decoded).toBeNull();
  });
});
