import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { expect } from "chai";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { connectDatabase } from "../src/database.js";
import { hashPassword, verifyPassword, hashToken, issueSession, readSession } from "../src/security.js";

dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

const email = "player@example.com";
const password = "River-light-2026";
const newPassword = "Archive-light-2026";
const baseEnv = { MONGODB_URI: "mongodb://test.example.invalid", JWT_SECRET: "a".repeat(64) };

describe("Authentication configuration and cryptography", () => {
  it("validates defaults and production cookie settings", () => {
    const config = readConfig(baseEnv);
    expect(config.port).to.equal(8000);
    expect(config.secureCookies).to.equal(false);
    expect(readConfig({ ...baseEnv, NODE_ENV: "production", FRONTEND_ORIGIN: "https://game.example.com" }).secureCookies).to.equal(true);
  });

  for (const settings of [
    { MONGODB_URI: "" }, { MONGODB_URI: "mongodb+srv://username:<db_password>@example.com/" },
    { JWT_SECRET: "short" }, { JWT_SECRET: "replace_with_a_random_secret_of_at_least_32_characters" },
    { PORT: "0" }, { PORT: "not-a-port" }, { AUTH_SESSION_TTL_SECONDS: "30" },
    { FRONTEND_ORIGIN: "bad" }, { FRONTEND_ORIGIN: "ftp://example.com" },
    { FRONTEND_ORIGIN: "http://user:password@example.com" }, { FRONTEND_ORIGIN: "https://example.com/api" },
    { AUTH_COOKIE_SECURE: "yes" },
    { AUTH_COOKIE_SAME_SITE: "none" }, { AUTH_COOKIE_SAME_SITE: "invalid" },
    { NODE_ENV: "production", AUTH_COOKIE_SECURE: "false" },
    { NODE_ENV: "production", FRONTEND_ORIGIN: "http://example.com" },
    { AUTH_SESSION_COOKIE: "bad;cookie" }, { MONGODB_DB_NAME: "bad/name" },
    { TRUST_PROXY: "true" },
  ]) {
    it(`rejects invalid ${Object.keys(settings).join("/")}`, () => {
      expect(() => readConfig({ ...baseEnv, ...settings })).to.throw();
    });
  }

  it("salts passwords, checks them, and rejects corrupt hashes", async () => {
    const hash = await hashPassword(password);
    expect(hash).not.to.equal(await hashPassword(password));
    expect(hash).not.to.contain(password);
    expect(await verifyPassword(password, hash)).to.equal(true);
    expect(await verifyPassword("wrong", hash)).to.equal(false);
    expect(await verifyPassword(password, "broken")).to.equal(false);
    expect(await verifyPassword(password, undefined)).to.equal(false);
  });

  it("rejects tampered, expired, wrong-audience, and incomplete JWTs", () => {
    const config = readConfig(baseEnv);
    const user = { id: "0123456789abcdef01234567", authVersion: 0 };
    const issued = issueSession(user, config);
    expect(readSession(issued.token, config).sub).to.equal(user.id);
    expect(readSession(undefined, config)).to.equal(null);
    expect(readSession("a".repeat(5000), config)).to.equal(null);
    expect(readSession(`${issued.token}x`, config)).to.equal(null);
    expect(readSession(issueSession(user, { ...config, sessionTtlSeconds: -1 }).token, config)).to.equal(null);
    for (const payload of [
      { sub: user.id, jti: "a".repeat(64), v: 0, aud: "other" },
      { sub: "bad", jti: "a".repeat(64), v: 0, aud: "anything-but-fish" },
      { sub: user.id, v: 0, aud: "anything-but-fish" },
      { sub: user.id, jti: "a".repeat(64), aud: "anything-but-fish" },
    ]) {
      const token = jwt.sign(payload, config.jwtSecret, { issuer: "anything-but-fish-api", expiresIn: 60 });
      expect(readSession(token, config)).to.equal(null);
    }
  });

});

