interface IconProps {
  size?: number;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function ChevronLeft({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

export function ChevronRight({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function UserIcon({ size = 19 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20c.9-3.6 3.8-5.4 7.2-5.4s6.3 1.8 7.2 5.4" />
    </svg>
  );
}

export function MicIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

export function LockIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="3" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function ShieldIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6l7-3Z" />
    </svg>
  );
}

export function ClapIcon({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M8.5 13.2 6.2 10.9a1.6 1.6 0 0 1 2.3-2.3l1.1 1.1" />
      <path d="M10.1 8.3 8.4 6.6a1.6 1.6 0 1 1 2.3-2.3l2.6 2.6" />
      <path d="M12.6 7.4a1.6 1.6 0 1 1 2.3-2.3l3 3a5.6 5.6 0 0 1-7.9 7.9l-1.5-1.5" />
      <path d="M4.2 5.1 3.5 3.4M7.4 3.6 7.2 2M2.6 8.5 1 8.2" />
    </svg>
  );
}

export function CardIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <rect x="2.8" y="5.5" width="18.4" height="13" rx="3" />
      <path d="M2.8 10h18.4M6.5 14.5h3" />
    </svg>
  );
}

export function DocIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M13.5 2.8H7a2.2 2.2 0 0 0-2.2 2.2v14a2.2 2.2 0 0 0 2.2 2.2h10a2.2 2.2 0 0 0 2.2-2.2V8.5Z" />
      <path d="M13.5 2.8V8.5h5.7M8.5 13h7M8.5 16.5h4.5" />
    </svg>
  );
}

export function LifebuoyIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" />
      <circle cx="12" cy="12" r="3.8" />
      <path d="m9.3 9.3-3.8-3.8M14.7 9.3l3.8-3.8M9.3 14.7l-3.8 3.8M14.7 14.7l3.8 3.8" />
    </svg>
  );
}

export function BoltIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M13 2.5 5 13.2h6l-2 8.3 8-10.7h-6l2-8.3Z" />
    </svg>
  );
}

export function LogOutIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M9.5 20.5H6a2.2 2.2 0 0 1-2.2-2.2V5.7A2.2 2.2 0 0 1 6 3.5h3.5" />
      <path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9.5" />
    </svg>
  );
}

export function GearIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.1 14.2a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.46V20a2 2 0 0 1-4 0v-.06a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.46-.97H4a2 2 0 0 1 0-4h.06a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9.9a1.6 1.6 0 0 0 .97-1.46V4a2 2 0 0 1 4 0v.06a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77v.07a1.6 1.6 0 0 0 1.46.97H20a2 2 0 0 1 0 4h-.06a1.6 1.6 0 0 0-1.46.97z" />
    </svg>
  );
}
