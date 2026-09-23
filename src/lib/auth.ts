import type { NextAuthOptions, Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getServerSession } from 'next-auth';
import { compare } from 'bcryptjs';
import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });
        if (!user) return null;
        const valid = await compare(credentials.password, user.passwordHash);
        if (!valid) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          locale: user.locale,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        token.locale = (user as { locale?: string }).locale ?? 'ar';
      } else if (trigger === 'update' && token.id) {
        // Role can change when an admin approves a vendor/DOP application.
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, locale: true },
        });
        if (fresh) {
          token.role = fresh.role;
          token.locale = fresh.locale;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.locale = (token.locale as string) ?? 'ar';
      }
      return session;
    },
  },
};

export function auth() {
  return getServerSession(authOptions);
}

export type AppSession = Session & {
  user: { id: string; role: Role; email: string; name: string; locale: string };
};

/** Server-side guard: redirects to login (or the user's own home) on mismatch. */
export async function requireUser(locale = 'ar') {
  const session = (await auth()) as AppSession | null;
  if (!session?.user) redirect(`/${locale}/login`);
  return session;
}

export async function requireRole(role: Role | Role[], locale = 'ar') {
  const session = await requireUser(locale);
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(session.user.role)) redirect(`/${locale}${homeForRole(session.user.role)}`);
  return session;
}

export function homeForRole(role: Role) {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'VENDOR':
      return '/vendor';
    case 'DOP':
      return '/dop';
    default:
      return '/producer';
  }
}
