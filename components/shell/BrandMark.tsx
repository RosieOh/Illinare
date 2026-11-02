/** 브랜드 표식: 큰 방울에서 작은 방울이 갈라지는 순간 */
export default function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className={className} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M19.8 16.18C19.79 12.68 20.7 11.95 22.42 11.62A4.3 4.3 0 1 0 17.57 5.9C16.96 7.54 16.1 8.31 12.64 7.72A8.6 8.6 0 1 0 19.8 16.18Z" />
    </svg>
  );
}
