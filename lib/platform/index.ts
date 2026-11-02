import { darwinPlatform } from './darwin';
import { linuxPlatform } from './linux';
import { win32Platform } from './win32';
import type { Platform } from './types';

export type { ActivitySample, Capability, Platform, RawProcess } from './types';
export { CapabilityError } from './types';

export function getPlatform(): Platform {
  if (process.platform === 'win32') return win32Platform;
  if (process.platform === 'darwin') return darwinPlatform;
  return linuxPlatform;
}
