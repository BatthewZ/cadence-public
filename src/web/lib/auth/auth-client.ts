import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient({
  baseURL: window.location.origin,
});

export const {
  useSession,
  signIn,
  signUp,
  signOut,
  updateUser,
  changePassword,
  deleteUser,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  requestPasswordReset,
  resetPassword,
} = authClient;
