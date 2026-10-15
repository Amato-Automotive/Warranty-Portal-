import { createContext, useContext, useState, useEffect } from "react";
import api from "@/lib/api";
import { setNativeToken } from "@/lib/nativeSession";

export type UserRole = "customer" | "vendor" | "admin";

export type ModulePermissions = Record<string, { read: boolean; write: boolean }>;

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phoneNumber: string;
  isValidated?: boolean;
  isActive?: boolean;
  // Admin-only RBAC fields
  isSuperAdmin?: boolean;
  permissions?: ModulePermissions;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  register: (data: RegisterData) => Promise<{ userId: string; requiresOTP: boolean; message: string }>;
  verifyOTP: (userId: string, otp: string) => Promise<{ user?: User }>;
  login: (identifier: string, role: UserRole) => Promise<{ userId: string; requiresOTP: boolean; message: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  // RBAC helpers
  hasPermission: (module: string, action: 'read' | 'write') => boolean;
}

interface RegisterData {
  name: string;
  email: string;
  phoneNumber: string;
  role: UserRole;
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as any).message === "string") {
    return (error as any).message;
  }
  return fallback;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const response = await api.get("/auth/me");
      setUser(response.data.user);
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const register = async (data: RegisterData): Promise<{ userId: string; requiresOTP: boolean; message: string }> => {
    const response = await api.post("/auth/register", data);
    if (!response.data.success) {
      throw new Error(getErrorMessage(response.data.error, "Registration failed"));
    }
    return {
      userId: response.data.userId,
      requiresOTP: response.data.requiresOTP,
      message: response.data.message
    };
  };

  const verifyOTP = async (userId: string, otp: string): Promise<{ user?: User }> => {
    const response = await api.post("/auth/verify-otp", { userId, otp });
    if (!response.data.success) {
      throw new Error(getErrorMessage(response.data.error, "OTP verification failed"));
    }

    // Only the native app is sent a token; on the web this is a no-op.
    if (response.data.token) await setNativeToken(response.data.token);

    if (response.data.user) {
      setUser(response.data.user);
    }

    return {
      user: response.data.user
    };
  };

  const login = async (identifier: string, role: UserRole): Promise<{ userId: string; requiresOTP: boolean; message: string }> => {
    const response = await api.post("/auth/login", { identifier, role });
    if (!response.data.success) {
      throw new Error(getErrorMessage(response.data.error, "Login failed"));
    }
    return {
      userId: response.data.userId,
      requiresOTP: response.data.requiresOTP,
      message: response.data.message
    };
  };

  const logout = async (): Promise<void> => {
    try {
      await api.post("/auth/logout");
    } catch (error) {
      console.error("Logout error:", error);
    }
    await setNativeToken(null);
    setUser(null);
  };

  /**
   * hasPermission — checks if the current admin user has the given action on a module.
   * Super admins always return true. Non-admin users return false.
   */
  const hasPermission = (module: string, action: 'read' | 'write'): boolean => {
    if (!user || user.role !== 'admin') return false;
    if (user.isSuperAdmin) return true;
    const perm = user.permissions?.[module];
    return perm?.[action] === true;
  };

  return (
    <AuthContext.Provider value={{ user, loading, register, verifyOTP, login, logout, refreshUser: fetchCurrentUser, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
