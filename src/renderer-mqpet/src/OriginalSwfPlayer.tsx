import { useEffect, useRef, useState } from 'react';
import type { MqPetSourceAssetRef } from '@shared/mqpet-source-assets';

type RuffleElement = HTMLElement & {
  ruffle: () => {
    load: (source: { data: ArrayBuffer; swfFileName?: string }, isPolyfillElement?: boolean) => Promise<void>;
  };
};

type RuffleApi = {
  newest: () => {
    createPlayer: () => RuffleElement;
  };
};

type RuffleGlobal = Partial<RuffleApi> & {
  config?: Record<string, unknown>;
};

declare global {
  interface Window {
    RufflePlayer?: RuffleGlobal;
  }
}

let ruffleScriptPromise: Promise<void> | null = null;

export function createRufflePublicPath({
  isDev,
  moduleUrl,
}: {
  isDev: boolean;
  moduleUrl: string;
}): string {
  if (isDev) return new URL('../../../node_modules/@ruffle-rs/ruffle/', moduleUrl).href;
  return new URL('../ruffle/', moduleUrl).href;
}

function rufflePublicPath(): string {
  return createRufflePublicPath({
    isDev: import.meta.env.DEV,
    moduleUrl: import.meta.url,
  });
}

function loadRuffleScript(): Promise<void> {
  if (ruffleScriptPromise) return ruffleScriptPromise;

  const rufflePlayer = window.RufflePlayer ?? {};
  window.RufflePlayer = rufflePlayer;
  rufflePlayer.config = {
    ...(rufflePlayer.config ?? {}),
    autoplay: 'on',
    backgroundColor: null,
    contextMenu: 'off',
    letterbox: 'off',
    logLevel: 'error',
    menu: false,
    polyfills: false,
    publicPath: rufflePublicPath(),
    splashScreen: false,
    wmode: 'transparent',
  };

  ruffleScriptPromise = new Promise((resolve, reject) => {
    if (typeof window.RufflePlayer?.newest === 'function') {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `${rufflePublicPath()}ruffle.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Ruffle'));
    document.head.appendChild(script);
  });
  return ruffleScriptPromise;
}

export function OriginalSwfPlayer({
  sourceAsset,
  width,
  height,
  getSourceAsset,
}: {
  sourceAsset: MqPetSourceAssetRef | null | undefined;
  width: number;
  height: number;
  getSourceAsset?: (sourcePath: string) => Promise<ArrayBuffer | null>;
}): React.ReactElement | null {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<RuffleElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadRuffleScript()
      .then(() => {
        if (cancelled) return;
        const host = hostRef.current;
        const api = window.RufflePlayer?.newest?.();
        if (!host || !api) return;
        host.textContent = '';
        const player = api.createPlayer();
        player.style.width = '100%';
        player.style.height = '100%';
        player.style.pointerEvents = 'none';
        playerRef.current = player;
        host.appendChild(player);
        setReady(true);
      })
      .catch(() => setReady(false));
    return () => {
      cancelled = true;
      playerRef.current?.remove();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!ready || !sourceAsset || !getSourceAsset || !playerRef.current) return () => { cancelled = true; };
    void getSourceAsset(sourceAsset.sourcePath).then((data) => {
      if (cancelled || !data || !playerRef.current) return;
      void playerRef.current.ruffle().load({
        data,
        swfFileName: sourceAsset.sourcePath.split('/').pop(),
      });
    });
    return () => { cancelled = true; };
  }, [getSourceAsset, ready, sourceAsset]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{
        width,
        height,
        display: 'grid',
        placeItems: 'center',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    />
  );
}
