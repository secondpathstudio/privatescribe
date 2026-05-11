type Props = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

export default function SectionHeader({ title, description, actions }: Props) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-3xl font-black">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
