import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";

const PgSessionStore = connectPgSimple(session);
const sessionSecret = env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error(
    "SESSION_SECRET is required to start the EMS API. Generate one with: openssl rand -base64 48",
  );
}

export const sessionMiddleware = session({
  name: "ems.sid",
  store: new PgSessionStore({
    pool,
    tableName: "session",
    createTableIfMissing: true,
    pruneSessionInterval: 15 * 60,
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000,
  },
});
