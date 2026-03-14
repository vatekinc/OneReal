'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Button, Input, Label,
} from '@onereal/ui';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle>Check your email</CardTitle>
          <CardDescription>We sent a password reset link to {email}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login">
            <Button variant="outline" className="w-full">Back to sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Forgot password?</CardTitle>
        <CardDescription>Enter your email to receive a reset link</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email" type="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Sending...' : 'Send reset link'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/login" className="hover:underline">Back to sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}
