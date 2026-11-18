import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@clinic/db';
import type { Role } from '@clinic/shared';
import type { Actor } from '@clinic/domain';

export const SESSION_COOKIE = 'sid';

export type SessionUser = {
  userId: string;
  email: string;
  role: Role;
  patientId: string | null;
  clinicId: string | null;
  doctorId: string | null;
  fullName: string | null;
  locale: string | null;
};

export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

export const toActor = (u: SessionUser | null): Actor | null =>
  u ? { userId: u.userId, role: u.role, patientId: u.patientId, clinicId: u.clinicId, doctorId: u.doctorId } : null;

/** Opaque random token; only its SHA-256 is stored, so a database leak does not leak sessions. */
export const createSession = async (db: Db, userId: string, ttlHours: number, now: Date): Promise<{ token: string; expiresAt: Date }> => {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
  await db.execute(sql`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (${hashToken(token)}, ${userId}::uuid, ${now.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz)`);
  return { token, expiresAt };
};

export const findSessionUser = async (db: Db, token: string | undefined, now: Date): Promise<SessionUser | null> => {
  if (!token || token.length < 20 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const r = await db.execute(sql`
    SELECT u.id AS user_id, u.email, u.role, u.clinic_id, u.doctor_id, p.id AS patient_id, p.full_name, p.locale
    FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN patients p ON p.user_id = u.id
    WHERE s.token_hash = ${hashToken(token)} AND s.revoked_at IS NULL AND s.expires_at > ${now.toISOString()}::timestamptz`);
  const x = r.rows[0] as Record<string, unknown> | undefined;
  if (!x) return null;
  return {
    userId: String(x['user_id']),
    email: String(x['email']),
    role: String(x['role']) as Role,
    patientId: x['patient_id'] ? String(x['patient_id']) : null,
    clinicId: x['clinic_id'] ? String(x['clinic_id']) : null,
    doctorId: x['doctor_id'] ? String(x['doctor_id']) : null,
    fullName: x['full_name'] ? String(x['full_name']) : null,
    locale: x['locale'] ? String(x['locale']) : null,
  };
};

export const revokeSession = async (db: Db, token: string, now: Date): Promise<void> => {
  await db.execute(sql`UPDATE sessions SET revoked_at = ${now.toISOString()}::timestamptz WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL`);
};

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header || header.length > 4096) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!(k in out)) out[k] = decodeURIComponent(v.replace(/^"|"$/g, '')).slice(0, 512);
  }
  return out;
};

export const sessionCookie = (token: string, expiresAt: Date, secure: boolean): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure ? '; Secure' : ''}`;
export const clearCookie = (secure: boolean): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`;
