import { type LucideIcon } from 'lucide-react';
import { Badge } from '@onereal/ui';

interface ComingSoonProps {
  icon: LucideIcon;
  title: string;
  description: string;
  features: string[];
}

export function ComingSoon({ icon: Icon, title, description, features }: ComingSoonProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <Icon className="mb-4 h-16 w-16 text-muted-foreground/50" />
      <h2 className="mb-2 text-2xl font-bold">{title}</h2>
      <p className="mb-4 text-muted-foreground">{description}</p>
      <Badge variant="secondary" className="mb-6">In Development</Badge>
      <div className="text-left">
        <p className="mb-2 text-sm font-medium">Planned features:</p>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          {features.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </div>
    </div>
  );
}
