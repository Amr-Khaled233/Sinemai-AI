import type { ReactNode } from 'react';
import { MessageScope } from '@/i18n/message-scope';

export default function ProducerLayout({ children }: { children: ReactNode }) {
  return <MessageScope scope="producer">{children}</MessageScope>;
}
