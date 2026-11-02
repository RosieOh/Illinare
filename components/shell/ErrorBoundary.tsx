'use client';

import { Component, type ReactNode } from 'react';
import { Button, Material } from '@/components/glass';

interface Props {
  /** 어느 화면인지 (메시지에 사용) */
  label: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** 한 화면이 실패해도 셸과 진행 중인 미션은 계속 동작하게 한다. */
export default class ViewErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[view:${this.props.label}]`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="view-fixed flex items-center justify-center">
        <Material tier="regular" className="max-w-md p-6 text-center">
          <h2 className="text-title3 text-label">{this.props.label} 화면을 표시하지 못했어요</h2>
          <p className="mt-2 text-callout text-label-2">
            다른 화면과 진행 중인 미션에는 영향이 없어요. 문제가 계속되면 앱을 다시 실행해 주세요.
          </p>
          <Button variant="primary" className="mt-4 !rounded-full" onClick={() => this.setState({ failed: false })}>
            다시 시도
          </Button>
        </Material>
      </div>
    );
  }
}
