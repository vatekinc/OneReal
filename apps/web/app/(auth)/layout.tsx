import Image from 'next/image';
import { AuthBrandPanel } from '@/components/auth/brand-panel';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <AuthBrandPanel />
      {/* Mobile brand header */}
      <div className="flex items-center gap-3 bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 md:hidden">
        <Image src="/logo.png" alt="OneReal" width={32} height={32} />
        <div>
          <span className="text-base font-bold text-white">OneReal</span>
          <p className="text-xs text-slate-400">Real Estate &amp; Property Management</p>
        </div>
      </div>
      {/* Form panel */}
      <div className="flex flex-col justify-center bg-white px-8 py-12 md:px-16 lg:px-24">
        <div className="mx-auto w-full max-w-[400px]">
          {children}
        </div>
      </div>
    </div>
  );
}
