import React, { useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';

declare global {
  interface Window {
    dailymotion?: any;
    DM?: any;
  }
}

interface DailymotionPlayerProps {
  videoId: string;
  playerId?: string;
  initialTime?: number | null;
  playing: boolean;
  volume: number;
  playbackRate: number;
  onProgress: (state: { playedSeconds: number }) => void;
  onDuration: (duration: number) => void;
  onReady: () => void;
  onEnded: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  playerRef: any;
}

// The project's original Dailymotion integration used this public Player ID.
// The bare /libs/player.js and /player.html endpoints can return Forbidden;
// retain the previously working configuration for accounts without their own.
const originalPlayerId = 'x5o62';
const sdkPromises = new Map<string, Promise<any>>();

const loadDailymotionSDK = (playerId: string): Promise<any> => {
  if (window.dailymotion?.createPlayer) return Promise.resolve(window.dailymotion);

  const scriptUrl = `https://geo.dailymotion.com/libs/player/${encodeURIComponent(playerId || originalPlayerId)}.js`;
  const cachedPromise = sdkPromises.get(scriptUrl);
  if (cachedPromise) return cachedPromise;

  const promise = new Promise<any>((resolve, reject) => {
    const scriptId = `dm-sdk-${playerId || originalPlayerId}`;
    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;

    const waitForSDK = (currentScript: HTMLScriptElement) => {
      const startedAt = Date.now();
      const check = window.setInterval(() => {
        if (window.dailymotion?.createPlayer) {
          window.clearInterval(check);
          resolve(window.dailymotion);
        } else if (Date.now() - startedAt >= 10000) {
          window.clearInterval(check);
          currentScript.remove();
          reject(new Error('Dailymotion SDK initialization timed out'));
        }
      }, 100);
    };

    if (existingScript) {
      waitForSDK(existingScript);
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.dataset.dmPlayerId = playerId;
    script.src = scriptUrl;
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onload = () => waitForSDK(script);
    script.onerror = () => {
      script.remove();
      reject(new Error('Failed to load Dailymotion Player library'));
    };
    document.head.appendChild(script);
  });

  sdkPromises.set(scriptUrl, promise);
  promise.catch(() => sdkPromises.delete(scriptUrl));
  return promise;
};

export const DailymotionPlayer: React.FC<DailymotionPlayerProps> = ({
  videoId,
  playerId,
  initialTime,
  playing,
  volume,
  playbackRate,
  onProgress,
  onDuration,
  onReady,
  onEnded,
  onPlay,
  onPause,
  playerRef
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dmPlayerInstance = useRef<any>(null);
  const pollingRef = useRef<number | null>(null);
  const isReadyRef = useRef(false);
  const fallbackReadyRef = useRef(false);
  const legacyReadyRef = useRef(false);
  const legacyPlayerRef = useRef<ReactPlayer | null>(null);
  const normalizedPlayerId = playerId?.trim() ?? '';
  const validPlayerId = !normalizedPlayerId || /^[a-z\d_-]{2,64}$/i.test(normalizedPlayerId);
  const [fallbackMode, setFallbackMode] = useState<'sdk' | 'legacy' | 'native'>('sdk');
  const [fallbackMessage, setFallbackMessage] = useState('');
  const initialTimeRef = useRef(initialTime);
  const playingRef = useRef(playing);
  const containerId = useRef(`dm-player-${videoId}-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    initialTimeRef.current = initialTime;
  }, [initialTime]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // 初始化 player（僅在 videoId 變更時）
  useEffect(() => {
    let active = true;
    let readyCompleted = false;
    let applyingInitialPosition = false;
    let readyRetryTimer: number | null = null;
    const readyDeadline = Date.now() + 30000;
    isReadyRef.current = false;
    fallbackReadyRef.current = false;
    legacyReadyRef.current = false;
    playerRef.current = null;

    if (!validPlayerId) {
      setFallbackMessage('Player ID 格式無效，已改用 Dailymotion 原生播放器；本站 A/B 控制不可用。');
      setFallbackMode('native');
      return () => {
        active = false;
      };
    }

    setFallbackMessage('');
    setFallbackMode('sdk');

    const init = async () => {
      try {
        const dm = await loadDailymotionSDK(normalizedPlayerId);
        if (!active || !containerRef.current) return;

        // 確保容器是空的
        containerRef.current.innerHTML = '';

        const player = await dm.createPlayer(containerId.current, {
          player: normalizedPlayerId || originalPlayerId,
          video: videoId,
          params: {
            autoplay: false, // 由 useEffect 控制
            mute: false,
            startTime: typeof initialTimeRef.current === 'number' ? Math.max(0, initialTimeRef.current) : 0,
            controls: false,
            'queue-enable': false,
            'sharing-enable': false,
            'ui-start-screen-info': false,
          }
        });

        if (!active) {
          try { player.destroy && player.destroy(); } catch(e){}
          return;
        }

        dmPlayerInstance.current = player;

        // 設定初始參數
        try { player.setVolume(volume); } catch(e){}
        try { player.setPlaybackSpeed ? player.setPlaybackSpeed(playbackRate) : player.setSubtitle && null; } catch(e){}

        // 事件常數（新版 SDK）
        const EVT = dm.events || {};
        const EVT_TIME = EVT.VIDEO_TIMECHANGE || EVT.PLAYER_TIMEUPDATE || 'timeupdate';
        const EVT_DURATION = EVT.VIDEO_DURATIONCHANGE || EVT.PLAYER_DURATIONCHANGE || 'durationchange';
        const EVT_END = EVT.VIDEO_END || EVT.PLAYER_ENDED || 'end';
        const EVT_CRITICAL_READY = EVT.PLAYER_CRITICALPATHREADY || 'player_criticalpathready';
        const EVT_VIDEO_CHANGE = EVT.PLAYER_VIDEOCHANGE || 'player_videochange';

        // Dailymotion 的 createPlayer Promise 完成，只代表 Player 物件已建立，
        // 不代表影片已經可以 seek。必須等影片 duration / critical path 可用，
        // 先套用 A 點並確認成功，再開放播放。
        const scheduleReadyRetry = () => {
          if (!active || readyCompleted || readyRetryTimer !== null) return;
          readyRetryTimer = window.setTimeout(() => {
            readyRetryTimer = null;
            completeReadyAtInitialPosition();
          }, 200);
        };

        const completeReadyAtInitialPosition = async () => {
          if (!active || readyCompleted || applyingInitialPosition) return;
          applyingInitialPosition = true;

          try {
            let state: any = null;
            if (typeof player.getState === 'function') {
              state = await player.getState();
            }

            const availableDuration = state?.videoDuration ?? state?.duration ?? 0;
            const criticalPathReady = state?.playerIsCriticalPathReady;
            if (!(availableDuration > 0) || criticalPathReady === false) {
              throw new Error('Dailymotion video is not seekable yet');
            }

            const requestedTime = initialTimeRef.current;
            const targetTime = typeof requestedTime === 'number' && Number.isFinite(requestedTime)
              ? Math.max(0, Math.min(requestedTime, availableDuration))
              : 0;

            if (targetTime > 0 && typeof player.seek === 'function') {
              await Promise.resolve(player.seek(targetTime));

              // 某些瀏覽器會在媒體尚未完全就緒時悄悄忽略第一次 seek。
              // 稍候讀回狀態；若仍在開頭，交由下面的 retry 再試。
              await new Promise(resolve => window.setTimeout(resolve, 150));
              if (typeof player.getState === 'function') {
                const verifiedState = await player.getState();
                const verifiedTime = verifiedState?.videoTime ?? verifiedState?.currentTime;
                if (typeof verifiedTime !== 'number' || Math.abs(verifiedTime - targetTime) > 2) {
                  throw new Error('Dailymotion initial seek was not applied');
                }
              }
            }

            if (!active) return;
            readyCompleted = true;
            isReadyRef.current = true;
            onProgress({ playedSeconds: targetTime });
            onReady();

            // 只有在 A 點已套用後才開始播放，避免第一幀從 0 秒開始。
            if (playingRef.current) {
              try { await Promise.resolve(player.play()); } catch(e){}
            }
        } catch(e) {
            if (active && Date.now() < readyDeadline) {
              scheduleReadyRetry();
            } else if (active && !readyCompleted) {
              // A black Player with no timeline cannot support A/B. Try the
              // older controllable integration before the native iframe.
              readyCompleted = true;
              isReadyRef.current = false;
              try { player.destroy?.(); } catch {}
              dmPlayerInstance.current = null;
              playerRef.current = null;
              containerRef.current?.replaceChildren();
              setFallbackMode('legacy');
            }
          } finally {
            applyingInitialPosition = false;
          }
        };

        // 註冊事件
        player.on(EVT_TIME, (state: any) => {
          const t = state?.videoTime ?? state?.currentTime ?? player.state?.videoTime ?? player.state?.currentTime;
          if (typeof t === 'number') onProgress({ playedSeconds: t });
        });

        player.on(EVT_DURATION, (state: any) => {
          const d = state?.videoDuration ?? state?.duration ?? player.state?.videoDuration ?? player.state?.duration;
          if (typeof d === 'number' && d > 0) onDuration(d);
          completeReadyAtInitialPosition();
        });

        player.on(EVT_CRITICAL_READY, () => completeReadyAtInitialPosition());
        player.on(EVT_VIDEO_CHANGE, () => completeReadyAtInitialPosition());

        player.on(EVT_END, () => {
          onEnded();
        });

        // 嘗試取得 duration（getState 為 async）
        const fetchDuration = async () => {
          try {
            if (typeof player.getState === 'function') {
              const st = await player.getState();
              if (st?.videoDuration) onDuration(st.videoDuration);
              else if (st?.duration) onDuration(st.duration);
            } else if (player.state?.videoDuration) {
              onDuration(player.state.videoDuration);
            }
          } catch(e){}
        };
        fetchDuration();

        // 輪詢時間（防止 timeupdate 不觸發或頻率過低）
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = window.setInterval(async () => {
          if (!dmPlayerInstance.current) return;
          try {
            if (typeof dmPlayerInstance.current.getState === 'function') {
              const st = await dmPlayerInstance.current.getState();
              if (st) {
                if (typeof st.videoTime === 'number') {
                  onProgress({ playedSeconds: st.videoTime });
                }
                if (typeof st.videoDuration === 'number' && st.videoDuration > 0) {
                  onDuration(st.videoDuration);
                }
              }
            }
          } catch(e){}
        }, 250);

        // 把 player 介面注入 playerRef 給外部使用
        if (playerRef) {
          playerRef.current = {
            seekTo: (seconds: number) => {
              try { 
                if (typeof player.seek === 'function') player.seek(seconds);
              } catch(e) { console.warn('DM seek failed', e); }
            },
            getInternalPlayer: () => player,
            getCurrentTime: async () => {
              try {
                if (typeof player.getState === 'function') {
                  const st = await player.getState();
                  return st?.videoTime ?? 0;
                }
              } catch(e){}
              return 0;
            },
            getDuration: async () => {
              try {
                if (typeof player.getState === 'function') {
                  const st = await player.getState();
                  return st?.videoDuration ?? 0;
                }
              } catch(e){}
              return 0;
            }
          };
        }

        // 避免事件在 listener 註冊前已經發生；主動檢查直到影片可 seek。
        completeReadyAtInitialPosition();

      } catch (err) {
        console.error('Dailymotion init failed:', err);
        if (active) {
          try { dmPlayerInstance.current?.destroy?.(); } catch {}
          dmPlayerInstance.current = null;
          playerRef.current = null;
          containerRef.current?.replaceChildren();
          // ReactPlayer uses Dailymotion's older public SDK. It still exposes
          // currentTime and seek to AB Loop when the modern library is blocked.
          setFallbackMode('legacy');
        }
      }
    };

    init();

    return () => {
      active = false;
      if (readyRetryTimer !== null) {
        clearTimeout(readyRetryTimer);
        readyRetryTimer = null;
      }
      isReadyRef.current = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      if (dmPlayerInstance.current) {
        try { 
          dmPlayerInstance.current.pause && dmPlayerInstance.current.pause(); 
        } catch(e){}
        try {
          dmPlayerInstance.current.destroy && dmPlayerInstance.current.destroy();
        } catch(e){}
        dmPlayerInstance.current = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [videoId, normalizedPlayerId, validPlayerId]);

  useEffect(() => {
    if (fallbackMode !== 'legacy') return;
    const timer = window.setTimeout(() => {
      if (!legacyReadyRef.current) {
        playerRef.current = null;
        onProgress({ playedSeconds: 0 });
        onDuration(0);
        onPause?.();
        setFallbackMessage('Dailymotion 可控制播放器無法載入。若播放器顯示 Forbidden，請在 Dailymotion 網站觀看。');
        setFallbackMode('native');
      }
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [fallbackMode, playerRef]);

  // 播放 / 暫停控制
  useEffect(() => {
    if (!dmPlayerInstance.current || !isReadyRef.current) return;
    try {
      if (playing) {
        dmPlayerInstance.current.play();
      } else {
        dmPlayerInstance.current.pause();
      }
    } catch(e){
      console.warn('DM play/pause failed', e);
    }
  }, [playing]);

  // 音量控制
  useEffect(() => {
    if (!dmPlayerInstance.current || !isReadyRef.current) return;
    try { 
      dmPlayerInstance.current.setVolume(volume);
      if (volume === 0) {
        dmPlayerInstance.current.setMute && dmPlayerInstance.current.setMute(true);
      } else {
        dmPlayerInstance.current.setMute && dmPlayerInstance.current.setMute(false);
      }
    } catch(e){}
  }, [volume]);

  // 播放速度
  useEffect(() => {
    if (!dmPlayerInstance.current || !isReadyRef.current) return;
    try {
      if (typeof dmPlayerInstance.current.setPlaybackSpeed === 'function') {
        dmPlayerInstance.current.setPlaybackSpeed(playbackRate);
      }
    } catch(e){}
  }, [playbackRate]);

  const fallbackUrl = new URL(`https://geo.dailymotion.com/player/${encodeURIComponent(normalizedPlayerId || originalPlayerId)}.html`);
  fallbackUrl.searchParams.set('video', videoId);
  if (typeof initialTime === 'number' && Number.isFinite(initialTime) && initialTime > 0) {
    fallbackUrl.searchParams.set('startTime', String(Math.floor(initialTime)));
  }
  if (volume === 0) fallbackUrl.searchParams.set('mute', 'true');

  return (
    <div className="relative w-full h-full">
      <div
        id={containerId.current} 
        ref={containerRef} 
        className="w-full h-full"
        style={{ minHeight: '100%', display: fallbackMode === 'sdk' ? 'block' : 'none' }}
      />
      {fallbackMode === 'legacy' && (
        <ReactPlayer
          ref={(instance) => {
            legacyPlayerRef.current = instance;
            if (instance) playerRef.current = instance;
          }}
          className="absolute inset-0"
          url={`https://www.dailymotion.com/video/${encodeURIComponent(videoId)}`}
          playing={playing}
          volume={volume}
          playbackRate={playbackRate}
          controls
          width="100%"
          height="100%"
          progressInterval={100}
          onProgress={onProgress}
          onDuration={onDuration}
          onEnded={onEnded}
          onPlay={onPlay}
          onPause={onPause}
          onReady={() => {
            legacyReadyRef.current = true;
            if (typeof initialTimeRef.current === 'number' && initialTimeRef.current > 0) {
              legacyPlayerRef.current?.seekTo(initialTimeRef.current, 'seconds');
            }
            onReady();
          }}
          onError={() => {
            playerRef.current = null;
            onProgress({ playedSeconds: 0 });
            onDuration(0);
            onPause?.();
            setFallbackMessage('Dailymotion 可控制播放器無法載入。若播放器顯示 Forbidden，請在 Dailymotion 網站觀看。');
            setFallbackMode('native');
          }}
        />
      )}
      {fallbackMode === 'native' && (
        <iframe
          src={fallbackUrl.toString()}
          title="Dailymotion 原生播放器"
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => { fallbackReadyRef.current = true; }}
        />
      )}
      {fallbackMode === 'native' && (
        <div className="absolute bottom-1 left-1 right-1 rounded bg-black/80 px-2 py-1 text-center text-[11px] text-white">
          {fallbackMessage || 'Dailymotion 原生播放器由平台控制；本站 A/B 控制不可用。'}{' '}
          <a
            className="underline"
            href={`https://www.dailymotion.com/video/${encodeURIComponent(videoId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            在 Dailymotion 開啟影片
          </a>
        </div>
      )}
    </div>
  );
};
