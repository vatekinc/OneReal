'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button, Input, Label, Separator } from '@onereal/ui';
import { toast } from 'sonner';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    // If email confirmation is required, session will be null
    if (!data.session) {
      toast.success('Check your email to confirm your account before signing in.');
      setLoading(false);
      return;
    }

    toast.success('Account created! Redirecting...');
    router.push('/onboarding');
    router.refresh();
  }

  async function handleGoogleSignIn() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    if (data.url) window.location.href = data.url;
  }

  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight">Create an account</h2>
        <p className="mt-1 text-sm text-muted-foreground">Get started with OneReal</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email" type="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password" type="password" placeholder="Min 6 characters"
            value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword" type="password"
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
      <div className="my-5 flex items-center gap-4">
        <Separator className="flex-1" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>
      <Button variant="outline" className="w-full" onClick={handleGoogleSignIn}>
        Continue with Google
      </Button>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-blue-600 hover:underline">Sign in</Link>
      </p>
    </>
  );
}
