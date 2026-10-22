export type UserRole = 'field_inspector' | 'senior_inspector' | 'controller' | 'legal_officer' | 'auditor';

/** How the account authenticates. Google accounts may have no password at all. */
export type AuthProvider = 'local' | 'google';

export interface User {
  _id: string;
  email: string;
  displayName: string;
  role: UserRole;
  jurisdiction: string;
  isActive: boolean;
  lastLogin: string;
  authProvider?: AuthProvider;
  emailVerified?: boolean;
  avatarUrl?: string;
  /** False for a Google account that has never set a local password. */
  hasPassword?: boolean;
  mfaEnabled?: boolean;
  createdAt?: string;
}
