import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { dummyPasswordHash, hashPassword, verifyPassword, hashToken, issueSession, readSession } from "./security.js";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const publicUser = (user) => ({ id: user.id, email: user.email });
const emailField = () => body("email").isString().withMessage("Enter a valid email address.").bail()
  .trim().isLength({ max: 254 }).isEmail().withMessage("Enter a valid email address.").bail()
  .customSanitizer((email) => email.toLowerCase());
const passwordField = (min = 8) => body("password").isString().withMessage("Enter a valid password.").bail()
  .custom((password) => password.length >= min && password.length <= 128)
  .withMessage(min === 8 ? "Password must be 8–128 characters." : "Enter a password of at most 128 characters.");

function validate(req, _res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) return next(new HttpError(400, result.array()[0].msg));
  next();
}

export function createApp({ config, models, logger = console }) {
  const { User, Session, PasswordResetToken } = models;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigin, credentials: true, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Accept"] }));
  app.use("/api/auth", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use("/api/auth", (req, _res, next) => {
    if (req.get("origin") && req.get("origin") !== config.frontendOrigin) {
      return next(new HttpError(403, "This request origin is not allowed."));
    }
    if (req.method === "POST" && !req.is("application/json")) {
      return next(new HttpError(415, "Send requests as application/json."));
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());

  const cookieOptions = { httpOnly: true, secure: config.secureCookies, sameSite: config.sameSite, path: "/" };
  const clearCookie = (res) => res.clearCookie(config.cookieName, cookieOptions);
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: config.authRateLimit,
    standardHeaders: "draft-8", legacyHeaders: false,
    message: { detail: "Too many authentication attempts. Please try again later." },
  });

  app.get("/api/health", (_req, res) => {
    const ready = User.db.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable" });
  });

  app.post("/api/auth/register", limiter, emailField(), passwordField(), validate, async (req, res) => {
    const passwordHash = await hashPassword(req.body.password);
    try { await User.create({ email: req.body.email, passwordHash }); }
    catch (error) {
      if (error.code === 11000) throw new HttpError(409, "An account with this email already exists.");
      throw error;
    }
    res.status(201).json({ message: "Your account is ready. Log in to continue." });
  });

  app.post("/api/auth/login", limiter, emailField(), passwordField(1), validate, async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select("+passwordHash +authVersion");
    const matches = await verifyPassword(req.body.password, user?.passwordHash || dummyPasswordHash);
    if (!user || !matches) throw new HttpError(401, "Email or password is incorrect.");
    const session = issueSession(user, config);
    await Session.create({ userId: user._id, tokenHash: session.tokenHash, expiresAt: session.expiresAt });
    res.cookie(config.cookieName, session.token, { ...cookieOptions, maxAge: config.sessionTtlSeconds * 1000 });
    res.json({ user: publicUser(user) });
  });

  app.get("/api/auth/me", async (req, res) => {
    const claims = readSession(req.cookies[config.cookieName], config);
    if (!claims) { clearCookie(res); throw new HttpError(401, "Please log in to continue."); }
    const session = await Session.findOne({
      userId: claims.sub, tokenHash: hashToken(claims.jti), expiresAt: { $gt: new Date() },
    });
    const user = session && await User.findById(claims.sub).select("+authVersion");
    if (!user || user.authVersion !== claims.v) {
      clearCookie(res); throw new HttpError(401, "Please log in to continue.");
    }
    res.json({ user: publicUser(user) });
  });

  app.post("/api/auth/logout", async (req, res) => {
    const claims = readSession(req.cookies[config.cookieName], config);
    if (claims) await Session.deleteOne({ userId: claims.sub, tokenHash: hashToken(claims.jti) });
    clearCookie(res);
    res.status(204).end();
  });

  app.post("/api/auth/forgot-password", limiter, emailField(), validate, (_req, _res) => {
    throw new HttpError(503, "Password recovery is currently unavailable.");
  });

  app.post("/api/auth/reset-password", limiter,
    body("token").isString().bail().matches(/^[a-f0-9]{64}$/).withMessage("This reset link is invalid or expired."),
    passwordField(), validate, async (req, res) => {
      const passwordHash = await hashPassword(req.body.password);
      await User.db.transaction(async (session) => {
        const reset = await PasswordResetToken.findOneAndDelete({
          tokenHash: hashToken(req.body.token), expiresAt: { $gt: new Date() },
        }).session(session);
        if (!reset) throw new HttpError(400, "This reset link is invalid or expired.");
        const user = await User.findByIdAndUpdate(reset.userId, {
          $set: { passwordHash }, $inc: { authVersion: 1 },
        }, { session });
        if (!user) throw new HttpError(400, "This reset link is invalid or expired.");
        await Session.deleteMany({ userId: reset.userId }).session(session);
      });
      clearCookie(res);
      res.json({ message: "Your password has been reset. Log in with your new password." });
    });

  app.use((_req, _res, next) => next(new HttpError(404, "API endpoint not found.")));
  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ detail: error.message });
    if (error.type === "entity.parse.failed") return res.status(400).json({ detail: "Send a valid JSON object." });
    if (error.type === "entity.too.large") return res.status(413).json({ detail: "The request is too large." });
    logger.error("Authentication request failed.", { name: error.name });
    res.status(500).json({ detail: "The server could not complete your request. Please try again." });
  });
  return app;
}
