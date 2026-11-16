import { CrepeBuilder } from '@milkdown/crepe/builder';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder as placeholderFeature } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar } from '@milkdown/crepe/feature/toolbar';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import { callCommand } from '@milkdown/kit/utils';
import {
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react';
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

type Run = (crepe: CrepeBuilder) => void;
const cmd =
  // The key of a command is only assigned once the editor has loaded it, so read it at click time.
  (command: { key: unknown }, payload?: unknown): Run =>
    (crepe) =>
      crepe.editor.action(callCommand(command.key as never, payload as never));

// Persistent formatting bar: the same actions as Crepe's floating toolbar and slash menu, always visible.
const tools: ({ label: string; icon?: LucideIcon; text?: string; run: Run } | 'sep')[] = [
  { label: 'Text', icon: Pilcrow, run: cmd(turnIntoTextCommand) },
  { label: 'Überschrift 1', text: 'H1', run: cmd(wrapInHeadingCommand, 1) },
  { label: 'Überschrift 2', text: 'H2', run: cmd(wrapInHeadingCommand, 2) },
  { label: 'Überschrift 3', text: 'H3', run: cmd(wrapInHeadingCommand, 3) },
  'sep',
  { label: 'Fett', icon: Bold, run: cmd(toggleStrongCommand) },
  { label: 'Kursiv', icon: Italic, run: cmd(toggleEmphasisCommand) },
  { label: 'Durchgestrichen', icon: Strikethrough, run: cmd(toggleStrikethroughCommand) },
  { label: 'Code', icon: Code, run: cmd(toggleInlineCodeCommand) },
  {
    label: 'Link',
    icon: Link2,
    run: (crepe) => {
      const href = window.prompt('Link-Adresse (https://… oder mailto:…)')?.trim();
      if (href && SAFE_LINK.test(href)) cmd(toggleLinkCommand, { href })(crepe);
    },
  },
  'sep',
  { label: 'Aufzählung', icon: List, run: cmd(wrapInBulletListCommand) },
  { label: 'Nummerierte Liste', icon: ListOrdered, run: cmd(wrapInOrderedListCommand) },
  { label: 'Zitat', icon: Quote, run: cmd(wrapInBlockquoteCommand) },
  { label: 'Trennlinie', icon: Minus, run: cmd(insertHrCommand) },
];

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
  const crepeRef = useRef<CrepeBuilder | null>(null);
  const [ready, setReady] = useState(false);
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
    const created = crepe.create();
    void created.then(() => {
      crepeRef.current = crepe;
      setReady(true);
    });
    return () => {
      crepeRef.current = null;
      setReady(false);
      // create() is async: destroy only after it settled, then drop the root.
      void created
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
      {!readonly && (
        <div className="md-editor-bar" role="toolbar" aria-label="Formatierung">
          {tools.map((tool, i) =>
            tool === 'sep' ? (
              <span key={i} aria-hidden="true" className="md-editor-sep" />
            ) : (
              <button
                key={tool.label}
                type="button"
                title={tool.label}
                aria-label={tool.label}
                disabled={!ready}
                // Keep the editor selection: do not let the button take focus.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => crepeRef.current && tool.run(crepeRef.current)}
              >
                {tool.icon ? <tool.icon aria-hidden="true" size={16} /> : tool.text}
              </button>
            ),
          )}
        </div>
      )}
      {!active && <div className="md-editor-fallback">{initial}</div>}
    </div>
  );
}
