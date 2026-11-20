export const ROLES = ["ADMIN", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];
