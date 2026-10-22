'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS, ROUTE_ACCESS } from '@/lib/constants';
import type { UserRole } from '@/types/user';
import { BookOpen, Camera, LayoutDashboard, LogOut, Package, Settings, ShieldCheck, Upload, Users, X } from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Scan Camera', href: '/scan/camera', icon: Camera },
  { name: 'Upload Scan', href: '/scan/upload', icon: Upload },
  { name: 'Repository', href: '/repository', icon: Package },
  { name: 'Rules', href: '/rules', icon: BookOpen },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'Settings', href: '/settings', icon: Settings },
];

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const pathname = usePathname() || '';
  const { user, logout } = useAuth();

  const visible = navigation.filter((item) => {
    const allowed = ROUTE_ACCESS[item.href] as UserRole[] | undefined;
    return !allowed || (user ? allowed.includes(user.role) : false);
  });

  const initials = (user?.displayName || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const content = (
    <div className="flex h-full w-64 flex-col bg-cyan-gradient">
      <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-cyan-400/20 px-4">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 ring-1 ring-cyan-300/30">
            <ShieldCheck className="h-5 w-5 text-cyan-300" aria-hidden="true" />
          </span>
          <span className="text-lg font-bold tracking-tight text-white">LM-Verify</span>
        </Link>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-cyan-100 hover:bg-white/10 lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-cyan-300/70">
          Enforcement
        </p>
        {visible.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(103,232,249,0.25)]'
                  : 'text-cyan-100/80 hover:bg-white/8 hover:text-white'
              }`}
            >
              {isActive && (
                <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-cyan-bright" aria-hidden="true" />
              )}
              <item.icon
                className={`h-5 w-5 flex-shrink-0 ${isActive ? 'text-cyan-300' : 'text-cyan-200/70 group-hover:text-cyan-200'}`}
                aria-hidden="true"
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-cyan-400/20 p-3">
        <div className="flex items-center gap-3 rounded-lg bg-white/5 p-3">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-cyan-bright/20 text-sm font-semibold text-cyan-100 ring-1 ring-cyan-300/40">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user?.displayName || user?.email}</p>
            <p className="truncate text-xs text-cyan-200/80">
              {user ? ROLE_LABELS[user.role] || user.role : ''}
            </p>
          </div>
        </div>
        <button
          onClick={() => logout()}
          className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-cyan-100/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden flex-shrink-0 lg:block">{content}</aside>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-40 lg:hidden ${mobileOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!mobileOpen}
      >
        <div
          className={`absolute inset-0 bg-cyan-950/50 backdrop-blur-sm transition-opacity ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={onClose}
        />
        <div
          className={`absolute inset-y-0 left-0 transition-transform duration-200 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {content}
        </div>
      </div>
    </>
  );
}
