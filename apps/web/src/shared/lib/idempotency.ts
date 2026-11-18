/** A fresh key per user intent; retries of the same intent reuse it, so a double click books once. */
export const newKey = (): string => `k-${crypto.randomUUID()}`;
