import { hash, verify } from '@node-rs/argon2';

export type ArgonParams = { memoryCost: number; timeCost: number };

export const hashPassword = (plain: string, p: ArgonParams): Promise<string> =>
  hash(plain, { memoryCost: p.memoryCost, timeCost: p.timeCost, parallelism: 1 });

export const verifyPassword = async (storedHash: string, plain: string): Promise<boolean> => {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
};

/**
 * A real hash of a random password, computed once: verifying against it for unknown emails keeps
 * the response time the same as for a wrong password (no account enumeration by timing).
 */
let dummy: Promise<string> | undefined;
export const dummyHash = (p: ArgonParams): Promise<string> => (dummy ??= hashPassword(`dummy-${Math.random()}-${Date.now()}`, p));
