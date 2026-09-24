import type { ReactNode } from 'react';
import { MessageScope } from '@/i18n/message-scope';

export default function DopLayout({ children }: { children: ReactNode }) {
  return <MessageScope scope="dop">{children}</MessageScope>;
}
