'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import { MENU_ITEMS, MenuItem, PermissionsMap, getPermissions, savePermissions } from '@/lib/permissions';
import { getRoleLabel, UserRole } from '@/lib/users';

const EDITABLE_ROLES: UserRole[] = ['sales_director', 'coo', 'sales', 'marketing'];

export default function PermissionsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canEdit = role === 'administrative_manager' || role === 'admin';

  const [perms, setPerms] = useState<PermissionsMap>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setPerms(getPermissions());
  }, []);

  function toggle(r: string, menu: MenuItem) {
    setPerms((prev) => ({
      ...prev,
      [r]: { ...prev[r], [menu]: !prev[r]?.[menu] },
    }));
  }

  function handleSave() {
    savePermissions(perms);
    setToast('Permissions updated');
  }

  if (!canEdit) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Access denied. Admin or Admin Manager role required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-5xl mx-auto">
          <div className="mt-6 mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Menu Access Permissions</h1>
            <p className="text-sm text-gray-500 mt-0.5">Control which menu items each role can access</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 font-medium text-gray-500 text-xs uppercase sticky left-0 bg-gray-50">Role</th>
                  {MENU_ITEMS.map((menu) => (
                    <th key={menu} className="text-center px-3 py-3 font-medium text-gray-500 text-xs uppercase whitespace-nowrap">{menu}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EDITABLE_ROLES.map((r) => (
                  <tr key={r} className="border-b border-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900 sticky left-0 bg-white">{getRoleLabel(r)}</td>
                    {MENU_ITEMS.map((menu) => (
                      <td key={menu} className="text-center px-3 py-3">
                        <input
                          type="checkbox"
                          checked={perms[r]?.[menu] ?? false}
                          onChange={() => toggle(r, menu)}
                          className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSave}
              className="px-5 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90"
              style={{ backgroundColor: '#1a4731' }}
            >
              Save Permissions
            </button>
          </div>

          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">
              <strong>Note:</strong> Admin Manager, Admin, and CEO roles always have full access to all menus (not editable).
            </p>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
