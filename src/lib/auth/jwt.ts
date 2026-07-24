import { SignJWT, jwtVerify } from "jose";

export type SessionPayload = {
  userId: string;
  storeId: string;
  email: string;
};

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.userId === "string" &&
      typeof payload.storeId === "string" &&
      typeof payload.email === "string"
    ) {
      return { userId: payload.userId, storeId: payload.storeId, email: payload.email };
    }
    return null;
  } catch {
    return null;
  }
}
