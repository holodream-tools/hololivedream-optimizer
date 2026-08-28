/**
 * 分享圖卡 — draw the team currently on screen and hand the picture over.
 *
 * One button for both pages that can produce a card, because both produce the
 * same kind of thing: a PNG of a specific team, built from that page's own
 * finished result. `data` is a function rather than a value so it is read at
 * the moment of the click -- swap a member, a Leader Outfit or a song and the
 * next card is the new one, with nothing here to keep in sync.
 *
 * Where Web Share carries files -- phones, mostly -- the PNG goes straight to
 * the share sheet. Where it does not, there is nothing to hand over: the card
 * is offered to open or to save instead. It cannot be offered as a link,
 * because it does not have one; it is made on this device, for this team, and
 * has never been anywhere else.
 */
import { useEffect, useRef, useState } from 'react';
import { renderShareCard, type ShareCardData } from '../lib/shareCard';
import type { ImageSource } from '../lib/images';

export interface ShareCardButtonProps {
  /** Read at click time, so the card is always the team on screen now. */
  data: () => ShareCardData | null;
  images: ImageSource | null;
  disabled?: boolean;
  /** What the saved file is called. */
  filename?: string;
}

const TITLE = 'hololive Dreams 隊伍最佳化';

/**
 * Can this browser hand a file to a share sheet?
 *
 * Asked with an empty stand-in rather than a real card, because the answer is
 * wanted before anything has been drawn: it decides what this button is called.
 * `canShare` weighs the type and the count, not the bytes.
 */
function canShareFiles(filename: string): boolean {
  if (!navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File([], filename, { type: 'image/png' })] });
  } catch {
    return false;
  }
}

export function ShareCardButton({ data, images, disabled,
                                 filename = 'hololive-dreams-team.png' }: ShareCardButtonProps) {
  /**
   * What this button actually does here, decided once.
   *
   * Where the browser can pass a file to a share sheet, pressing this shares
   * the card. Where it cannot, nothing is shared: a card is drawn and offered
   * to open or to keep. Those are two different actions and the button is named
   * after whichever one it is about to perform, rather than promising the one
   * this device cannot do.
   */
  const [canShare] = useState(() => canShareFiles(filename));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [cardUrl, setCardUrl] = useState('');
  const holder = useRef<HTMLDivElement>(null);
  /**
   * Every card this button has made, released together when the page goes.
   *
   * Not revoked as each new one replaces it: a card opened in another tab is
   * still being read from its URL, and revoking would blank that tab.
   */
  const urls = useRef<string[]>([]);

  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const say = (message: string) => {
    setNote(message);
    window.setTimeout(() => setNote((current) => (current === message ? '' : current)), 4000);
  };

  /**
   * Put the finished card where it can be opened or kept.
   *
   * No message goes with it: the menu appearing under the button, naming the
   * two things that can be done with the card, says it better than a line of
   * text would -- and the note is anchored to the same corner the menu is, so
   * the two cannot both be on screen anyway.
   */
  const offer = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    setCardUrl(url);
    setNote('');
    setOpen(true);
  };

  const share = async () => {
    const payload = data();
    if (!payload) return;
    setBusy(true);
    setOpen(false);
    try {
      const blob = await renderShareCard(payload, images);
      if (!canShare) {
        offer(blob);
        return;
      }
      const file = new File([blob], filename, { type: 'image/png' });
      if (!navigator.canShare?.({ files: [file] })) {
        offer(blob);
        return;
      }
      // No url alongside the file: sending one is how several targets end up
      // posting the link and dropping the picture.
      await navigator.share({ files: [file], title: TITLE, text: payload.subject });
    } catch (cause) {
      // A closed sheet is a decision, not a failure.
      if ((cause as Error)?.name === 'AbortError') return;
      say(`無法分享圖卡：${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-share" ref={holder}>
      <button aria-haspopup="menu" aria-expanded={open} disabled={disabled || busy}
              onClick={() => void share()}>
        {busy ? '產生中…' : canShare ? '分享圖卡' : '產生圖卡'}
      </button>
      {open && cardUrl && (
        <div className="card-share-menu" role="menu">
          <a role="menuitem" href={cardUrl} target="_blank" rel="noopener noreferrer"
             onClick={() => setOpen(false)}>開啟圖卡</a>
          <a role="menuitem" href={cardUrl} download={filename}
             onClick={() => setOpen(false)}>下載圖卡</a>
        </div>
      )}
      {note && <p className="card-share-note" role="status">{note}</p>}
    </div>
  );
}
