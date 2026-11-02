import { Activity, CalendarCheck, History, Presentation, Settings2, Sun, Waypoints, type LucideIcon } from 'lucide-react';
import type { ViewId } from '@/context/AppContext';

export const NAV: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'today', label: '오늘', icon: Sun },
  { id: 'missions', label: '미션', icon: Waypoints },
  { id: 'planner', label: '플래너', icon: CalendarCheck },
  { id: 'decks', label: '발표', icon: Presentation },
  { id: 'system', label: '시스템', icon: Activity },
  { id: 'activity', label: '활동', icon: History },
  { id: 'settings', label: '설정', icon: Settings2 },
];
