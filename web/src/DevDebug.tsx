type DevDebugProps = {
  label: string;
  data: Record<string, string | number | boolean | null | undefined>;
};

export function DevDebug({ label, data }: DevDebugProps) {
  if (!import.meta.env.DEV) return null;

  return (
    <details className="mt-2 min-w-0 max-w-full text-xs text-muted">
      <summary className="inline-flex min-h-7 cursor-pointer list-none items-center rounded-full border border-line bg-white px-2.5 font-semibold hover:bg-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
        Debug · {label}
      </summary>
      <dl className="mt-1 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-ui bg-chrome p-2 [overflow-wrap:anywhere]">
        {Object.entries(data).map(([key, value]) => (
          <div className="contents" key={key}>
            <dt className="font-semibold">{key}</dt>
            <dd>{value === null ? 'null' : value === undefined ? '—' : String(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
