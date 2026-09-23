import type { Role } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      locale: string;
    } & DefaultSession['user'];
  }

  interface User {
    role: Role;
    locale?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: Role;
    locale?: string;
    /** Unix seconds the session was issued; compared against passwordChangedAt. */
    authAt?: number;
  }
}
