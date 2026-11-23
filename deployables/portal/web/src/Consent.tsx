import type { MouseEvent, ReactNode } from 'react';
import { toast } from 'sonner';
import { api, ApiError, json, type Consent } from './api';
import { btn, Failure, Loading, useAction, useData } from './ui';

export function LegalLinks({ className = '' }: { className?: string }) {
  const onPreviewClick = (label: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (import.meta.env.VITE_PREVIEW_MOCK === 'true') {
      e.preventDefault();
      toast.info(`Vorschau-Modus: ${label} wird im echten Betrieb vom Server ausgeliefert.`);
    }
  };
  return (
    <p className={`flex gap-4 text-sm text-muted ${className}`}>
      <a
        className="underline underline-offset-2 hover:text-ink"
        href="/impressum"
        onClick={onPreviewClick('Impressum')}
      >
        Impressum
      </a>
      <a
        className="underline underline-offset-2 hover:text-ink"
        href="/datenschutz"
        onClick={onPreviewClick('Datenschutz')}
      >
        Datenschutz
      </a>
    </p>
  );
}

// Shown after login until the current consent version is accepted; the server blocks everything else meanwhile.
export function ConsentStep({
  brand,
  logout,
  onAccepted,
}: {
  brand: ReactNode;
  logout: ReactNode;
  onAccepted: () => void;
}) {
  const consent = useData<Consent>('/me/consent');
  const action = useAction();
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="flex w-full max-w-xl flex-col items-start gap-5 rounded-ui bg-white p-6 sm:p-8">
        {brand}
        <h1 className="text-3xl font-extrabold tracking-tight">Bevor es losgeht</h1>
        {consent.isPending ? (
          <Loading />
        ) : consent.error ? (
          <Failure error={consent.error} retry={() => consent.refetch()} />
        ) : (
          <>
            {consent.data.draft && (
              <p className="rounded-ui bg-pop px-3 py-1 text-sm font-bold">Entwurf, noch nicht final</p>
            )}
            <div className="space-y-3 text-[15px]">
              {consent.data.text.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <LegalLinks />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <button
                type="button"
                className={btn.primary}
                disabled={action.busy}
                onClick={() =>
                  action.run(async () => {
                    try {
                      await api('/me/consent', json('POST', { version: consent.data.version }));
                      onAccepted();
                    } catch (e) {
                      // The text changed while it was open: show the new one instead of failing.
                      if (e instanceof ApiError && e.code === 'consent_outdated') await consent.refetch();
                      else throw e;
                    }
                  })
                }
              >
                Ich stimme zu
              </button>
              {logout}
            </div>
            {action.feedback}
          </>
        )}
      </section>
    </main>
  );
}
