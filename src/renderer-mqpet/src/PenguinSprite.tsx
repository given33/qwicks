import { useEffect, useRef, useState } from 'react';
import { getAnim, type MqAnim } from '@shared/mqpet-anims';
import type { MqPetSourceAssetRef } from '@shared/mqpet-source-assets';
import { createMqpetSpriteBaseUrl, createStaticSpriteResolver, preloadSpriteNames } from './spriteResolver';
import { fitMqpetSpriteAtDesktopScale } from './spriteLayout';
import { OriginalSwfPlayer } from './OriginalSwfPlayer';
import { useFrameLoop } from './useFrameLoop';

const spriteBaseUrl = createMqpetSpriteBaseUrl({
  isDev: import.meta.env.DEV,
  moduleUrl: import.meta.url,
});

const loadedSizes = new Map<string, { width: number; height: number }>();

function preloadSpriteSize(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      loadedSizes.set(url, { width: image.naturalWidth, height: image.naturalHeight });
      resolve();
    };
    image.onerror = () => resolve();
    image.src = url;
  });
}

const spriteResolver = createStaticSpriteResolver(spriteBaseUrl, { load: preloadSpriteSize });
const useOriginalSwf = import.meta.env.VITE_MQPET_ORIGINAL_SWF === '1';

function resolveAnim(animName: string): MqAnim | undefined {
  return getAnim(animName) ?? getAnim('Pet_Idle') ?? getAnim('Stand');
}

export function PenguinSprite({
  animName,
  sourceAsset,
  width = 128,
  height = 144,
  onComplete,
  getSourceAsset,
}: {
  animName: string;
  sourceAsset?: MqPetSourceAssetRef | null;
  width?: number;
  height?: number;
  onComplete?: () => void;
  getSourceAsset?: (sourcePath: string) => Promise<ArrayBuffer | null>;
}): React.ReactElement {
  const anim = resolveAnim(animName);
  const [frameIdx, setFrameIdx] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string | undefined>();
  const [imageSizeVersion, setImageSizeVersion] = useState(0);
  const elapsed = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    setFrameIdx(0);
    setFrameUrl(undefined);
    elapsed.current = 0;
  }, [animName]);

  useEffect(() => {
    if (!anim) return;
    const startupSprites = anim.frames.slice(0, 8).map((frame) => frame.sprite);
    void preloadSpriteNames(spriteResolver, startupSprites).then(() => {
      setImageSizeVersion((value) => value + 1);
    });
  }, [anim]);

  useFrameLoop((dt) => {
    if (!anim || anim.frames.length === 0) return;
    const currentFrame = anim.frames[Math.min(frameIdx, anim.frames.length - 1)];
    elapsed.current += dt;
    if (elapsed.current < currentFrame.duration_ms) return;

    elapsed.current = 0;
    const nextIdx = frameIdx + 1;
    if (nextIdx < anim.frames.length) {
      setFrameIdx(nextIdx);
      return;
    }

    if (anim.loop) {
      setFrameIdx(0);
    } else {
      onCompleteRef.current?.();
    }
  });

  const frame = anim?.frames[Math.min(frameIdx, Math.max(0, anim.frames.length - 1))];
  useEffect(() => {
    let cancelled = false;
    if (!frame) {
      setFrameUrl(undefined);
      return () => { cancelled = true; };
    }

    const cached = spriteResolver.peek(frame.sprite);
    if (cached) {
      setFrameUrl(cached);
    } else {
      setFrameUrl(undefined);
      void spriteResolver.resolve(frame.sprite).then((url) => {
        if (!cancelled) setFrameUrl(url);
      });
    }

    if (anim) {
      const nextSprites = anim.frames.slice(frameIdx + 1, frameIdx + 4).map((item) => item.sprite);
      void preloadSpriteNames(spriteResolver, nextSprites);
    }

    return () => { cancelled = true; };
  }, [anim, frame, frameIdx]);

  const url = frameUrl;
  const natural = url ? loadedSizes.get(url) : undefined;
  const fitted = natural ? fitMqpetSpriteAtDesktopScale(natural, { width, height }) : undefined;

  return (
    <div
      data-source-action={sourceAsset?.action}
      data-source-path={sourceAsset?.sourcePath}
      data-source-stage={sourceAsset?.sourceStage}
      data-source-mood={sourceAsset?.mood}
      style={{
        width,
        height,
        position: 'relative',
        display: 'grid',
        placeItems: 'center',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {url && fitted ? (
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const img = event.currentTarget;
            const size = loadedSizes.get(url) ?? { width: img.naturalWidth, height: img.naturalHeight };
            if (!loadedSizes.has(url)) {
              loadedSizes.set(url, size);
            }
            if (size.width > 0 && size.height > 0) {
              setImageSizeVersion((value) => value + 1);
            }
          }}
          data-size-version={imageSizeVersion}
          style={{
            width: fitted.width,
            height: fitted.height,
            objectFit: 'contain',
            imageRendering: 'pixelated',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {useOriginalSwf && sourceAsset ? (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <OriginalSwfPlayer
            sourceAsset={sourceAsset}
            width={width}
            height={height}
            getSourceAsset={getSourceAsset}
          />
        </div>
      ) : null}
    </div>
  );
}
