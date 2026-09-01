/**
 * Brand mark and the small stroke icon set used across the app screens.
 * All icons inherit `currentColor` so they follow the light/dark tokens.
 */

import type { ReactNode, SVGProps } from 'react'

interface IconProps {
  readonly size?: number
}

/** Abstract "link" mark: a filled node and an open node joined by an S-curve. */
export function LogoMark({ size = 24 }: IconProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M10 21.5C10 15 22 18 22 11.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="10" cy="24.5" r="3.2" fill="currentColor" />
      <circle cx="22" cy="8.5" r="3.2" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  )
}

function iconProps(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
}

export function QrIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3z" />
      <path d="M21 14v.01M14 21v.01M21 17v.01M17.5 20.5h3.5M21 21v.01" />
    </svg>
  )
}

export function MonitorIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M9 21h6M12 17v4" />
    </svg>
  )
}

export function MonitorXIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M9 21h6M12 17v4M9.8 8.2l4.4 4.4M14.2 8.2l-4.4 4.4" />
    </svg>
  )
}

export function PhoneIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  )
}

export function CheckIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  )
}

export function AlertIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  )
}

export function CloudOffIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <path d="m3 3 18 18" />
      <path d="M8.7 8.7A6 6 0 0 0 5 9a5 5 0 0 0 1 10h11" />
      <path d="M21.6 14.6A4.5 4.5 0 0 0 18 7h-1.3A6 6 0 0 0 9.5 5.5" />
    </svg>
  )
}

export function RefreshIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4h-4" />
    </svg>
  )
}

export function EyeIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  )
}

export function PowerOffIcon({ size = 20 }: IconProps): ReactNode {
  return (
    <svg {...iconProps(size)}>
      <path d="M12 3v8" />
      <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
    </svg>
  )
}
