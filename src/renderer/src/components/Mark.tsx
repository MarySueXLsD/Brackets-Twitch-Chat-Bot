// The Brackets mark: a chat bubble with two closing brackets, one in the highlight colour. It takes its
// colours from the theme. scripts/make-icons.mjs draws the same shapes for the app icon.
export function Mark({ size = 28, live = false }: { size?: number; live?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <path d="M16 6h32a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12H28L15 61V50A12 12 0 0 1 4 38V18A12 12 0 0 1 16 6z" fill="var(--petal-strong)" />
      <path d="M21.9 15a17 17 0 0 1 0 26" fill="none" stroke="var(--on-petal)" strokeWidth="5.4" strokeLinecap="round" />
      <path d="M34.9 15a17 17 0 0 1 0 26" fill="none" stroke="var(--pollen)" strokeWidth="5.4" strokeLinecap="round" className={live ? 'pulse-dot' : undefined} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
    </svg>
  )
}
