'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton({ label, locale }: { label: string; locale: string }) {
  return (
    <button type="button" className="btn-secondary text-xs" onClick={() => signOut({ callbackUrl: `/${locale}` })}>
      {label}
    </button>
  );
}
