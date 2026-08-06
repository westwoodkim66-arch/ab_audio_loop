import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    dailymotion?: any;
    DM?: any;
  }
}

interface DailymotionPlayerProps {
  videoId: string;
  initialTime?: number | null;
  playing: boolean;
  volume: number;
  playbackRate: number;
  onProgress: (state: { playedSeconds: number }) => void;
  onDuration: (duration: number) => void;
  onReady: () => void;
  onEnded: () => void;
  playerRef: any;
}

// 全域 SDK 載入 Promise，避免重複載入
let sdkPromise: Promise<any> | null = null;

const loadDailymotionSDK = (): Promise<any> => {
  if (sdkPromise) return sdkPromise;
  
  sdkPromise = new Promise((resolve, reject) => {
    // 如果已存在，直接 resolve
    if (window.dailymotion) {
      resolve(window.dailymotion);
      return;
    }

    // 檢查是否已有 script 標籤
    const existing = document.getElementById('dm-sdk');
    if (existing) {
      const check = setInterval(() => {
        if (window.dailymotion) {
          clearInterval(check);
          resolve(window.dailymotion);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        if (!window.dailymotion) reject(new Error('SDK timeout'));
      }, 10000);
      return;
    }

    const script = document.createElement('script');
    script.id = 'dm-sdk';
    // 使用官方通用 Player SDK
    script.src = 'https://geo.dailymotion.com/libs/player.js';
    script.async = true;
    script.onload = () => {
      // SDK 載入後等待 window.dailymotion 出現
      const check = setInterval(() => {
        if (window.dailymotion) {
          clearInterval(check);
          resolve(window.dailymotion);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        if (!window.dailymotion) reject(new Error('dailymotion object not found'));
      }, 10000);
    };
    script.onerror = () => reject(new Error('Failed to load Dailymotion SDK'));
    document.head.appendChild(script);
  });
  
  return sdkPromise;
};

export const DailymotionPlayer: React.FC<DailymotionPlayerProps> = ({
  videoId,
  initialTime,
  playing,
  volume,
  playbackRate,
  onProgress,
  onDuration,
  onReady,
  onEnded,
  playerRef
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dmPlayerInstance = useRef<any>(null);
  const pollingRef = useRef<number | null>(null);
  const isReadyRef = useRef(false);
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

    const init = async () => {
      try {
        const dm = await loadDailymotionSDK();
        if (!active || !containerRef.current) return;

        // 確保容器是空的
        containerRef.current.innerHTML = '';

        const player = await dm.createPlayer(containerId.current, {
          video: videoId,
          params: {
            autoplay: false, // 由 useEffect 控制
            mute: false,
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
              // 30 秒後仍無法取得可跳轉狀態時才解除鎖定，避免永久卡死。
              readyCompleted = true;
              isReadyRef.current = true;
              onReady();
              if (playingRef.current) {
                try { await Promise.resolve(player.play()); } catch(playError){}
              }
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
  }, [videoId]);

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

  return (
    <div className="w-full h-full">
      <div 
        id={containerId.current} 
        ref={containerRef} 
        className="w-full h-full"
        style={{ minHeight: '100%' }}
      />
    </div>
  );
};
