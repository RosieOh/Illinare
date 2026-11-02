import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentAvatar } from '@/components/glass/AgentAvatar';
import type { StepStatus } from '@/lib/contracts';

const markup = (props: { status?: StepStatus; working?: boolean }) => renderToStaticMarkup(createElement(AgentAvatar, { agent: 'writer', decorative: true, ...props }));

describe('AgentAvatar', () => {
  it('rests as dry glass by default, so a static row does not imply work', () => {
    expect(markup({})).not.toContain('data-wet');
  });

  it.each<StepStatus>(['running', 'awaiting_approval', 'done'])('holds liquid while %s', (status) => {
    expect(markup({ status })).toContain('data-wet');
  });

  it.each<StepStatus>(['pending', 'failed', 'skipped', 'cancelled'])('stays dry when %s', (status) => {
    expect(markup({ status })).not.toContain('data-wet');
  });

  it('holds liquid for a live agent with no step status', () => {
    expect(markup({ working: true })).toContain('data-wet');
  });
});
