'use client';

import { Menu, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import UserMenu from './UserMenu';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-cyan-100 bg-white/85 px-4 backdrop-blur-md lg:h-16 lg:px-8">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-2 text-cyan-800 transition-colors hover:bg-cyan-50 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 lg:hidden">
          <ShieldCheck className="h-5 w-5 text-cyan-brand" aria-hidden="true" />
          <span className="text-base font-bold tracking-tight text-cyan-950">LM-Verify</span>
        </div>
        <p className="hidden text-sm text-slate-500 lg:block">
          Legal Metrology (Packaged Commodities) Rules, 2011
        </p>
      </div>

      <div className="flex items-center gap-3">
        {user?.jurisdiction && (
          <span className="chip hidden border-cyan-200 bg-cyan-50 text-cyan-800 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-bright" aria-hidden="true" />
            {user.jurisdiction}
          </span>
        )}
        <UserMenu />
      </div>
    </header>
  );
}

export default Header;
