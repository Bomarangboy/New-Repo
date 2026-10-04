"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BarChart3, CalendarDays, Home, LifeBuoy, Link2, Menu, MessageCircle, Settings, Users, X, Zap,
  Building2, ScrollText, Activity, Presentation,
} from "lucide-react";
import { Wordmark } from "./brand";

const ICONS = {
  home: Home, users: Users, message: MessageCircle, zap: Zap, calendar: CalendarDays, chart: BarChart3,
  link: Link2, settings: Settings, help: LifeBuoy, building: Building2, log: ScrollText, health: Activity, demo: Presentation,
} as const;
export type IconName = keyof typeof ICONS;

export interface ShellNavItem { href: string; label: string; icon: IconName }

function NavLinks({ items, onNavigate }: { items: ShellNavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-1" aria-label="Main">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const root = item.href === "/app" || item.href === "/admin";
        const active = root ? path === item.href : path === item.href || path.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-[0.95rem] font-medium transition ${
              active ? "bg-brand-500 text-white shadow-lg shadow-brand-500/25" : "text-white/80 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon className="size-5 shrink-0" /> {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Responsive application frame: fixed navy sidebar on desktop, slide-over menu on phones. */
export function AppShell({ nav, sidebarTop, topbar, banner, children }: {
  nav: ShellNavItem[]; sidebarTop?: ReactNode; topbar?: ReactNode; banner?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sidebar = (
    <div className="flex h-full flex-col gap-6 bg-gradient-to-b from-navy-900 to-navy-950 px-4 py-6">
      <div className="px-2"><Wordmark onDark size="md" /></div>
      {sidebarTop}
      <NavLinks items={nav} onNavigate={() => setOpen(false)} />
    </div>
  );
  return (
    <div className="min-h-dvh">
      {banner}
      <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="hidden bg-navy-950 lg:block"><div className="sticky top-0 h-dvh">{sidebar}</div></aside>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button className="absolute inset-0 bg-navy-950/60" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div className="relative h-full w-72 max-w-[85vw]">{sidebar}</div>
          </div>
        )}
        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:px-8">
            <button className="btn-secondary px-2.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
            <div className="lg:hidden"><Wordmark size="sm" /></div>
            <div className="ml-auto flex items-center gap-2">{topbar}</div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
