import { CrepeBuilder } from '@milkdown/crepe/builder';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder as placeholderFeature } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar } from '@milkdown/crepe/feature/toolbar';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/toolbar.css';
import '@milkdown/crepe/theme/common/table.css';
import './Editor.css';

// Only the common Crepe stylesheets above are imported. The aggregate style.css would also pull in
// latex.css (KaTeX web fonts), image-block.css and ai.css, none of which are enabled here.

export interface MarkdownEditorProps {
  /** Initial markdown. The editor is uncontrolled: change the React key to load another document. */
  value: string;
  onChange?: (markdown: string) => void;
  readonly?: boolean;
  placeholder?: string;
  label?: string;
}

const SAFE_LINK = /^(https?:|mailto:)/i;

/** Notion-like markdown editor on Milkdown Crepe: slash menu, block handles, toolbar. No images, LaTeX, code editor or uploads. */
export default function MarkdownEditor({
  value,
  onChange,
  readonly = false,
  placeholder = 'Text eingeben oder „/“ für Befehle …',
  label = 'Text',
}: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const [initial] = useState(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  // Read-only instances (long timelines) are only built once they scroll near the viewport.
  const [active, setActive] = useState(!readonly || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const node = host.current;
    if (active || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setActive(true);
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    const parent = host.current;
    if (!active || !parent) return;
    // A fresh child per instance keeps StrictMode double mounts from sharing one root.
    const root = document.createElement('div');
    parent.appendChild(root);
    // CrepeBuilder with explicit feature modules keeps KaTeX, CodeMirror and the AI feature out of the bundle.
    const crepe = new CrepeBuilder({ root, defaultValue: initial });
    crepe.addFeature(listItem).addFeature(table);
    if (!readonly) {
      crepe
        .addFeature(cursor)
        .addFeature(placeholderFeature, { text: placeholder, mode: 'block' })
        .addFeature(linkTooltip, { inputPlaceholder: 'Link einfügen …' })
        .addFeature(toolbar, {
          boldLabel: 'Fett',
          italicLabel: 'Kursiv',
          strikethroughLabel: 'Durchgestrichen',
          codeLabel: 'Code',
          linkLabel: 'Link',
        })
        .addFeature(blockEdit, {
          textGroup: {
            label: 'Text',
            text: { label: 'Text' },
            h1: { label: 'Überschrift 1' },
            h2: { label: 'Überschrift 2' },
            h3: { label: 'Überschrift 3' },
            h4: null,
            h5: null,
            h6: null,
            quote: { label: 'Zitat' },
            divider: { label: 'Trennlinie' },
          },
          listGroup: {
            label: 'Listen',
            bulletList: { label: 'Aufzählung' },
            orderedList: { label: 'Nummerierte Liste' },
            taskList: { label: 'Checkliste' },
          },
          advancedGroup: { label: 'Erweitert', image: null, codeBlock: null, math: null, table: { label: 'Tabelle' } },
        });
    }
    // The builder still turns pasted or dropped image files into blob: URL image nodes.
    // Uploads are not allowed, so pasted files are ignored.
    crepe.editor.config((ctx) => {
      ctx.update(uploadConfig.key, (prev) => ({ ...prev, uploader: async () => [] }));
    });
    crepe.setReadonly(readonly);
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, previous) => {
        if (markdown !== previous) onChangeRef.current?.(markdown);
      });
    });
    const ready = crepe.create();
    return () => {
      // create() is async: destroy only after it settled, then drop the root.
      void ready
        .catch(() => undefined)
        .then(() => crepe.destroy())
        .catch(() => undefined)
        .finally(() => root.remove());
    };
    // The editor is rebuilt only when activation or the readonly mode changes, never on value echoes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, readonly, initial]);

  // Read-only documents may contain links written by other managers: open only web or mail links.
  function guardLinks(event: MouseEvent<HTMLDivElement>) {
    if (!readonly) return;
    const anchor = (event.target as HTMLElement).closest?.('a[href]');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (SAFE_LINK.test(href.trim())) window.open(href, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      ref={host}
      className="md-editor"
      data-readonly={readonly || undefined}
      role="group"
      aria-label={label}
      onClickCapture={guardLinks}
    >
      {!active && <div className="md-editor-fallback">{initial}</div>}
    </div>
  );
}
