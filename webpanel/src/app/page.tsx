'use client';

import { useState, useEffect } from 'react';
import { LoginScreen } from '@/components/LoginScreen';
import { AppShell } from '@/components/AppShell';
import { apiClient } from '@/lib/api';

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    // Check if already authenticated
    apiClient.session()
      .then((s) => {
        setAuthenticated(true);
        setMustChangePassword(s.mustChangePassword);
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setChecking(false));

    // Listen for auth:logout events
    const handleLogout = () => {
      setAuthenticated(false);
      setChecking(false);
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  if (checking) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-0">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center text-white font-bold text-lg animate-pulse">
            BC
          </div>
          <div className="text-slate-500 text-sm">Carregando...</div>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <LoginScreen
        onLogin={(mustChange) => {
          setAuthenticated(true);
          setMustChangePassword(mustChange);
        }}
      />
    );
  }

  return (
    <AppShell
      mustChangePassword={mustChangePassword}
      onPasswordChanged={() => setMustChangePassword(false)}
      onLogout={() => setAuthenticated(false)}
    />
  );
}
