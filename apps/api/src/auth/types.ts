import type { Role } from "./constants.js";

export type AuthenticatedUser = {
  userId: string;
  role: Role;
  adminScope: "FULL" | "DEPARTMENT" | null;
  isRoot: boolean;
  administeredDepartmentId: string | null;
  employeeRecordId: string | null;
  employeeId: string | null;
  firstName: string | null;
  lastName: string | null;
  employmentStatus: string | null;
  mustChangePassword: boolean;
};

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}
