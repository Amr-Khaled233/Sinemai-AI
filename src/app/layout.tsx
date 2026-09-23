import type { ReactNode } from 'react';

// The real <html> shell lives in app/[locale]/layout.tsx, which knows the
// language and text direction.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
