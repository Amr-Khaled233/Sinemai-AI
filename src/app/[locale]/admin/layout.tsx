import type { ReactNode } from 'react';
import { MessageScope } from '@/i18n/message-scope';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <MessageScope scope="admin">{children}</MessageScope>;
}
