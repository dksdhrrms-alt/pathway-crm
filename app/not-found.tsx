'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16 bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-10 text-center">
        {/* Icon */}
        <div
          aria-hidden="true"
          className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5"
          style={{ backgroundColor: '#e8f0ec' }}
        >
          <svg
            className="w-8 h-8"
            style={{ color: '#1a4731' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-1">
          404
        </p>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          Page not found
        </h1>
        <p className="text-sm text-gray-500 mb-8 leading-relaxed">
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
          Check the URL, or head back to your dashboard to continue.
        </p>

        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-center">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Go back
          </button>
          <Link
            href="/dashboard"
            className="px-5 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity inline-flex items-center justify-center"
            style={{ backgroundColor: '#1a4731' }}
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
