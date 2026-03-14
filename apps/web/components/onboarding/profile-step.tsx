'use client';

import { Button, Input, Label } from '@onereal/ui';

interface ProfileStepProps {
  firstName: string;
  lastName: string;
  phone: string;
  onChange: (field: string, value: string) => void;
  onNext: () => void;
}

export function ProfileStep({ firstName, lastName, phone, onChange, onNext }: ProfileStepProps) {
  const isValid = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Complete your profile</h2>
        <p className="text-sm text-muted-foreground">Tell us a bit about yourself</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="firstName">First Name *</Label>
        <Input
          id="firstName" value={firstName}
          onChange={(e) => onChange('firstName', e.target.value)} required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lastName">Last Name *</Label>
        <Input
          id="lastName" value={lastName}
          onChange={(e) => onChange('lastName', e.target.value)} required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input
          id="phone" type="tel" value={phone}
          onChange={(e) => onChange('phone', e.target.value)}
        />
      </div>
      <Button className="w-full" onClick={onNext} disabled={!isValid}>
        Continue
      </Button>
    </div>
  );
}
