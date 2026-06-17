import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    dailymotion?: any;
  }
}

interface DailymotionPlayerProps {
  videoId: string;
  playing: boolean;
  volume: number;
  playbackRate: number;
  onProgress: (state: { playedSeconds: number }) => void;
  onDuration: (duration: number) => void;
  onReady: () => void;
  onEnded: () => void;
  playerRef: any;
}

export const DailymotionPlayer: React.FC<DailymotionPlayerProps> = ({
  videoId,
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

  useEffect(() => {
    let active = true;
    
    const initPlayer = () => {
      if (!window.dailymotion) return;
      if (!containerRef.current) return;
      if (dmPlayerInstance.current) return;

      window.dailymotion.createPlayer(containerRef.current.id, {
        video: videoId,
        params: {
          autoplay: playing,
          mute: volume === 0,
          controls: false, // Wait! the user wants A/B loop! Let's keep controls by default.
        }
      }).then((player: any) => {
        if (!active) return;
        dmPlayerInstance.current = player;
        
        player.setVolume(volume);
        player.setPlaybackRate(playbackRate);

        const events = window.dailymotion.events || {};
        player.on(events.PLAYER_TIMEUPDATE || 'timeupdate', () => {
          if (player.state && typeof player.state.currentTime === 'number') {
            onProgress({ playedSeconds: player.state.currentTime });
          }
        });
        
        player.on(events.PLAYER_DURATIONCHANGE || 'durationchange', () => {
          if (player.state && typeof player.state.duration === 'number') {
            onDuration(player.state.duration);
          }
        });

        player.on(events.PLAYER_ENDED || 'ended', () => {
          onEnded();
        });

        if (player.state?.duration) {
          onDuration(player.state.duration);
        }

        if (playerRef) {
          playerRef.current = {
            seekTo: (seconds: number) => {
              try { player.seek(seconds); } catch(e){}
            },
            getInternalPlayer: () => player
          };
        }

        onReady();
      }).catch((err: any) => {
         console.error("Dailymotion Initialization failed:", err);
      });
    };

    if (window.dailymotion) {
       initPlayer();
    } else if (!document.getElementById('dm-sdk')) {
       const script = document.createElement('script');
       script.id = 'dm-sdk';
       script.src = 'https://geo.dailymotion.com/libs/player/x5o62.js';
       script.async = true;
       script.onload = initPlayer;
       document.head.appendChild(script);
    } else {
       const check = setInterval(() => {
         if (window.dailymotion) {
           clearInterval(check);
           if (active) initPlayer();
         }
       }, 300);
       return () => clearInterval(check);
    }

    return () => {
      active = false;
      if (dmPlayerInstance.current) {
         try { dmPlayerInstance.current.pause(); } catch(e) {}
         if (containerRef.current) {
           containerRef.current.innerHTML = '';
         }
         dmPlayerInstance.current = null;
      }
    };
  }, [videoId]);

  useEffect(() => {
    if (dmPlayerInstance.current) {
      if (playing) {
        try { dmPlayerInstance.current.play(); } catch(e){}
      } else {
        try { dmPlayerInstance.current.pause(); } catch(e){}
      }
    }
  }, [playing]);

  useEffect(() => {
    if (dmPlayerInstance.current) {
      try { dmPlayerInstance.current.setVolume(volume); } catch(e){}
    }
  }, [volume]);

  useEffect(() => {
    if (dmPlayerInstance.current) {
      try { dmPlayerInstance.current.setPlaybackRate(playbackRate); } catch(e){}
    }
  }, [playbackRate]);

  return (
    <div id={`dm-player-container`} className="w-full h-full object-contain">
      <div id={`dm-player-${videoId}`} ref={containerRef} className="w-full h-full object-contain" />
    </div>
  );
};
