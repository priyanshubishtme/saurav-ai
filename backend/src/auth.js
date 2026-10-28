import bcrypt from "bcryptjs";
import MongoStore from "connect-mongo";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import { z } from "zod";
import { getDatabaseStatus } from "./database.js";
import { User } from "./models.js";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must not exceed 72 UTF-8 bytes."),
  confirmPassword: z.string().min(1),
}).strict().refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
}).strict();

export class AuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    username: user.username,
  };
}

function configuredFrontendOrigin() {
  return process.env.FRONTEND_ORIGIN ?? (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:5173");
}

function allowedFrontendOrigins() {
  const configured = configuredFrontendOrigin();
  if (process.env.NODE_ENV === "production") return new Set(configured ? [configured] : []);
  return new Set([configured, "http://localhost:5173", "http://127.0.0.1:5173"]);
}

function validProductionOrigin() {
  const origin = configuredFrontendOrigin();
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function createAuth({ userModel = User, databaseStatus = getDatabaseStatus } = {}) {
  const ready = () => databaseStatus().connected
    && Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32)
    && (process.env.NODE_ENV !== "production" || validProductionOrigin());
  let configuredSessionMiddleware;
  let sessionStore;
  const sessionMiddleware = () => (request, response, next) => {
    if (!ready()) return next();
    configuredSessionMiddleware ??= session({
      name: "accessz.sid",
      secret: process.env.SESSION_SECRET,
      store: sessionStore = MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: "sessions",
        ttl: 60 * 60 * 24 * 7,
        autoRemove: "native",
      }),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        maxAge: 1000 * 60 * 60 * 24 * 7,
        path: "/",
      },
    });
    return configuredSessionMiddleware(request, response, (error) => {
      if (error) {
        console.error("Session storage failed:", { requestId: request.requestId, name: error.name, code: error.code });
        return response.status(503).json({
          error: {
            code: "SESSION_STORAGE_UNAVAILABLE",
            message: "Secure session storage is temporarily unavailable.",
            requestId: request.requestId,
          },
        });
      }
      return next();
    });
  };

  function unavailable(response, requestId) {
    const database = databaseStatus();
    const message = database.status === "not_configured"
      ? "Authentication is unavailable because MONGODB_URI is not configured."
      : database.status !== "connected"
        ? "Authentication is unavailable because the database is not connected."
        : !(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32)
          ? "Authentication is unavailable because SESSION_SECRET must be at least 32 characters."
          : "Authentication is unavailable because FRONTEND_ORIGIN must be a valid HTTPS origin in production.";
    return response.status(503).json({
      error: { code: "AUTH_NOT_CONFIGURED", message, requestId },
    });
  }

  function requireReady(request, response, next) {
    if (!ready()) return unavailable(response, request.requestId);
    return next();
  }

  function requireOrigin(request, response, next) {
    const origin = request.get("Origin");
    if (!origin || !allowedFrontendOrigins().has(origin)) {
      return response.status(403).json({
        error: { code: "ORIGIN_NOT_ALLOWED", message: "This request origin is not allowed.", requestId: request.requestId },
      });
    }
    return next();
  }

  function requireUser(request, response, next) {
    if (!request.session?.userId) {
      return response.status(401).json({
        error: { code: "AUTH_REQUIRED", message: "Sign in to access this resource.", requestId: request.requestId },
      });
    }
    request.user = { id: request.session.userId };
    return next();
  }

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(request, response) {
      return response.status(429).json({
        error: {
          code: "LOGIN_RATE_LIMITED",
          message: "Too many sign-in attempts. Try again later.",
          requestId: request.requestId,
        },
      });
    },
  });

  async function register(request, response) {
    const requestId = request.requestId;
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Review the account details and try again.", requestId, details: parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })) },
      });
    }
    const values = parsed.data;
    const email = values.email.toLowerCase();
    const username = values.username.toLowerCase();
    try {
      const passwordHash = await bcrypt.hash(values.password, 12);
      const user = await userModel.create({ name: values.name, email, username, passwordHash });
      request.session.regenerate((error) => {
        if (error) return response.status(500).json({ error: { code: "SESSION_FAILED", message: "Could not create a secure session.", requestId } });
        request.session.userId = user._id.toString();
        request.session.save((saveError) => {
          if (saveError) return response.status(500).json({ error: { code: "SESSION_FAILED", message: "Could not create a secure session.", requestId } });
          return response.status(201).json({ requestId, user: publicUser(user) });
        });
      });
    } catch (error) {
      if (error?.code === 11000) {
        const duplicate = Object.keys(error.keyPattern ?? {})[0];
        const message = duplicate === "username"
          ? "That username is already in use."
          : "An account with that email address already exists.";
        return response.status(409).json({ error: { code: "ACCOUNT_EXISTS", message, requestId } });
      }
      console.error("Account registration failed:", { requestId, name: error?.name, code: error?.code });
      return response.status(500).json({ error: { code: "REGISTRATION_FAILED", message: "Could not create the account. Try again later.", requestId } });
    }
  }

  async function login(request, response) {
    const requestId = request.requestId;
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter your email or username and password.", requestId } });
    }
    try {
      const identifier = parsed.data.identifier.toLowerCase();
      const user = await userModel.findOne({
        $or: [{ email: identifier }, { username: identifier }],
      }).select("+passwordHash");
      const valid = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
      if (!valid) {
        return response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email/username or password is incorrect.", requestId } });
      }
      request.session.regenerate((error) => {
        if (error) return response.status(500).json({ error: { code: "SESSION_FAILED", message: "Could not create a secure session.", requestId } });
        request.session.userId = user._id.toString();
        request.session.save((saveError) => {
          if (saveError) return response.status(500).json({ error: { code: "SESSION_FAILED", message: "Could not create a secure session.", requestId } });
          return response.json({ requestId, user: publicUser(user) });
        });
      });
    } catch (error) {
      console.error("Account sign-in failed:", { requestId, name: error?.name, code: error?.code });
      return response.status(503).json({ error: { code: "AUTH_UNAVAILABLE", message: "Sign-in is temporarily unavailable.", requestId } });
    }
  }

  function logout(request, response) {
    const requestId = request.requestId;
    request.session.destroy((error) => {
      if (error) return response.status(500).json({ error: { code: "LOGOUT_FAILED", message: "Could not end the session. Try again.", requestId } });
      response.clearCookie("accessz.sid", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        path: "/",
      });
      return response.json({ requestId, status: "logged_out" });
    });
  }

  async function me(request, response) {
    try {
      const user = await userModel.findById(request.session.userId);
      if (!user) {
        request.session.destroy(() => {});
        return response.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in to access this resource.", requestId: request.requestId } });
      }
      return response.json({ requestId: request.requestId, user: publicUser(user) });
    } catch (error) {
      console.error("Session user lookup failed:", { requestId: request.requestId, name: error?.name, code: error?.code });
      return response.status(503).json({ error: { code: "AUTH_UNAVAILABLE", message: "Session validation is temporarily unavailable.", requestId: request.requestId } });
    }
  }

  return {
    ready,
    sessionMiddleware,
    requireReady,
    requireOrigin,
    requireUser,
    loginLimiter,
    register,
    login,
    logout,
    me,
    async close() {
      if (sessionStore) await sessionStore.close();
    },
  };
}

export const authService = createAuth();
