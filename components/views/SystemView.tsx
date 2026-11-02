'use client';

import { useState } from 'react';
import { Activity, CircleAlert, Stethoscope, TriangleAlert } from 'lucide-react';
import { Button, EmptyState, Material, Skeleton, useToast } from '@/components/glass';
import { ViewHeader, ViewScroll, type ViewProps } from '@/components/shell/ViewFrame';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { ClientApiError } from '@/lib/client/api';
import { slowGoal, statusLine } from '@/components/system/model';
import { CpuPanel, NetworkPanel, ProcessesPanel, ResourcesPanel, StaleBanner } from '@/components/system/Panels';
import { useSystemMonitor } from '@/components/system/useSystemMonitor';

const SUBTITLE_ICON = { warning: TriangleAlert, danger: CircleAlert } as const;

export default function SystemView({ active }: ViewProps) {
  const { snapshot, history, error, lastOkAt, retry } = useSystemMonitor(active);
  const { start } = useMissions();
  const { navigate } = useApp();
  const toast = useToast();
  const [asking, setAsking] = useState(false);

  const askWhySlow = async () => {
    if (!snapshot) return;
    setAsking(true);
    try {
      await start(slowGoal(snapshot));
      navigate('missions');
    } catch (err) {
      toast({
        tone: 'danger',
        title: '미션을 시작하지 못했어요',
        description: err instanceof ClientApiError ? err.message : undefined,
      });
    } finally {
      setAsking(false);
    }
  };

  const status = snapshot ? statusLine(snapshot, history) : null;
  const StatusIcon = status && status.tone !== 'neutral' ? SUBTITLE_ICON[status.tone] : null;
  const subtitle = status ? (
    <span className={`inline-flex items-center gap-1.5 ${status.tone === 'danger' ? 'text-danger-text' : status.tone === 'warning' ? 'text-warning-text' : ''}`}>
      {StatusIcon && <StatusIcon size={15} aria-hidden="true" />}
      {status.text}
    </span>
  ) : (
    '이 컴퓨터의 상태를 실시간으로 봐요.'
  );

  return (
    <ViewScroll>
      <ViewHeader
        title="시스템"
        subtitle={subtitle}
        actions={
          <Button icon={Stethoscope} loading={asking} disabled={!snapshot} onClick={() => void askWhySlow()}>
            지금 왜 느린지 알아봐 줘
          </Button>
        }
      />

      {error && snapshot && <StaleBanner error={error} lastOkAt={lastOkAt} onRetry={retry} />}

      {!snapshot && error && (
        <Material radius={24}>
          <EmptyState
            icon={Activity}
            title="측정값을 받지 못했어요"
            description={error}
            action={<Button onClick={retry}>다시 시도</Button>}
          />
        </Material>
      )}

      {!snapshot && !error && <LoadingPanels />}

      {snapshot && (
        <div className="@container">
          <div className="grid items-start gap-4 @3xl:grid-cols-[minmax(0,1fr)_300px]">
            <CpuPanel snapshot={snapshot} history={history} stale={Boolean(error)} />
            <ResourcesPanel snapshot={snapshot} />
            <ProcessesPanel processes={snapshot.processes} pending={history.length < 8} />
            {snapshot.network && <NetworkPanel snapshot={snapshot} history={history} stale={Boolean(error)} />}
          </div>
        </div>
      )}
    </ViewScroll>
  );
}

function LoadingPanels() {
  return (
    <div className="@container" aria-busy="true" aria-label="측정값을 불러오는 중">
      <div className="grid items-start gap-4 @3xl:grid-cols-[minmax(0,1fr)_300px]">
        <Material className="p-5" radius={24}>
          <Skeleton width={72} height={18} />
          <Skeleton width={110} height={48} className="mt-4" />
          <Skeleton height={216} className="mt-3" radius={12} />
        </Material>
        <Material className="space-y-4 p-5" radius={24}>
          <Skeleton height={44} radius={10} />
          <Skeleton height={44} radius={10} />
          <Skeleton height={28} radius={10} />
        </Material>
      </div>
    </div>
  );
}
