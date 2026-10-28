import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCurrentUser,
  loginAccount,
  logoutAccount,
  registerAccount,
} from "../api/client.js";
import { clearLocalAuditHistory } from "../utils/auditHistory.js";
import { AuthContext } from "./authContext.js";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getCurrentUser({ signal: controller.signal })
      .then(({ user: currentUser }) => {
        clearLocalAuditHistory();
        setUser(currentUser);
        setStatus("authenticated");
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        if (error.status === 401) {
          setStatus("unauthenticated");
          return;
        }
        setAuthError(error.message);
        setStatus("unavailable");
      });
    return () => controller.abort();
  }, []);

  const signIn = useCallback(async (credentials) => {
    setAuthError("");
    const result = await loginAccount(credentials);
    clearLocalAuditHistory();
    setUser(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  const signUp = useCallback(async (account) => {
    setAuthError("");
    const result = await registerAccount(account);
    clearLocalAuditHistory();
    setUser(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  const signOut = useCallback(async () => {
    await logoutAccount();
    clearLocalAuditHistory();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(() => ({
    user,
    status,
    authError,
    signIn,
    signUp,
    signOut,
  }), [user, status, authError, signIn, signUp, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
