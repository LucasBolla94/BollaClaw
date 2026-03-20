'use client';

import { useState, useCallback } from 'react';
import { Sidebar, type NavPage } from './Sidebar';
import { Dashboard } from './pages/Dashboard';
import { ConversationsPage } from './pages/Conversations';
import { LogsPage } from './pages/Logs';
import { SoulPage } from './pages/Soul';
import { MemoryPage } from './pages/Memory';
import { SettingsPage } from './pages/Settings';
import { ChangePasswordModal } from './ChangePasswordModal';
import { apiClient } from '@/lib/api';

interface Props {
  mustChangePassword: boolean;
  onPasswordChanged: () => void;
  onLogout: () => void;
}

export function AppShell({ mustChangePassword, onPasswordChanged, onLogout }: Props) {
  const [page, setPage] = useState<NavPage>('dashboard');
  const [showPwdModal, setShowPwdModal] = useState(mustChangePassword);

  const handleLogout = useCallback(async () => {
    try {
      await apiClient.logout();
    } catch { /* ignore */ }
    onLogout();
  }, [onLogout]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard />;
      case 'conversations': return <ConversationsPage />;
      case 'logs': return <LogsPage />;
      case 'soul': return <SoulPage />;
      case 'memory': return <MemoryPage />;
      case 'settings': return <SettingsPage onChangePassword={() => setShowPwdModal(true)} />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-surface-0">
      <Sidebar activePage={page} onNavigate={setPage} onLogout={handleLogout} />

      <main className="flex-1 overflow-y-auto">
        <div className="p-6 lg:p-8 max-w-[1440px] mx-auto animate-fade-in">
          {renderPage()}
        </div>
      </main>

      {showPwdModal && (
        <ChangePasswordModal
          forced={mustChangePassword}
          onClose={() => {
            setShowPwdModal(false);
            if (mustChangePassword) onPasswordChanged();
          }}
        />
      )}
    </div>
  );
}
