import { useQueryClient } from '@tanstack/react-query';
import { Eye, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  getPreviewState,
  PREVIEW_ACCOUNTS,
  resetPreviewState,
  setPreviewAccount,
  setPreviewConsentRequired,
  subscribePreviewState,
} from './preview-mock';

export function PreviewBar() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(getPreviewState);

  useEffect(() => {
    return subscribePreviewState(() => {
      setState(getPreviewState());
      client.clear();
    });
  }, [client]);

  const current = PREVIEW_ACCOUNTS.find((a) => a.id === state.accountId) ?? PREVIEW_ACCOUNTS[0];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="UI-Vorschau-Einstellungen öffnen"
        className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-50 inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-ink px-3.5 py-2 text-xs font-semibold text-white shadow-lg transition-transform active:scale-95"
      >
        <Eye aria-hidden="true" className="size-3.5" />
        <span>Vorschau: {current.badge}</span>
      </button>
    );
  }

  return (
    <aside
      aria-label="UI-Vorschau-Steuerung"
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 right-3 z-50 max-w-sm rounded-2xl border border-line bg-white p-4 text-ink shadow-xl"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted">
          <Eye aria-hidden="true" className="size-3.5" />
          <span>UI-Vorschau · Mock-Daten</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Schließen"
          className="inline-flex size-8 items-center justify-center rounded-full text-muted hover:bg-chrome hover:text-ink"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <p className="mt-1 text-xs text-muted">Läuft rein im Browser ohne echtes Backend. Rolle zum Testen wählen:</p>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {PREVIEW_ACCOUNTS.map((acc) => {
          const active = acc.id === state.accountId;
          return (
            <button
              key={acc.label}
              type="button"
              onClick={() => {
                setPreviewAccount(acc.id);
                setOpen(false);
              }}
              className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                active
                  ? 'border-ink bg-ink font-semibold text-white'
                  : 'border-line bg-chrome/60 text-ink hover:bg-chrome'
              }`}
            >
              <span className="truncate font-semibold">{acc.label}</span>
              <span className={`text-[11px] ${active ? 'text-white/75' : 'text-muted'}`}>{acc.badge}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={state.consentRequired}
            onChange={(e) => setPreviewConsentRequired(e.target.checked)}
            className="size-4 accent-ink"
          />
          <span>Einwilligung erzwingen</span>
        </label>
        <button
          type="button"
          onClick={() => {
            resetPreviewState();
            setOpen(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold hover:bg-chrome"
        >
          <RotateCcw aria-hidden="true" className="size-3" />
          <span>Reset</span>
        </button>
      </div>
    </aside>
  );
}
