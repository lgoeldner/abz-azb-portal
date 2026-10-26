import { useState } from 'react';
import type { Attachment, Submission } from './api';
import './PhotoGallery.css';

export type GalleryPhoto = Attachment & {
  href?: string;
  author_name?: string;
};

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
        const target = photo.href ?? photo.url;
        const label = photo.caption || photo.filename;
        const editingThis = editing === photo.id;
        const editable = typeof allowCaptionEdit === 'function' ? allowCaptionEdit(photo) : allowCaptionEdit;
        return (
          <figure className="photo-gallery__item" key={photo.id}>
            <a
              className="photo-gallery__image-link"
              href={target}
              target={photo.href ? undefined : '_blank'}
              rel={photo.href ? undefined : 'noreferrer'}
              aria-label={photo.href ? `${label} öffnen` : `${label} in voller Größe öffnen`}
            >
              <img
                className="photo-gallery__image"
                src={photo.preview_url}
                alt={photo.caption || photo.filename}
                loading="lazy"
              />
            </a>
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
                    autoFocus
                    disabled={busy || saving !== null}
                    onChange={(event) => setDraft(event.target.value)}
                  />
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
    </section>
  );
}
