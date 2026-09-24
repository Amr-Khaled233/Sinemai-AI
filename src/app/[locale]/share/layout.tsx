import type { ReactNode } from 'react';
import { MessageScope } from '@/i18n/message-scope';

export default function ShareLayout({ children }: { children: ReactNode }) {
  return <MessageScope scope="share">{children}</MessageScope>;
}
