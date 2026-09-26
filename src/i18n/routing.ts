import { createNavigation } from 'next-intl/navigation';
import { routing } from './config';

export { locales, routing, isRtl, dirFor, type AppLocale } from './config';

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
