'use client';

export default function LoadingSpinner({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block w-8 h-8 border-3 border-gray-200 border-t-[#1a4731] rounded-full animate-spin mb-3" />
        <p className="text-sm text-gray-500">{message}</p>
      </div>
    </div>
  );
}
