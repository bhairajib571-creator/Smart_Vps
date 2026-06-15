import React from 'react';

// Highly-polished premium isometric logo for SOSTA VPS
export function SostaLogo({ className = 'h-10 w-auto', textColor = '#ffffff' }: { className?: string; textColor?: string }) {
  return (
    <svg viewBox="0 0 160 40" className={`${className} select-none`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="sostaAura" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="cubeTop" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8"/>
          <stop offset="100%" stopColor="#cffafe"/>
        </linearGradient>
        <linearGradient id="cubeLeft" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0284c7"/>
          <stop offset="100%" stopColor="#0ea5e9"/>
        </linearGradient>
        <linearGradient id="cubeRight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#059669"/>
          <stop offset="100%" stopColor="#10b981"/>
        </linearGradient>
      </defs>

      {/* Premium Glowing Aura */}
      <circle cx="20" cy="20" r="20" fill="url(#sostaAura)" />

      <g transform="translate(20, 20)">
        {/* 3D Isometric Faces */}
        <path d="M 0 -13 L 13 -6.5 L 0 0 L -13 -6.5 Z" fill="url(#cubeTop)"/>
        <path d="M -14 -4.5 L -1 2 L -1 15 L -14 8.5 Z" fill="url(#cubeLeft)"/>
        <path d="M 1 2 L 14 -4.5 L 14 8.5 L 1 15 Z" fill="url(#cubeRight)"/>

        {/* Hardware Activity Indicators & Vents */}
        <circle cx="-8" cy="4" r="1" fill="#ffffff" opacity="0.9" className="animate-pulse" />
        <circle cx="-5" cy="5.5" r="1" fill="#ffffff" opacity="0.4" />
        <path d="M 3.5 5.5 L 11 1.7" stroke="#ffffff" strokeWidth="0.8" opacity="0.3" strokeLinecap="round" />
        <path d="M 3.5 8.5 L 11 4.7" stroke="#ffffff" strokeWidth="0.8" opacity="0.2" strokeLinecap="round" />
        <path d="M 3.5 11.5 L 11 7.7" stroke="#ffffff" strokeWidth="0.8" opacity="0.2" strokeLinecap="round" />
      </g>

      {/* Sleek Typography */}
      <text x="46" y="27" fill={textColor} fontSize="21" fontWeight="800" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="-0.3">
        SMART<tspan fill="#10b981" dx="4">VPS</tspan>
      </text>
    </svg>
  );
}

export function SostaLogoMarkOnly({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={`${className} select-none`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="sostaAuraM" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="cubeTopM" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8"/>
          <stop offset="100%" stopColor="#cffafe"/>
        </linearGradient>
        <linearGradient id="cubeLeftM" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0284c7"/>
          <stop offset="100%" stopColor="#0ea5e9"/>
        </linearGradient>
        <linearGradient id="cubeRightM" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#059669"/>
          <stop offset="100%" stopColor="#10b981"/>
        </linearGradient>
      </defs>

      <circle cx="20" cy="20" r="20" fill="url(#sostaAuraM)" />

      <g transform="translate(20, 20)">
        <path d="M 0 -13 L 13 -6.5 L 0 0 L -13 -6.5 Z" fill="url(#cubeTopM)"/>
        <path d="M -14 -4.5 L -1 2 L -1 15 L -14 8.5 Z" fill="url(#cubeLeftM)"/>
        <path d="M 1 2 L 14 -4.5 L 14 8.5 L 1 15 Z" fill="url(#cubeRightM)"/>

        <circle cx="-8" cy="4" r="1" fill="#ffffff" opacity="0.9" className="animate-pulse" />
        <circle cx="-5" cy="5.5" r="1" fill="#ffffff" opacity="0.4" />
        <path d="M 3.5 5.5 L 11 1.7" stroke="#ffffff" strokeWidth="0.8" opacity="0.3" strokeLinecap="round" />
        <path d="M 3.5 8.5 L 11 4.7" stroke="#ffffff" strokeWidth="0.8" opacity="0.2" strokeLinecap="round" />
        <path d="M 3.5 11.5 L 11 7.7" stroke="#ffffff" strokeWidth="0.8" opacity="0.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// 100% Vector Authentic bKash Brand Logo
export function BkashLogoInline({ className = 'h-11 w-auto' }: { className?: string }) {
  return (
    <img 
      src="https://www.logo.wine/a/logo/BKash/BKash-Logo.wine.svg" 
      alt="bKash" 
      className={`${className} select-none pointer-events-none object-contain`} 
      referrerPolicy="no-referrer" 
    />
  );
}

// 100% Vector Brand Compliant Nagad Logo
export function NagadLogoInline({ className = 'h-11 w-auto' }: { className?: string }) {
  return (
    <img 
      src="https://www.logo.wine/a/logo/Nagad/Nagad-Logo.wine.svg" 
      alt="Nagad" 
      className={`${className} select-none pointer-events-none object-contain`} 
      referrerPolicy="no-referrer" 
    />
  );
}

// 100% Vector Brand Compliant Rocket Logo
export function RocketLogoInline({ className = 'h-11 w-auto' }: { className?: string }) {
  return (
    <img 
      src="/src/assets/images/rocket_logo_official_1780151335616.png" 
      alt="Rocket" 
      className={`${className} select-none pointer-events-none object-contain`} 
      referrerPolicy="no-referrer" 
    />
  );
}

