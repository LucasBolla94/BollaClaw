'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api';

export type NavPage = 'dashboard' | 'conversations' | 'logs' | 'soul' | 'memory' | 'settings';

interface NavItem {
  id: NavPage;
  label: string;
  icon: React.ReactNode;
  section: string;
}

const navItems: NavItem[] = [
  {
    id: 'dashboard', label: 'Dashboard', section: 'Principal',
    icon: <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  },
  {
    id: 'conversations', label: 'Conversas', section: 'Principal',
    icon: <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>,
  },
  {
    id: 'logs', label: 'Logs', section: 'Principal',
    icon: <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
  },
  {
    id: 'soul', label: 'Soul', section: 'Agente',
    icon: <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>,
  },
  {
    id: 'memory', label: 'Memória', section: 'Agente',
    icon: <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>,
  },
  {
    id: 'settings', label: 'Configurações', section: 'Sistema',
    icon: <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" /></svg>,
  },
];

interface Props {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  onLogout: () => void;
}

export function Sidebar({ activePage, onNavigate, onLogout }: Props) {
  const [online, setOnline] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const checkHealth = useCallback(async () => {
    try {
      await apiClient.health();
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // Group by section
  const sections = navItems.reduce<Record<string, NavItem[]>>((acc, item) => {
    if (!acc[item.section]) acc[item.section] = [];
    acc[item.section].push(item);
    return acc;
  }, {});

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-60'} flex-shrink-0 bg-surface-1 border-r border-white/[0.06] flex flex-col transition-all duration-200`}>
      {/* Brand */}
      <div className="p-4 border-b border-white/[0.06] flex items-center gap-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 hover:scale-105 transition-transform"
        >
          BC
        </button>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-white truncate">BollaClaw</h1>
            <span className="text-[10px] text-slate-600 font-mono">v0.1.0</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-4">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section}>
            {!collapsed && (
              <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600">
                {section}
              </div>
            )}
            <div className="space-y-0.5">
              {items.map((item) => {
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-brand-500/10 text-brand-400 shadow-sm shadow-brand-500/5'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
                    } ${collapsed ? 'justify-center px-0' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className={isActive ? 'text-brand-400' : 'text-slate-500'}>{item.icon}</span>
                    {!collapsed && <span>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/[0.06] space-y-2">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2 px-1'}`}>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${online ? 'bg-emerald-400 animate-pulse-slow' : 'bg-red-400'}`} />
          {!collapsed && (
            <span className="text-[11px] text-slate-600">{online ? 'Online' : 'Offline'}</span>
          )}
        </div>
        <button
          onClick={onLogout}
          className={`w-full py-1.5 text-[11px] rounded-md border border-white/[0.06] text-slate-600 hover:text-red-400 hover:border-red-400/30 hover:bg-red-400/5 transition-all ${collapsed ? 'px-1' : ''}`}
        >
          {collapsed ? (
            <svg className="w-3.5 h-3.5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          ) : 'Sair'}
        </button>
      </div>
    </aside>
  );
}
