const DATABASE = 'ab-loop-transcripts';
const STORE = 'results';
const VERSION = 2;
const LIMIT = 50;

export type TranscriptMode = 'native' | 'generate';
export interface TranscriptCacheEntry {
  key: string;
  media: string;
  language: string;
  requestedLanguage: string;
  mode: TranscriptMode;
  savedAt: number;
  raw: any[];
  lines?: any[];
  placeholderCount: number;
}

export function transcriptMediaKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] || null;
    }
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return `youtube:${id}`;
    const daily = (host === 'dailymotion.com' || host.endsWith('.dailymotion.com'))
      ? url.pathname.match(/\/video\/([A-Za-z0-9]+)/)?.[1]
      : host === 'dai.ly' ? url.pathname.split('/')[1] : null;
    if (daily) return `dailymotion:${daily}`;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cache database blocked'));
  });
}

// Storage failure must never prevent subtitle loading.
export async function readTranscriptCache(media: string, mode?: TranscriptMode, requestedLanguage = 'auto'): Promise<TranscriptCacheEntry | null> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const entries = await new Promise<TranscriptCacheEntry[]>((resolve, reject) => {
      const request = db!.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return entries.filter(entry => entry.key.startsWith(`[${VERSION},`) && entry.media === media && (!mode || entry.mode === mode)
      && entry.requestedLanguage === requestedLanguage && Array.isArray(entry.raw) && entry.raw.length > 0)
      .sort((a, b) => b.savedAt - a.savedAt)[0] || null;
  } catch { return null; }
  finally { db?.close(); }
}

export async function writeTranscriptCache(entry: Omit<TranscriptCacheEntry, 'key' | 'savedAt'>): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      // Translation and segmentation version are part of the key; old formats cannot leak in.
      store.put({ ...entry, key: JSON.stringify([VERSION, entry.media, entry.language, entry.requestedLanguage, entry.mode, 'zh-Hant']), savedAt: Date.now() });
      const all = store.getAll();
      all.onsuccess = () => {
        const sorted = (all.result as TranscriptCacheEntry[]).sort((a, b) => b.savedAt - a.savedAt);
        sorted.slice(LIMIT).forEach(item => store.delete(item.key));
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* Private browsing, unavailable storage or quota: continue without cache. */ }
  finally { db?.close(); }
}
