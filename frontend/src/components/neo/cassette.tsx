import React, { useEffect, useState } from 'react'
import SynthwaveVolumeVisualizer from '../recording/synthwave-volume-visualizer'

type Props = {
    labelText?: string
    width?: number | string
    height?: number | string
    className?: string
    style?: React.CSSProperties
    isRecording?: boolean
    paused?: boolean
    volumeLevel?: number // Volume level from 0 to 255
}

const CassetteSVG = ({ 
    labelText = 'Loading...', 
    width = 200, 
    height = 130, 
    isRecording = false,
    paused = false,
    className = '',
    style = {},
    volumeLevel = 0
}: Props) => {
    // Simulate volume changes for demo (replace with your actual volumeLevel prop)
//   const [volumeLevel, setVolumeLevel] = useState(0); // Demo volume level (0-255)
  
//   useEffect(() => {
//     const interval = setInterval(() => {
//       setVolumeLevel(Math.random() * 255);
//     }, 100);
//     return () => clearInterval(interval);
//   }, []);

// Generate stars once and keep them consistent
  const [stars] = useState(() => 
    Array.from({ length: 50 }, (_, i) => ({
      id: i,
      cx: randomNumberBetween(22, 175),
      cy: randomNumberBetween(22, 75),
      baseOpacity: 0.5 + Math.random() * 0.5,
      animationDuration: 2 + Math.random() * 3
    }))
  );

// Normalize volume level to percentage
  const volumePercent = (volumeLevel / 255) * 100;
  
  // Create dynamic values based on volume
  const glowIntensity = volumePercent * 2;
  const waveAmplitude = (volumePercent / 100) * 40;
  const gridOpacity = 0.3 + (volumePercent / 100) * 0.4;
  const sunScale = 0.8 + (volumePercent / 100) * 0.4;

// Generate grid lines
  const gridLines = [];
  for (let i = 0; i <= 8; i++) {
    if (i <= 1 ) continue; // Skip the first line
    gridLines.push(
      <line
        key={`vertical-${i}`}
        x1={i * 20}
        y1="20"
        x2={i * 20}
        y2="80"
        stroke="#ff00ff"
        strokeWidth="1"
        opacity={gridOpacity}
      />
    );
  }
  for (let i = 0; i <= 3; i++) {
    if (i <= 1) continue; // Skip the first line
    gridLines.push(
      <line
        key={`horizontal-${i}`}
        x1="20"
        y1={i * 20}
        x2="180"
        y2={i * 20}
        stroke="#ff00ff"
        strokeWidth="1"
        opacity={gridOpacity}
      />
    );
  }
  
  // Generate volume bars
  const volumeBars = [];
  for (let i = 0; i < 13; i++) {
    const barHeight = Math.max(4, (Math.random() * ((isRecording && !paused) ? volumePercent : 1) * 0.6));
    volumeBars.push(
      <rect
        key={`bar-${i}`}
        x={23 + i * 12}
        y={79 - barHeight}
        width="10"
        height={barHeight}
        fill={`url(#barGradient-${i})`}
        opacity="0.9"
      />
    );
  }

    function randomNumberBetween(low: number, high: number) {
        return Math.floor(Math.random() * (high - low + 1)) + low;
    }

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

        {/* Rainbow gradient for the cassette reels background */}
        {/* <linearGradient id="reelLabel" x1="0%" y1="0%" x2="0%" y2="100%">
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
        </linearGradient> */}
        
        
        {/* Gradient for the label */}
        <linearGradient id="labelGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#5d1d91" stopOpacity="0.4"/>
        <stop offset="50%" stopColor="#fd3777" stopOpacity="0.8"/>
        <stop offset="100%" stopColor="#5d1d91" stopOpacity="0.4"/>
        </linearGradient>

        {/* Animated gradient for the text */}
        <linearGradient id="textGradient" x1="0%" y1="0%" x2="200%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3"/>
          <stop offset="40%" stopColor="#ffffff" stopOpacity="0.3"/>
          <stop offset="50%" stopColor="#fd3777" stopOpacity="1"/>
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.3"/>
          
          {isRecording && (
            <>
              <animate attributeName="x1" 
                      values="-200%;0%;200%" 
                      dur="2s" 
                      repeatCount="indefinite"/>
              <animate attributeName="x2" 
                      values="0%;200%;400%" 
                      dur="2s" 
                      repeatCount="indefinite"/>
            </>
          )}
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

        {/* Volume Visualizer */}
        {/* Gradient definitions */}
          <linearGradient id="skyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#000428" />
            <stop offset="50%" stopColor="#004e92" />
            <stop offset="100%" stopColor="#ff0080" />
          </linearGradient>
          
          <radialGradient id="sunGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffff00" stopOpacity="1" />
            <stop offset="70%" stopColor="#ff8000" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ff0080" stopOpacity="0.6" />
          </radialGradient>
          
          {/* Dynamic bar gradients */}
          {Array.from({ length: 16 }, (_, i) => (
            <linearGradient key={i} id={`barGradient-${i}`} x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#ff0080" />
              <stop offset="50%" stopColor="#00ffff" />
              <stop offset="100%" stopColor="#ffff00" />
            </linearGradient>
          ))}
          
          {/* Glow filters */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge> 
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          
          <filter id="sunGlow">
            <feGaussianBlur stdDeviation={glowIntensity / 10} result="coloredBlur"/>
            <feMerge> 
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
    </defs>
    
    {/* SVG Visuals */}
    {/* Cassette body */}
    <rect x="10" y="10" width="180" height="110" rx="8" ry="8" 
            fill="url(#bodyGradient)" 
            stroke="#333" 
            strokeWidth="2"/>
    
    {/* Top section with reels */}
    <g>
        <rect x="20" y="20" width="160" height="60" rx="4" ry="4" 
            fill="url(#skyGradient)" 
            stroke="#444" 
            strokeWidth="1"/>

        {/* Stars */}
        {stars.map((star) => (
          <circle
            key={`star-${star.id}`}
            cx={star.cx}
            cy={star.cy}
            r="1"
            fill="white"
            opacity={star.baseOpacity}
          >
            {isRecording && (
            <animate
              attributeName="opacity"
              values={`${star.baseOpacity * 0.3};${star.baseOpacity};${star.baseOpacity * 0.3}`}
              dur={`${star.animationDuration}s`}
              repeatCount="indefinite"
            />
            )}
          </circle>
        ))}

        {/* Grid floor */}
        {/* <g opacity={gridOpacity} filter="url(#glow)">
          {gridLines}
        </g> */}
        
        
        {/* Volume bars */}
        <g>
          {isRecording && volumeBars}
        </g>
    
    </g>
    
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
            {isRecording && !paused && (
                <animateTransform
                attributeName="transform"
                type="rotate"
                values="0;360"
                dur="2s"
                repeatCount="indefinite"/>
            )}
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
            {isRecording && !paused && (
                <animateTransform
                attributeName="transform"
                type="rotate"
                values="0;360"
                dur="2.3s"
                repeatCount="indefinite"/>
            )}
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
      font-family="Arial, sans-serif"
      font-size="12"
      font-weight="900"
      text-anchor="middle"
      fill="#333333"
      opacity="0.2">{labelText}</text>
    
    <text x="100" y="105"
      font-family="Arial, sans-serif"
      font-size="12"
      font-weight="900"
      text-anchor="middle"
      fill="url(#textGradient)">{labelText}</text>
    
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