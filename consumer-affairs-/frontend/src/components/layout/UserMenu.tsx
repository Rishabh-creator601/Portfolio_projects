'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Settings, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/constants';

/**
 * The account menu behind the header avatar: Profile, Settings, Sign out.
 *
 * Sign out lives here as well as in the sidebar so it is reachable from the
 * place people look for it first - their own avatar.
 */
export function UserMenu() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const initials = (user?.displayName || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  // Close on outside click and on Escape, returning focus to the trigger.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const go = (href: string) => {
    setIsOpen(false);
    router.push(href);
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await logout();
    } finally {
      setIsSigningOut(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Account menu"
        className="focus-ring flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-cyan-50"
      >
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight text-cyan-950">
            {user?.displayName || user?.email}
          </p>
          <p className="text-xs leading-tight text-slate-500">
            {user ? ROLE_LABELS[user.role] || user.role : ''}
          </p>
        </div>
        <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-cyan-50 text-sm font-semibold text-cyan-800 ring-1 ring-cyan-200">
          {initials}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Account"
          className="animate-fade-in absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-cyan-200 bg-white shadow-card-hover"
        >
          <div className="flex items-center gap-3 border-b border-cyan-100 bg-surface-muted px-4 py-3">
            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-cyan-gradient text-sm font-semibold text-white">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-cyan-950">
                {user?.displayName || '—'}
              </p>
              <p className="truncate text-xs text-slate-500">
                {user ? ROLE_LABELS[user.role] || user.role : ''}
              </p>
            </div>
          </div>

          <button
            role="menuitem"
            type="button"
            onClick={() => go('/settings#account')}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-cyan-50 hover:text-cyan-900"
          >
            <UserRound className="h-4 w-4 text-cyan-600" aria-hidden="true" />
            Profile
          </button>

          <button
            role="menuitem"
            type="button"
            onClick={() => go('/settings')}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-cyan-50 hover:text-cyan-900"
          >
            <Settings className="h-4 w-4 text-cyan-600" aria-hidden="true" />
            Settings
          </button>

          <div className="border-t border-cyan-100">
            <button
              role="menuitem"
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-verdict-fail transition-colors hover:bg-verdict-fail/5 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
