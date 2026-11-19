import { Download, ExternalLink, X } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import type { Attachment, Submission } from './api';
import './PhotoGallery.css';

export type GalleryPhoto = Attachment & {
  href?: string;
  author_name?: string;
};

export const captionPlaceholder = 'Wer ist drauf? Welcher Anlass, wo, wann? z. B. „Lena und Tim beim Sommerfest 2026“';
export const captionHint = 'Namen, Anlass, Ort oder Datum helfen der Redaktion, das Foto einzuordnen.';

/** Local preview of a picked file before it is uploaded. */
export function LocalThumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  // ponytail: revoke once decoded; the img keeps its pixels. A never-loaded file leaks one blob URL until reload.
  return (
    <img className="photo-thumb" src={url} alt={`Vorschau von ${file.name}`} onLoad={() => URL.revokeObjectURL(url)} />
  );
}

export function photosFromSubmissions(
  submissions: Submission[],
  hrefFor?: (submission: Submission) => string,
): GalleryPhoto[] {
  return submissions.flatMap((submission) =>
    (submission.attachments ?? []).map((attachment) => ({
      ...attachment,
      href: hrefFor?.(submission),
      author_name: submission.author_name,
    })),
  );
}

export function PhotoGallery({
  photos,
  allowCaptionEdit = false,
  canRemove,
  busy = false,
  onSaveCaption,
  onRemove,
  detailsFor,
}: {
  photos: GalleryPhoto[];
  allowCaptionEdit?: boolean | ((photo: GalleryPhoto) => boolean);
  canRemove?: (photo: GalleryPhoto) => boolean;
  busy?: boolean;
  onSaveCaption?: (attachmentId: string, caption: string) => Promise<unknown>;
  onRemove?: (photo: GalleryPhoto) => void;
  detailsFor?: (photo: GalleryPhoto) => string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Natural aspect ratio per photo, learned on load; drives the justified-row widths.
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [viewing, setViewing] = useState<GalleryPhoto | null>(null);

  async function save(photo: GalleryPhoto) {
    if (!onSaveCaption) return;
    setSaving(photo.id);
    setError('');
    try {
      await onSaveCaption(photo.id, draft);
      setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Der Bildtext konnte nicht gespeichert werden.');
    } finally {
      setSaving(null);
    }
  }

  if (!photos.length) return null;

  return (
    <section className="photo-gallery" aria-label="Fotogalerie">
      {photos.map((photo) => {
        const label = photo.caption || photo.filename;
        const editingThis = editing === photo.id;
        const editable = typeof allowCaptionEdit === 'function' ? allowCaptionEdit(photo) : allowCaptionEdit;
        return (
          <figure
            className="photo-gallery__item"
            key={photo.id}
            style={{ '--ratio': ratios[photo.id] ?? 4 / 3 } as CSSProperties}
          >
            <button
              type="button"
              className="photo-gallery__image-link"
              aria-label={`${label} vergrößern`}
              onClick={() => setViewing(photo)}
            >
              <img
                className="photo-gallery__image"
                src={photo.preview_url}
                alt={photo.caption || photo.filename}
                loading="lazy"
                onLoad={({ currentTarget: img }) => {
                  if (!img.naturalWidth || !img.naturalHeight) return;
                  const ratio = img.naturalWidth / img.naturalHeight;
                  setRatios((current) => (current[photo.id] === ratio ? current : { ...current, [photo.id]: ratio }));
                }}
              />
            </button>
            <figcaption className="photo-gallery__caption">
              {photo.caption && <p className="photo-gallery__text">{photo.caption}</p>}
              {photo.author_name && (
                <p className="photo-gallery__source">
                  {photo.filename} <span>· {photo.author_name}</span>
                </p>
              )}
              {!photo.author_name && (
                <p className="photo-gallery__file">
                  {photo.filename} <span>· {(photo.size_bytes / 1024).toFixed(0)} KB</span>
                </p>
              )}
              {editingThis && editable && onSaveCaption ? (
                <form
                  className="photo-gallery__caption-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(photo);
                  }}
                >
                  <label htmlFor={`caption-${photo.id}`}>Bildtext</label>
                  <textarea
                    id={`caption-${photo.id}`}
                    value={draft}
                    maxLength={2000}
                    rows={3}
                    placeholder={captionPlaceholder}
                    aria-describedby={`caption-hint-${photo.id}`}
                    autoFocus
                    disabled={busy || saving !== null}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <small id={`caption-hint-${photo.id}`} className="photo-gallery__hint">
                    {captionHint}
                  </small>
                  <div className="photo-gallery__caption-actions">
                    <button type="button" disabled={busy || saving !== null} onClick={() => setEditing(null)}>
                      Abbrechen
                    </button>
                    <button type="submit" disabled={busy || saving !== null}>
                      {saving === photo.id ? 'Speichert …' : 'Bildtext speichern'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="photo-gallery__actions">
                  {detailsFor && <a href={detailsFor(photo)}>Details & Verlauf</a>}
                  {!detailsFor && photo.href && <a href={photo.href}>Beitrag öffnen</a>}
                  {editable && onSaveCaption && (
                    <button
                      type="button"
                      disabled={busy || saving !== null}
                      onClick={() => {
                        setDraft(photo.caption);
                        setEditing(photo.id);
                        setError('');
                      }}
                    >
                      Bildtext {photo.caption ? 'bearbeiten' : 'ergänzen'}
                    </button>
                  )}
                  {canRemove?.(photo) && onRemove && (
                    <button type="button" disabled={busy || saving !== null} onClick={() => onRemove(photo)}>
                      Foto entfernen
                    </button>
                  )}
                </div>
              )}
              {error && editingThis && (
                <p role="alert" className="photo-gallery__error">
                  {error}
                </p>
              )}
            </figcaption>
          </figure>
        );
      })}
      {viewing && (
        <dialog
          className="photo-lightbox"
          aria-label={viewing.caption || viewing.filename}
          ref={(dialog) => {
            if (dialog && !dialog.open) dialog.showModal();
          }}
          onClose={() => setViewing(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
          }}
        >
          {/* The 1600px preview is already cached from the gallery; only the download fetches the original. */}
          <img className="photo-lightbox__image" src={viewing.preview_url} alt={viewing.caption || viewing.filename} />
          <div className="photo-lightbox__bar">
            <p className="photo-lightbox__caption">{viewing.caption || viewing.filename}</p>
            {viewing.href && (
              <a
                className="photo-lightbox__icon"
                href={viewing.href}
                aria-label="Beitrag öffnen"
                title="Beitrag öffnen"
              >
                <ExternalLink aria-hidden size={20} />
              </a>
            )}
            <a
              className="photo-lightbox__icon"
              href={viewing.url}
              download={viewing.filename}
              aria-label="Original herunterladen"
              title="Original herunterladen"
            >
              <Download aria-hidden size={20} />
            </a>
            <button
              type="button"
              className="photo-lightbox__icon"
              aria-label="Schließen"
              title="Schließen"
              onClick={(event) => event.currentTarget.closest('dialog')?.close()}
            >
              <X aria-hidden size={20} />
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
