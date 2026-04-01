'use client';

import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';

export default function ProfilePage() {
  const { data: session } = useSession();
  const { currentUser, updateCurrentUser } = useUsers();

  const primaryColor = '#1a4731';

  const [name, setName] = useState(currentUser?.name ?? session?.user?.name ?? '');
  const [phone, setPhone] = useState(currentUser?.phone ?? '');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(currentUser?.profilePhoto ?? null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(currentUser?.profilePhoto ?? null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [infoErrors, setInfoErrors] = useState<Record<string, string>>({});
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials =
    (currentUser?.initials ??
      (name
        .split(' ')
        .filter(Boolean)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2))) || 'U';

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setPhotoPreview(result);
      setProfilePhoto(result);
    };
    reader.readAsDataURL(file);
  }

  function handleRemovePhoto() {
    setPhotoPreview(null);
    setProfilePhoto(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required.';
    setInfoErrors(errs);
    if (Object.keys(errs).length > 0) return;

    updateCurrentUser({
      name: name.trim(),
      phone: phone.trim(),
      profilePhoto: profilePhoto,
    });
    setToast('Profile updated successfully');
  }

  function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!currentPassword) errs.currentPassword = 'Current password is required.';
    else if (currentUser?.password && currentPassword !== currentUser.password) {
      errs.currentPassword = 'Current password is incorrect.';
    }
    if (!newPassword) errs.newPassword = 'New password is required.';
    else if (newPassword.length < 8) errs.newPassword = 'Password must be at least 8 characters.';
    if (!confirmNewPassword) errs.confirmNewPassword = 'Please confirm your new password.';
    else if (newPassword !== confirmNewPassword) errs.confirmNewPassword = 'Passwords do not match.';
    setPwErrors(errs);
    if (Object.keys(errs).length > 0) return;

    updateCurrentUser({ password: newPassword });
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setToast('Password updated successfully');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-2xl mx-auto mt-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Profile</h1>

          {/* Section A: Profile Photo */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Profile Photo</h2>
            <div className="flex items-center gap-5">
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0 overflow-hidden border-2 border-gray-200"
                style={{ backgroundColor: photoPreview ? 'transparent' : primaryColor }}
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="Profile" className="w-24 h-24 object-cover" />
                ) : (
                  initials
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Change Photo
                </button>
                {photoPreview && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="text-sm text-gray-400 hover:text-red-500 transition-colors text-left"
                  >
                    Remove Photo
                  </button>
                )}
                <p className="text-xs text-gray-400">Initials shown if no photo selected</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>
          </div>

          {/* Section B: Personal Information */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Personal Information</h2>
            <form onSubmit={handleSaveInfo} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setInfoErrors((p) => ({ ...p, name: '' })); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                {infoErrors.name && <p className="text-xs text-red-600 mt-1">{infoErrors.name}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={session?.user?.email ?? ''}
                  disabled
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
                />
                <p className="text-xs text-gray-400 mt-1">Contact admin to change email</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {getRoleLabel((session?.user?.role ?? 'sales') as import('@/lib/users').UserRole)}
                  </span>
                  <span className="text-xs text-gray-400">Contact admin to change role</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team</label>
                <div className="flex items-center gap-2">
                  {currentUser?.team ? (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium" style={{
                      backgroundColor: { monogastrics: '#E6F1FB', ruminants: '#E1F5EE', latam: '#FAEEDA', familyb2b: '#EEEDFE', management: '#F1EFE8' }[currentUser.team] || '#F1EFE8',
                      color: { monogastrics: '#185FA5', ruminants: '#0F6E56', latam: '#854F0B', familyb2b: '#534AB7', management: '#5F5E5A' }[currentUser.team] || '#5F5E5A',
                    }}>
                      {{ monogastrics: 'Monogastrics', swine: 'Swine', ruminants: 'Ruminants', latam: 'LATAM', familyb2b: 'Family / B2B', management: 'Management' }[currentUser.team] || currentUser.team}
                    </span>
                  ) : <span className="text-sm text-gray-400">No team assigned</span>}
                  <span className="text-xs text-gray-400">Contact admin to change team</span>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white rounded-lg hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: primaryColor }}
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>

          {/* Section C: Change Password */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Change Password</h2>
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setPwErrors((p) => ({ ...p, currentPassword: '' })); }}
                  placeholder="••••••••"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                {pwErrors.currentPassword && <p className="text-xs text-red-600 mt-1">{pwErrors.currentPassword}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setPwErrors((p) => ({ ...p, newPassword: '' })); }}
                  placeholder="Min. 8 characters"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                {pwErrors.newPassword && <p className="text-xs text-red-600 mt-1">{pwErrors.newPassword}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => { setConfirmNewPassword(e.target.value); setPwErrors((p) => ({ ...p, confirmNewPassword: '' })); }}
                  placeholder="Re-enter new password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                {pwErrors.confirmNewPassword && <p className="text-xs text-red-600 mt-1">{pwErrors.confirmNewPassword}</p>}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white rounded-lg hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: primaryColor }}
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
