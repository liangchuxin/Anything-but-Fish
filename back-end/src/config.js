function integer(value, fallback, name, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function boolean(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false.`);
  return value === "true";
}

function httpUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTP(S) URL.`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials.`);
  }
  return url;
}

export function readConfig(env = process.env) {
  const mongodbUri = env.MONGODB_URI;
  if (!/^mongodb(?:\+srv)?:\/\//.test(mongodbUri ?? "") || /<[^>]+>/.test(mongodbUri)) {
    throw new Error("Set MONGODB_URI to a complete MongoDB connection string in back-end/.env.");
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /^(replace|change|your)[_-]/i.test(env.JWT_SECRET)) {
    throw new Error("Set JWT_SECRET to a random secret of at least 32 characters.");
  }
  const frontend = httpUrl(env.FRONTEND_ORIGIN || "http://localhost:5173", "FRONTEND_ORIGIN");
  if (frontend.href !== `${frontend.origin}/`) throw new Error("FRONTEND_ORIGIN must contain only an origin.");
  const secureCookies = boolean(env.AUTH_COOKIE_SECURE, env.NODE_ENV === "production", "AUTH_COOKIE_SECURE");
  const sameSite = env.AUTH_COOKIE_SAME_SITE || "lax";
  if (!["lax", "strict", "none"].includes(sameSite) || (sameSite === "none" && !secureCookies)) {
    throw new Error("AUTH_COOKIE_SAME_SITE must be lax, strict, or none; none requires secure cookies.");
  }
  if (env.NODE_ENV === "production" && (!secureCookies || frontend.protocol !== "https:")) {
    throw new Error("Production requires secure cookies and an HTTPS frontend URL.");
  }
  const cookieName = env.AUTH_SESSION_COOKIE || "abf_session";
  if (!/^[A-Za-z0-9_-]+$/.test(cookieName)) throw new Error("AUTH_SESSION_COOKIE is not a valid cookie name.");
  const dbName = env.MONGODB_DB_NAME || "anything_but_fish";
  if (!/^[A-Za-z0-9_-]+$/.test(dbName)) throw new Error("MONGODB_DB_NAME contains unsupported characters.");
  return {
    mongodbUri, dbName, jwtSecret: env.JWT_SECRET, cookieName, secureCookies, sameSite,
    frontendOrigin: frontend.origin,
    port: integer(env.PORT, 8000, "PORT", 1, 65535),
    sessionTtlSeconds: integer(env.AUTH_SESSION_TTL_SECONDS, 604800, "AUTH_SESSION_TTL_SECONDS", 60, 2592000),
    trustProxy: integer(env.TRUST_PROXY, 0, "TRUST_PROXY", 0, 5),
    authRateLimit: 30,
  };
}
