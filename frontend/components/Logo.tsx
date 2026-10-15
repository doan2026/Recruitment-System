export function Logo({ className = "", size = 32 }: { className?: string; size?: number }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 512 512" 
      width={size} 
      height={size}
      className={className}
    >
      <defs>
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--primary-2, #00b14f)" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="128" fill="url(#logo-grad)" />
      <path 
        d="M 360 180 A 128 128 0 1 0 360 332" 
        fill="none" 
        stroke="#ffffff" 
        strokeWidth="64" 
        strokeLinecap="round" 
      />
    </svg>
  );
}
