'use client';

import { MotionConfig } from 'framer-motion';
import { ToastProvider } from '@/components/glass';
import { AppProvider } from '@/context/AppContext';
import { FocusProvider } from '@/context/FocusContext';
import { MissionsProvider } from '@/context/MissionsContext';
import AppShell from '@/components/shell/AppShell';

export default function Page() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AppProvider>
          <MissionsProvider>
            <FocusProvider><AppShell /></FocusProvider>
          </MissionsProvider>
        </AppProvider>
      </ToastProvider>
    </MotionConfig>
  );
}
