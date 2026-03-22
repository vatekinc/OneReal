import { AuthBrandPanel } from '@/components/auth/brand-panel';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="grid w-full max-w-[960px] overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] md:min-h-[580px] md:grid-cols-2">
        <AuthBrandPanel />
        {/* Mobile brand header */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 md:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-slate-900">
            O
          </div>
          <div>
            <span className="text-base font-bold text-white">OneReal</span>
            <p className="text-xs text-slate-400">Property management, simplified.</p>
          </div>
        </div>
        {/* Form panel */}
        <div className="flex flex-col justify-center p-8 md:p-12">
          {children}
        </div>
      </div>
    </div>
  );
}
