'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { AppUser, UserRole, UserStatus } from './users';
import { dbGetUsers, dbUpdateUser, dbCreateUser } from './db';

interface UserContextType {
  users: AppUser[];
  currentUser: AppUser | null;
  updateCurrentUser: (updates: Partial<Pick<AppUser, 'name' | 'phone' | 'profilePhoto' | 'password'>>) => void;
  updateUserById: (id: string, updates: Partial<Pick<AppUser, 'role' | 'status' | 'name' | 'phone' | 'profilePhoto'>>) => void;
  addUser: (user: AppUser) => void;
}

const UserContext = createContext<UserContextType | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [users, setUsers] = useState<AppUser[]>([]);

  const syncUsers = useCallback(async () => {
    try {
      const dbUsers = await dbGetUsers();
      if (dbUsers.length > 0) setUsers(dbUsers);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }, []);

  useEffect(() => { syncUsers(); }, [syncUsers]);

  const currentUser = users.find((u) => u.id === (session?.user?.id ?? '')) ?? null;

  function updateCurrentUser(updates: Partial<Pick<AppUser, 'name' | 'phone' | 'profilePhoto' | 'password'>>) {
    const currentId = session?.user?.id;
    if (!currentId) return;
    setUsers((prev) => prev.map((u) => (u.id === currentId ? { ...u, ...updates } : u)));
    dbUpdateUser(currentId, updates).catch(console.error);
  }

  function updateUserById(id: string, updates: Partial<Pick<AppUser, 'role' | 'status' | 'name' | 'phone' | 'profilePhoto'>>) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...updates } : u)));
    dbUpdateUser(id, updates).catch(console.error);
  }

  function addUser(user: AppUser) {
    setUsers((prev) => [...prev, user]);
    dbCreateUser(user).catch(console.error);
  }

  return (
    <UserContext.Provider value={{ users, currentUser, updateCurrentUser, updateUserById, addUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUsers(): UserContextType {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUsers must be used within UserProvider');
  return ctx;
}

export type { UserRole, UserStatus };
