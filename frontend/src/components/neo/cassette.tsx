import React from 'react'

type Props = {
    labelText?: string
    width?: number | string
    height?: number | string
    className?: string
    style?: React.CSSProperties
}

const CassetteSVG = ({ 
    labelText, 
    width = 200, 
    height = 130, 
    className = '',
    style = {}
}: Props) => {
  return (
    <svg 
      viewBox="0 0 200 130" 
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      className={className}
      style={style}
    >
    <defs>
        {/* Neon glow effect */}
        <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
        <feMerge> 
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
        </feMerge>
        </filter>
        
        {/* Gradient for the cassette body */}
        <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#2a2a2a"/>
        <stop offset="50%" stopColor="#1a1a1a"/>
        <stop offset="100%" stopColor="#0a0a0a"/>
        </linearGradient>

        {/* Gradient for the cassette reels label */}
        <linearGradient id="reelLabel" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f8f8f8"/>
        <stop offset="25%" stopColor="#ffffff"/>
        <stop offset="30%" stopColor="#ff00ff"/>
        <stop offset="35%" stopColor="#00ffff"/>
        <stop offset="40%" stopColor="#ffff00"/>
        <stop offset="45%" stopColor="#ff8800"/>
        <stop offset="50%" stopColor="#ff0088"/>
        <stop offset="55%" stopColor="#8800ff"/>
        <stop offset="60%" stopColor="#0088ff"/>
        <stop offset="65%" stopColor="#00ff88"/>
        <stop offset="70%" stopColor="#ffff00"/>
        <stop offset="75%" stopColor="#ffffff"/>
        <stop offset="100%" stopColor="#f8f8f8"/>
        </linearGradient>
        
        {/* Gradient for the label */}
        <linearGradient id="labelGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#5d1d91" stopOpacity="0.4"/>
        <stop offset="50%" stopColor="#fd3777" stopOpacity="0.8"/>
        <stop offset="100%" stopColor="#5d1d91" stopOpacity="0.4"/>
        </linearGradient>

        {/* Animated gradient for the text */}
        <linearGradient id="textGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#fd3777" />
        <stop offset="100%" stopColor="#ffffff" />
        <animateTransform
          attributeName="gradientTransform"
          type="translate"
          values="-100 0; 100 0; -100 0"
          dur="2s"
          repeatCount="indefinite"/>
        </linearGradient>
        
        {/* Reel spoke pattern */}
        <g id="reelSpokes">
        <line x1="0" y1="-15" x2="0" y2="-8" stroke="#666" strokeWidth="1"/>
        <line x1="10.6" y1="-10.6" x2="7.5" y2="-7.5" stroke="#666" strokeWidth="1"/>
        <line x1="15" y1="0" x2="8" y2="0" stroke="#666" strokeWidth="1"/>
        <line x1="10.6" y1="10.6" x2="7.5" y2="7.5" stroke="#666" strokeWidth="1"/>
        <line x1="0" y1="15" x2="0" y2="8" stroke="#666" strokeWidth="1"/>
        <line x1="-10.6" y1="10.6" x2="-7.5" y2="7.5" stroke="#666" strokeWidth="1"/>
        <line x1="-15" y1="0" x2="-8" y2="0" stroke="#666" strokeWidth="1"/>
        <line x1="-10.6" y1="-10.6" x2="-7.5" y2="-7.5" stroke="#666" strokeWidth="1"/>
        </g>
    </defs>
    
    {/* Cassette body */}
    <rect x="10" y="10" width="180" height="110" rx="8" ry="8" 
            fill="url(#bodyGradient)" 
            stroke="#333" 
            strokeWidth="2"/>
    
    {/* Top section with reels */}
    <rect x="20" y="20" width="160" height="60" rx="4" ry="4" 
            fill="url(#reelLabel)" 
            stroke="#444" 
            strokeWidth="1"/>
    
    {/* Left reel housing */}
    <circle cx="60" cy="50" r="25" 
            fill="#0a0a0a" 
            stroke="#fd3777" 
            strokeWidth="1.5" 
            filter="url(#neonGlow)"/>
    
    {/* Right reel housing */}
    <circle cx="140" cy="50" r="25" 
            fill="#0a0a0a" 
            stroke="#fd3777" 
            strokeWidth="1.5" 
            filter="url(#neonGlow)"/>
    
    {/* Left reel (spinning) */}
    <g>
        {/* Reel hub */}
        <circle cx="60" cy="50" r="8" fill="#333" stroke="#666" strokeWidth="1"/>
        {/* Spokes with spinning animation */}
        <g transform="translate(60, 50)">
        <g>
            <use href="#reelSpokes"/>
            {/* Spinning animation */}
            <animateTransform
            attributeName="transform"
            type="rotate"
            values="0;360"
            dur="2s"
            repeatCount="indefinite"/>
        </g>
        </g>
        {/* Outer ring */}
        <circle cx="60" cy="50" r="18" 
                fill="none" 
                stroke="#00ffff" 
                strokeWidth="1" 
                opacity="0.6" 
                filter="url(#neonGlow)"/>
    </g>
    
    {/* Right reel (spinning) */}
    <g>
        {/* Reel hub */}
        <circle cx="140" cy="50" r="8" fill="#333" stroke="#666" strokeWidth="1"/>
        {/* Spokes with spinning animation */}
        <g transform="translate(140, 50)">
        <g>
            <use href="#reelSpokes"/>
            {/* Spinning animation */}
            <animateTransform
            attributeName="transform"
            type="rotate"
            values="0;360"
            dur="2.3s"
            repeatCount="indefinite"/>
        </g>
        </g>
        {/* Outer ring */}
        <circle cx="140" cy="50" r="18" 
                fill="none" 
                stroke="#00ffff" 
                strokeWidth="1" 
                opacity="0.6" 
                filter="url(#neonGlow)"/>
    </g>
    
    {/* Tape between reels */}
    {/* <rect x="78" y="42" width="44" height="16" 
            fill="#654321" 
            opacity="0.8"/> */}
    
    {/* Label area */}
    <rect x="30" y="88" width="140" height="25" rx="2" ry="2" 
            fill="#fff" 
            opacity="0.1" 
        />

    {/* Label text */}
   <text x="100" y="105" 
        fontFamily="Arial, sans-serif" 
        fontSize="12" 
        fontWeight="900"
        textAnchor="middle" 
        fill="url(#textGradient)"
        // filter="url(#neonGlow)" - TODO can I add a glow to the text only when pink?
        opacity="0.9">{labelText || "Loading..."}</text>
    
    {/* Screw holes */}
    <circle cx="17" cy="18" r="3" fill="#0a0a0a" stroke="#333" strokeWidth="1"/>
    <circle cx="182" cy="18" r="3" fill="#0a0a0a" stroke="#333" strokeWidth="1"/>
    <circle cx="15" cy="65" r="3" fill="#0a0a0a" stroke="#333" strokeWidth="1"/>
    <circle cx="185" cy="65" r="3" fill="#0a0a0a" stroke="#333" strokeWidth="1"/>
    
    {/* Side tabs */}
    <rect x="5" y="45" width="5" height="20" fill="#333"/>
    <rect x="190" y="45" width="5" height="20" fill="#333"/>
    
    {/* Cassette holes for the player mechanism */}
    <rect x="85" y="12" width="8" height="6" rx="1" fill="#000"/>
    <rect x="107" y="12" width="8" height="6" rx="1" fill="#000"/>
    
    {/* Write protection tabs */}
    {/* <rect x="15" y="75" width="6" height="8" fill="#fd3777" opacity="0.8"/>
    <rect x="179" y="75" width="6" height="8" fill="#fd3777" opacity="0.8"/> */}

    </svg>
  )
}

export default CassetteSVG