/** Shared vector mark: a teaching book framed by two market candles. */
export function BrandMark({ className = "size-11" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={`brand-mark shrink-0 ${className}`}
    >
      <rect x="1" y="1" width="46" height="46" rx="14" fill="#233e61" />
      <rect x="1.5" y="1.5" width="45" height="45" rx="13.5" stroke="#ffffff" strokeOpacity=".12" />
      <path
        d="M12 15.5C16.5 14.5 20.3 16 24 19C27.7 16 31.5 14.5 36 15.5V32C31.5 31 27.7 32.5 24 35C20.3 32.5 16.5 31 12 32V15.5Z"
        stroke="#f3eee0"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M24 19V35" stroke="#f3eee0" strokeWidth="1.6" />
      <path d="M18 20V28M30 19V27" stroke="#d7bc7c" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16.5 22H19.5V26H16.5V22ZM28.5 21H31.5V24.5H28.5V21Z" fill="#d7bc7c" />
    </svg>
  );
}