describe("MongoDB authentication API", function () {
  let database, models, config, app;
  const logs = [];
  const logger = { error: (...args) => logs.push(args) };
  const dbName = `abf_auth_test_${randomBytes(8).toString("hex")}`;

  before(async function () {
    const mongodbUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;
    if (!mongodbUri) throw new Error("Set TEST_MONGODB_URI or back-end/.env MONGODB_URI for the Atlas integration tests.");
    config = { ...readConfig({ ...baseEnv, MONGODB_URI: mongodbUri }), dbName, authRateLimit: 500 };
    try { database = await connectDatabase(config); }
    catch (error) { throw new Error(`Test database connection failed (${error.name}). Check Atlas credentials and network access.`); }
    models = database.models;
    app = createApp({ config, models, logger });
  });

  afterEach(async () => {
    if (models) await Promise.all(Object.values(models).map((model) => model.deleteMany({})));
    logs.length = 0;
  });

  after(async () => {
    if (database) {
      // The generated database belongs only to this run, never the configured app database.
      expect(database.connection.name).to.equal(dbName);
      expect(dbName).to.match(/^abf_auth_test_[a-f0-9]{16}$/);
      await database.connection.dropDatabase();
      await database.connection.close();
    }
  });

  const register = (data = { email, password }) => request(app).post("/api/auth/register").send(data);
  const login = (data = { email, password }) => request(app).post("/api/auth/login").send(data);
  const getCookie = (response) => response.headers["set-cookie"][0].split(";")[0];
  async function registerAndLogin() {
    await register().expect(201);
    return getCookie(await login().expect(200));
  }

  // Seed an existing recovery token; production no longer issues or delivers links.
  async function seedResetToken() {
    const user = await models.User.findOne({ email });
    const token = randomBytes(32).toString("hex");
    await models.PasswordResetToken.create({
      userId: user._id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000),
    });
    return token;
  }

  it("reports database health and returns JSON for unknown endpoints", async () => {
    await request(app).get("/api/health").expect(200, { status: "ok" });
    await request(app).get("/api/missing").expect(404, { detail: "API endpoint not found." });
  });

  it("creates a normalized account with a hash and hides private fields", async () => {
    const response = await register({ email: " Player@Example.com ", password, role: "admin" }).expect(201);
    expect(response.body).to.have.all.keys("message");
    const user = await models.User.findOne({ email }).select("+passwordHash +authVersion");
    expect(user.email).to.equal(email);
    expect(await verifyPassword(password, user.passwordHash)).to.equal(true);
    expect(user.toObject()).not.to.have.any.keys("password", "role");
    expect(user.createdAt).to.be.instanceOf(Date);
    expect((await models.User.findById(user.id)).passwordHash).to.equal(undefined);
  });

  it("enforces email uniqueness even for concurrent registrations", async () => {
    const responses = await Promise.all([register(), register({ email: email.toUpperCase(), password })]);
    expect(responses.map((response) => response.status).sort()).to.deep.equal([201, 409]);
    expect(await models.User.countDocuments()).to.equal(1);
  });

  it("validates emails, password bounds, and query-operator payloads", async () => {
    for (const data of [
      {}, { email: "invalid", password }, { email, password: "short" },
      { email, password: "a".repeat(129) }, { email: { $ne: null }, password },
      { email, password: { $ne: null } }, { email: "a".repeat(250) + "@example.com", password },
    ]) await register(data).expect(400);
    expect(await models.User.countDocuments()).to.equal(0);
  });

  it("returns the same failure for missing accounts and wrong passwords", async () => {
    const missing = await login().expect(401);
    await register().expect(201);
    const wrong = await login({ email, password: "wrong" }).expect(401);
    expect(missing.body).to.deep.equal(wrong.body);
    expect(await models.Session.countDocuments()).to.equal(0);
  });

  it("sets an HttpOnly JWT cookie, restores the account, and stores only a session hash", async () => {
    await register().expect(201);
    const response = await login({ email: email.toUpperCase(), password }).expect(200);
    expect(response.body.user).to.have.all.keys("id", "email");
    expect(response.headers["set-cookie"][0]).to.contain("HttpOnly").and.contain("SameSite=Lax");
    const cookie = getCookie(response);
    const token = cookie.slice(cookie.indexOf("=") + 1);
    const claims = readSession(token, config);
    const session = await models.Session.findOne();
    expect(session.tokenHash).to.equal(hashToken(claims.jti));
    expect(session.toObject()).not.to.have.any.keys("token", "password");
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body).to.deep.equal(response.body);
    expect(me.headers["cache-control"]).to.equal("no-store");
    const resetIndexes = await models.PasswordResetToken.collection.indexes();
    expect(resetIndexes.find((index) => index.key.expiresAt).expireAfterSeconds).to.equal(0);
  });

  it("rejects unauthenticated, forged, expired, and revoked sessions", async () => {
    await request(app).get("/api/auth/me").expect(401);
    await request(app).get("/api/auth/me").set("Cookie", `${config.cookieName}=broken`).expect(401);
    const cookie = await registerAndLogin();
    await models.Session.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    const user = await models.User.findOne().select("+authVersion");
    const expired = issueSession(user, { ...config, sessionTtlSeconds: -1 });
    await request(app).get("/api/auth/me").set("Cookie", `${config.cookieName}=${expired.token}`).expect(401);
  });

  it("rejects sessions for a deleted user or an obsolete auth version", async () => {
    const cookie = await registerAndLogin();
    await models.User.updateOne({}, { $inc: { authVersion: 1 } });
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    const currentCookie = getCookie(await login().expect(200));
    await models.User.deleteMany({});
    await request(app).get("/api/auth/me").set("Cookie", currentCookie).expect(401);
  });

  it("revokes logout cookies against replay and allows repeated logout", async () => {
    const cookie = await registerAndLogin();
    const response = await request(app).post("/api/auth/logout").set("Cookie", cookie).send({}).expect(204);
    expect(response.headers["set-cookie"][0]).to.contain("Expires=Thu, 01 Jan 1970");
    expect(await models.Session.countDocuments()).to.equal(0);
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    await request(app).post("/api/auth/logout").send({}).expect(204);
  });

  it("enforces CORS/origin, JSON parsing, and request size limits", async () => {
    await request(app).post("/api/auth/login").set("Origin", "https://attacker.example").send({ email, password }).expect(403);
    const response = await request(app).get("/api/auth/me").set("Origin", config.frontendOrigin).expect(401);
    expect(response.headers["access-control-allow-origin"]).to.equal(config.frontendOrigin);
    expect(response.headers["access-control-allow-credentials"]).to.equal("true");
    await request(app).options("/api/auth/login").set("Origin", config.frontendOrigin).set("Access-Control-Request-Method", "POST").expect(204);
    await request(app).post("/api/auth/login").type("form").send({ email, password }).expect(415);
    await request(app).post("/api/auth/login").type("json").send("{").expect(400);
    await request(app).post("/api/auth/login").send({ padding: "a".repeat(17000) }).expect(413);
  });

  it("limits repeated authentication attempts", async () => {
    const limitedApp = createApp({ config: { ...config, authRateLimit: 1 }, models, logger });
    await request(limitedApp).post("/api/auth/login").send({}).expect(400);
    await request(limitedApp).post("/api/auth/login").send({}).expect(429);
  });

  it("sets Secure/SameSite=None when configured for HTTPS cross-site hosting", async () => {
    await register().expect(201);
    const secureApp = createApp({ config: { ...config, secureCookies: true, sameSite: "none" }, models, logger });
    const response = await request(secureApp).post("/api/auth/login").send({ email, password }).expect(200);
    expect(response.headers["set-cookie"][0]).to.contain("Secure").and.contain("SameSite=None");
  });

  it("reports recovery unavailable for every account without issuing tokens", async () => {
    const missing = await request(app).post("/api/auth/forgot-password").send({ email }).expect(503);
    await register().expect(201);
    const existing = await request(app).post("/api/auth/forgot-password").send({ email }).expect(503);
    expect(existing.body).to.deep.equal(missing.body);
    expect(existing.body).to.deep.equal({ detail: "Password recovery is currently unavailable." });
    expect(await models.PasswordResetToken.countDocuments()).to.equal(0);
  });

  it("stores only hashes for pre-existing reset tokens", async () => {
    await register().expect(201);
    const token = await seedResetToken();
    const record = await models.PasswordResetToken.findOne();
    expect(record.tokenHash).to.equal(hashToken(token));
    expect(record.toObject()).not.to.have.any.keys("token");
  });

  it("atomically consumes reset links and invalidates every existing login", async () => {
    const firstCookie = await registerAndLogin();
    const secondCookie = getCookie(await login().expect(200));
    const token = await seedResetToken();
    const resets = await Promise.all([
      request(app).post("/api/auth/reset-password").send({ token, password: newPassword }),
      request(app).post("/api/auth/reset-password").send({ token, password: newPassword }),
    ]);
    expect(resets.map((response) => response.status).sort()).to.deep.equal([200, 400]);
    expect(await models.Session.countDocuments()).to.equal(0);
    expect(await models.PasswordResetToken.countDocuments()).to.equal(0);
    for (const cookie of [firstCookie, secondCookie]) {
      await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    }
    await login().expect(401);
    await login({ email, password: newPassword }).expect(200);
  });

  it("rejects invalid/expired reset links without changing the password", async () => {
    await register().expect(201);
    await request(app).post("/api/auth/reset-password").send({ token: "bad", password: newPassword }).expect(400);
    await request(app).post("/api/auth/reset-password").send({ token: "a".repeat(64), password: newPassword }).expect(400);
    const token = await seedResetToken();
    await models.PasswordResetToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).post("/api/auth/reset-password").send({ token, password: newPassword }).expect(400);
    await login().expect(200);
  });

  it("requires proof of account ownership before changing a password", async () => {
    await register().expect(201);
    await request(app).post("/api/auth/reset-password").send({ email, password: newPassword }).expect(400);
    await login().expect(200);
  });

  it("returns a generic response for internal database failures", async () => {
    const brokenApp = createApp({ config, models: { ...models, User: { findOne() { throw new Error("private database details"); } } }, logger });
    const response = await request(brokenApp).post("/api/auth/login").send({ email, password }).expect(500);
    expect(response.body.detail).not.to.contain("private");
    expect(JSON.stringify(logs)).not.to.contain("private");
  });
});
