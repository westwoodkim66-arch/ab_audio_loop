import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { transcriptMediaKey } from './transcriptCache';

export interface PlaybackMemory { position: number; subtitleOffset: number; savedAt: number }
const PREFIX = 'ab_playback_v1:';

export function playbackMediaKey(url: string, file?: Pick<File, 'name' | 'size' | 'lastModified'> | null) {
  if (url.startsWith('blob:')) return file ? `file:${JSON.stringify([file.name, file.size, file.lastModified])}` : null;
  return transcriptMediaKey(url);
}

export function readPlaybackMemory(key: string | null): PlaybackMemory | null {
  if (!key) return null;
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + key) || 'null');
    return value && Number.isFinite(value.position) && value.position >= 0
      && Number.isFinite(value.subtitleOffset) && Number.isFinite(value.savedAt) ? value : null;
  } catch { return null; }
}

export function savePlaybackMemory(key: string | null, value: PlaybackMemory) {
  if (!key || !Number.isFinite(value.position) || value.position < 0 || !Number.isFinite(value.subtitleOffset)) return;
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ ...value, savedAt: Date.now() })); }
  catch { /* Storage restrictions must not interrupt playback. */ }
}

// Keep the latest position in a ref: switching media must save the old media's
// last event, never a render containing the new URL and the old position.
export function usePlaybackMemory(key: string | null, initialOverride: number | null) {
  const [initial] = useState(() => readPlaybackMemory(key));
  const [subtitleOffset, setOffset] = useState(initial?.subtitleOffset || 0);
  const [initialTime, setInitialTime] = useState(initialOverride ?? initial?.position ?? 0);
  const snapshot = useRef({ key, position: initial?.position ?? 0, subtitleOffset: initial?.subtitleOffset ?? 0, savedAt: 0 });
  const pending = useRef(initialTime);
  const ready = useRef(false);
  const seekGuard = useRef<{ target: number; until: number } | null>(null);
  const first = useRef(true);
  const flush = useCallback(() => {
    const { key: media, ...value } = snapshot.current;
    savePlaybackMemory(media, value);
  }, []);

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    if (snapshot.current.key === key) return;
    flush();
    const saved = readPlaybackMemory(key);
    snapshot.current = { key, position: saved?.position ?? 0, subtitleOffset: saved?.subtitleOffset ?? 0, savedAt: 0 };
    ready.current = false;
    seekGuard.current = null;
    pending.current = saved?.position ?? 0;
    setInitialTime(pending.current);
    setOffset(saved?.subtitleOffset ?? 0);
  }, [key, flush]);

  const setSubtitleOffset = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    snapshot.current.subtitleOffset = value;
    setOffset(value);
    flush();
  }, [flush]);

  const restorePosition = useCallback((duration?: number) => {
    if (snapshot.current.key !== key) return null;
    // A finished recording reopens at the beginning rather than seeking past its end.
    const target = duration && duration > 0 && pending.current >= duration - 0.5 ? 0 : pending.current;
    ready.current = true;
    snapshot.current.position = target;
    seekGuard.current = target > 0 ? { target, until: Date.now() + 3000 } : null;
    return target;
  }, [key]);

  const rememberProgress = useCallback((position: number) => {
    if (snapshot.current.key !== key || !Number.isFinite(position) || position < 0) return false;
    if (!ready.current) return true;
    const guard = seekGuard.current;
    if (guard && Math.abs(position - guard.target) > 2 && Date.now() < guard.until) return false;
    seekGuard.current = null;
    snapshot.current.position = position;
    return true;
  }, [key]);

  useEffect(() => {
    const timer = window.setInterval(flush, 3000);
    const hide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hide);
    return () => {
      flush(); window.clearInterval(timer);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [flush]);

  return { subtitleOffset, setSubtitleOffset, initialTime, restorePosition, rememberProgress, flush };
}
