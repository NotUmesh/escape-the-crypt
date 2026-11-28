import { createContext } from 'react';

export const OverlayStatusHost = createContext<((node: HTMLDivElement | null) => void) | null>(null);
export const LockActionHost = createContext<HTMLElement | null>(null);
