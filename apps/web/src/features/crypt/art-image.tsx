import type { CSSProperties, ReactNode } from 'react';
import type { CropFrame } from './crop-mapping';
import type { ArtDirectory } from './scene-layout';

/** What every art layer needs to find its file and sit in the frame. */
export interface ArtContext {
  readonly artRoom: string;
  readonly directory: ArtDirectory;
  readonly frame: CropFrame;
  /** Paths (directory/file) whose load failed. Nothing is drawn for them (Requirement 23.1). */
  readonly failed: ReadonlySet<string>;
  readonly onFail: (path: string) => void;
}

export function artPath(directory: ArtDirectory, file: string): string {
  return `${directory}/${file}`;
}

export function artUrl(artRoom: string, directory: ArtDirectory, file: string): string {
  return `/art/rooms/${artRoom}/${artPath(directory, file)}`;
}

export function frameStyle(frame: CropFrame): CSSProperties {
  return { left: frame.x, top: frame.y, width: frame.width, height: frame.height };
}

export interface ArtImageProps {
  readonly ctx: ArtContext;
  readonly layer: 'background' | 'lock' | 'light' | 'door' | 'foreground';
  readonly file: string;
  readonly className?: string;
  /** Extra attributes for tests and CSS, such as which state a lock image shows. */
  readonly data?: Readonly<Record<string, string>>;
  readonly srcSet?: string;
}

/** One full-frame art layer. Empty alt text: nothing needed to answer a question is only in an image (Requirement 7.7). */
export function ArtImage({ ctx, layer, file, className, data, srcSet }: ArtImageProps): ReactNode {
  const path = artPath(ctx.directory, file);
  if (ctx.failed.has(path)) return null;
  const dataAttributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(data ?? {})) dataAttributes[`data-${key}`] = value;
  return (
    <img
      alt=""
      draggable={false}
      className={`art-layer art-layer--${layer}${className === undefined ? '' : ` ${className}`}`}
      src={artUrl(ctx.artRoom, ctx.directory, file)}
      srcSet={srcSet}
      data-layer={layer}
      data-file={file}
      style={frameStyle(ctx.frame)}
      onError={() => ctx.onFail(path)}
      {...dataAttributes}
    />
  );
}
