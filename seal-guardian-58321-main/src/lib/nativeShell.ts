import { App } from '@capacitor/app';
import { CapacitorHttp } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { toast } from '@/hooks/use-toast';
import { isNativeApp } from './nativeSession';

// ---------------------------------------------------------------------------
// Native-app-only behaviour. Imported by main.tsx for its side effects;
// on the web every branch below is skipped.
// ---------------------------------------------------------------------------

/**
 * Fired on Android's back button before going back in history. The franchise
 * and admin dashboards switch sections in local state rather than by URL, so
 * to the WebView the whole dashboard is one page; a layout that is showing a
 * section other than its home calls preventDefault() and goes home instead.
 */
export const APP_BACK_EVENT = 'app:back';

/**
 * The bell may be out of date: the app came back to the front, or a push
 * arrived while it was open. NotificationContext re-fetches on this.
 */
export const NOTIFICATIONS_STALE_EVENT = 'app:notifications-stale';

const EXIT_WINDOW_MS = 2000;
let lastBackAt = 0;

// Radix dialogs, sheets, popovers and menus all close on Escape.
const hasOpenOverlay = () =>
  !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]'
  );

function handleBack(canGoBack: boolean) {
  if (hasOpenOverlay()) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    return;
  }
  // A dashboard on one of its sections goes to its home section first —
  // the section isn't in the URL, so history can't undo it.
  const event = new Event(APP_BACK_EVENT, { cancelable: true });
  if (!window.dispatchEvent(event)) return;
  if (canGoBack) {
    window.history.back();
    return;
  }

  // A stray press on the home screen shouldn't drop the user out of the app.
  const now = Date.now();
  if (now - lastBackAt < EXIT_WINDOW_MS) {
    void App.exitApp();
  } else {
    lastBackAt = now;
    toast({ title: 'Press back again to exit', duration: EXIT_WINDOW_MS });
  }
}

// ---------------------------------------------------------------------------
// Downloads
//
// Every download in the portal clicks an <a download> — a QR rendered to a
// data: URL, a CSV or PDF in a blob:, an attachment on the API. The WebView
// ignores those. In the app they are written to Documents/AFAC instead and
// then offered to the share sheet, which is where a franchise sends a QR or
// invoice next anyway (WhatsApp, print).
// ---------------------------------------------------------------------------

const SAVE_FOLDER = 'AFAC';

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

async function readAsBase64(href: string): Promise<string> {
  if (href.startsWith('http')) {
    // Native request: files on the API (/uploads) carry no CORS headers.
    const res = await CapacitorHttp.get({ url: href, responseType: 'blob' });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return String(res.data);
  }
  return blobToBase64(await (await fetch(href)).blob());
}

async function saveDownload(href: string, filename: string) {
  const name = (filename || 'download').replace(/[\\/:*?"<>|]+/g, '_');
  try {
    const data = await readAsBase64(href);
    const path = `${SAVE_FOLDER}/${Date.now()}_${name}`;

    let directory = Directory.Documents;
    try {
      // Only Android 10 and older need storage permission for this.
      await Filesystem.requestPermissions().catch(() => undefined);
      await Filesystem.writeFile({ path, data, directory, recursive: true });
      toast({ title: 'Downloaded', description: `Saved to Documents/${SAVE_FOLDER}` });
    } catch {
      // No public storage — keep it private to the app; sharing still works.
      directory = Directory.Cache;
      await Filesystem.writeFile({ path, data, directory, recursive: true });
    }

    const { uri } = await Filesystem.getUri({ path, directory });
    await Share.share({ title: name, files: [uri] }).catch(() => undefined); // dismissing the sheet rejects
  } catch {
    toast({ title: 'Download failed', description: 'Please try again.', variant: 'destructive' });
  }
}

function interceptDownload(anchor: HTMLAnchorElement): boolean {
  if (!anchor.hasAttribute('download') || !anchor.href) return false;
  void saveDownload(anchor.href, anchor.getAttribute('download') || '');
  return true;
}

if (isNativeApp) {
  void App.addListener('backButton', ({ canGoBack }) => handleBack(canGoBack));
  // Android may not report a visibility change when the app returns from the
  // background, so say it explicitly.
  void App.addListener('resume', () => window.dispatchEvent(new Event(NOTIFICATIONS_STALE_EVENT)));

  // Programmatic downloads: link.click() on a detached <a download>.
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (interceptDownload(this)) return;
    nativeClick.call(this);
  };

  // A user tapping a rendered <a download>.
  document.addEventListener(
    'click',
    (e) => {
      const anchor = (e.target as Element | null)?.closest?.('a[download]') as HTMLAnchorElement | null;
      if (anchor && interceptDownload(anchor)) e.preventDefault();
    },
    true
  );
}
