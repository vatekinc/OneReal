'use client';

import { useState } from 'react';
import { Button, Input, Label, Card, CardContent } from '@onereal/ui';
import { Building2, User } from 'lucide-react';

interface OrgStepProps {
  onSelectPersonal: () => void;
  onCreateCompany: (name: string, slug: string) => void;
  loading: boolean;
}

export function OrgStep({ onSelectPersonal, onCreateCompany, loading }: OrgStepProps) {
  const [mode, setMode] = useState<'choose' | 'company'>('choose');
  const [companyName, setCompanyName] = useState('');

  function generateSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  if (mode === 'company') {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Create your company</h2>
          <p className="text-sm text-muted-foreground">Set up your property management company</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="companyName">Company Name</Label>
          <Input
            id="companyName" value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="My Properties LLC"
          />
        </div>
        {companyName && (
          <p className="text-xs text-muted-foreground">
            URL: onereal.app/{generateSlug(companyName)}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setMode('choose')} disabled={loading}>
            Back
          </Button>
          <Button
            className="flex-1"
            onClick={() => onCreateCompany(companyName, generateSlug(companyName))}
            disabled={!companyName.trim() || loading}
          >
            {loading ? 'Creating...' : 'Create company'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">How will you use OneReal?</h2>
        <p className="text-sm text-muted-foreground">You can change this later</p>
      </div>
      <Card className="cursor-pointer hover:border-primary" onClick={onSelectPersonal}>
        <CardContent className="flex items-center gap-4 p-4">
          <User className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Individual Landlord</p>
            <p className="text-sm text-muted-foreground">I manage my own properties</p>
          </div>
        </CardContent>
      </Card>
      <Card className="cursor-pointer hover:border-primary" onClick={() => setMode('company')}>
        <CardContent className="flex items-center gap-4 p-4">
          <Building2 className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Property Management Company</p>
            <p className="text-sm text-muted-foreground">I manage properties for others</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
