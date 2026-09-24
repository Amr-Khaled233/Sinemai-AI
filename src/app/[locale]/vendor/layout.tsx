import type { ReactNode } from 'react';
import { MessageScope } from '@/i18n/message-scope';

export default function VendorLayout({ children }: { children: ReactNode }) {
  return <MessageScope scope="vendor">{children}</MessageScope>;
}
