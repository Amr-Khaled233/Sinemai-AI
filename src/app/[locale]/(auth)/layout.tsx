import type { ReactNode } from 'react';
import { MessageScope } from '@/i18n/message-scope';

/**
 * A route group, so the four credential screens share one message scope without
 * changing their URLs.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <MessageScope scope="auth">{children}</MessageScope>;
}
