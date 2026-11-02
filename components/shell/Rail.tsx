'use client';

import { motion } from 'framer-motion';
import { Command } from 'lucide-react';
import { BRAND } from '@/lib/contracts';
import { Kbd, LiquidGlass, Tooltip, spring } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { useMediaQuery } from '@/utils/useMediaQuery';
import BrandMark from './BrandMark';
import { NAV } from './nav';

export default function Rail() {
  const { view, navigate, setPaletteOpen, bootstrap } = useApp();
  const { pendingApprovals } = useMissions();
  const isTabBar = useMediaQuery('(max-width: 819px)');
  const isIconRail = useMediaQuery('(max-width: 1179px) and (min-width: 820px)');

  const radius = isTabBar ? 24 : 26;

  return (
    <div className="rail">
      <LiquidGlass radius={radius} refract={isTabBar} bezel={12} strength={22} className="flex h-full flex-col p-2 max-[819px]:h-[58px] max-[819px]:flex-row max-[819px]:p-1">
        <div className="flex h-11 shrink-0 items-center gap-2.5 px-2.5 text-label max-[1179px]:justify-center max-[1179px]:px-0 max-[819px]:hidden">
          <BrandMark size={23} className="text-accent shrink-0" />
          <span className="text-headline max-[1179px]:hidden">{BRAND.name}</span>
        </div>

        <nav aria-label="주 메뉴" className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 max-[819px]:mt-0 max-[819px]:flex-row">
          {NAV.map((item) => {
            const active = view === item.id;
            const badge = item.id === 'missions' ? pendingApprovals.length : 0;
            const Icon = item.icon;
            const button = (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                aria-current={active ? 'page' : undefined}
                aria-label={badge ? `${item.label}, 승인 대기 ${badge}건` : item.label}
                className={`press relative flex h-[42px] shrink-0 items-center gap-3 rounded-[18px] px-3 text-callout outline-offset-[-2px] max-[1179px]:justify-center max-[1179px]:px-0 max-[819px]:h-full max-[819px]:min-w-0 max-[819px]:flex-1 max-[819px]:flex-col max-[819px]:justify-center max-[819px]:gap-0.5 max-[819px]:rounded-[20px] ${
                  active ? 'font-semibold text-label' : 'font-medium text-label-2 hover:bg-fill-4 hover:text-label'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="rail-selection"
                    transition={spring.snappy}
                    className="absolute inset-0 rounded-[inherit] bg-[var(--selected)] shadow-[0_1px_4px_rgba(0,20,60,.12),inset_0_0.5px_0_rgba(255,255,255,.4)]"
                    aria-hidden="true"
                  />
                )}
                <span className="relative flex">
                  <Icon size={19} strokeWidth={active ? 2.2 : 1.9} className={active ? 'text-accent-text' : ''} aria-hidden="true" />
                  {badge > 0 && (
                    <span
                      className="absolute -top-2 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-fill px-1 text-[10px] leading-none font-bold text-white"
                      aria-hidden="true"
                    >
                      {badge}
                    </span>
                  )}
                </span>
                <span className="relative whitespace-nowrap max-[1179px]:hidden max-[819px]:block max-[819px]:text-[10.5px] max-[819px]:leading-none">{item.label}</span>
              </button>
            );
            return isIconRail ? (
              <Tooltip key={item.id} content={item.label} placement="right">
                {button}
              </Tooltip>
            ) : (
              button
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="명령 찾기"
          className="press mt-auto flex h-10 shrink-0 items-center gap-2.5 rounded-[18px] px-3 text-subhead text-label-2 hover:bg-fill-4 hover:text-label max-[1179px]:justify-center max-[1179px]:px-0 max-[819px]:hidden"
        >
          <Command size={16} aria-hidden="true" />
          <span className="flex-1 text-left max-[1179px]:hidden">명령 찾기</span>
          <Kbd className="max-[1179px]:hidden">{bootstrap?.platform === 'darwin' ? '⌘K' : 'Ctrl K'}</Kbd>
        </button>
      </LiquidGlass>
    </div>
  );
}
