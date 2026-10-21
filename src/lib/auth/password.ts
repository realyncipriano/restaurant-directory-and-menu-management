import "server-only";

import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$IJ5bzRimeN0+L8YPm/ONfw$izuuTdLMENRgQ6vCrFPZBT8IL7iDKV4R8ZqvS1mqaHU";

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function verifyDummyPassword(password: string): Promise<void> {
  try {
    await verify(DUMMY_HASH, password);
  } catch {
    // Timing equalization only.
  }
}
