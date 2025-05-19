import React, { useState, useEffect } from 'react';

type Props = {
  volumeLevel: number; // Volume level from 0 to 255
};

const SynthwaveVolumeVisualizer = ({volumeLevel}: Props) => {
  // Simulate volume changes for demo (replace with your actual volumeLevel prop)
  // const [volumeLevel, setVolumeLevel] = useState(volumeLevel); // Demo volume level (0-255)
  
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     setVolumeLevel(Math.random() * 255);
  //   }, 100);
  //   return () => clearInterval(interval);
  // }, []);

  // Normalize volume level to percentage
  const volumePercent = (volumeLevel / 255) * 100;
  
  // Create dynamic values based on volume
  const glowIntensity = volumePercent * 2;
  const waveAmplitude = (volumePercent / 100) * 40;
  const gridOpacity = 0.3 + (volumePercent / 100) * 0.4;
  const sunScale = 0.8 + (volumePercent / 100) * 0.4;
  
  // Generate grid lines
  const gridLines = [];
  for (let i = 0; i <= 20; i++) {
    gridLines.push(
      <line
        key={`vertical-${i}`}
        x1={i * 40}
        y1="0"
        x2={i * 40}
        y2="600"
        stroke="#ff00ff"
        strokeWidth="1"
        opacity={gridOpacity}
      />
    );
  }
  for (let i = 0; i <= 15; i++) {
    gridLines.push(
      <line
        key={`horizontal-${i}`}
        x1="0"
        y1={i * 40}
        x2="800"
        y2={i * 40}
        stroke="#ff00ff"
        strokeWidth="1"
        opacity={gridOpacity}
      />
    );
  }
  
  // Generate volume bars
  const volumeBars = [];
  for (let i = 0; i < 16; i++) {
    const barHeight = Math.max(10, (Math.random() * volumePercent * 3));
    volumeBars.push(
      <rect
        key={`bar-${i}`}
        x={100 + i * 40}
        y={500 - barHeight}
        width="30"
        height={barHeight}
        fill={`url(#barGradient-${i})`}
        opacity="0.9"
      />
    );
  }

  return (
    <div className="w-full h-96 bg-black rounded-lg overflow-hidden">
      <svg viewBox="0 0 800 600" className="w-full h-full">
        <defs>
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
        
        {/* Background */}
        <rect width="800" height="600" fill="url(#skyGradient)" />
        
        {/* Stars */}
        {Array.from({ length: 50 }, (_, i) => (
          <circle
            key={`star-${i}`}
            cx={Math.random() * 800}
            cy={Math.random() * 300}
            r="1"
            fill="white"
            opacity={0.5 + Math.random() * 0.5}
          >
            <animate
              attributeName="opacity"
              values="0.5;1;0.5"
              dur={`${2 + Math.random() * 3}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
        
        {/* Grid floor */}
        <g opacity={gridOpacity} filter="url(#glow)">
          {gridLines}
        </g>
        
        {/* Sun */}
        <circle
          cx="400"
          cy="250"
          r="80"
          fill="url(#sunGradient)"
          filter="url(#sunGlow)"
          transform={`scale(${sunScale})`}
          transformOrigin="400 250"
        />
        
        {/* Sun rays */}
        {Array.from({ length: 8 }, (_, i) => (
          <line
            key={`ray-${i}`}
            x1="400"
            y1="250"
            x2={400 + Math.cos(i * Math.PI / 4) * 120}
            y2={250 + Math.sin(i * Math.PI / 4) * 120}
            stroke="#ffff00"
            strokeWidth="2"
            opacity={0.6 + (volumePercent / 100) * 0.4}
            filter="url(#glow)"
          />
        ))}
        
        {/* Volume bars */}
        <g>
          {volumeBars}
        </g>
        
        {/* Waveform */}
        <path
          d={`M 50 400 Q 200 ${400 - waveAmplitude} 350 400 T 650 400 T 750 400`}
          fill="none"
          stroke="#00ffff"
          strokeWidth="3"
          filter="url(#glow)"
          opacity="0.8"
        >
          <animate
            attributeName="d"
            values={`M 50 400 Q 200 ${400 - waveAmplitude} 350 400 T 650 400 T 750 400;M 50 400 Q 200 ${400 + waveAmplitude} 350 400 T 650 400 T 750 400;M 50 400 Q 200 ${400 - waveAmplitude} 350 400 T 650 400 T 750 400`}
            dur="2s"
            repeatCount="indefinite"
          />
        </path>
        
        {/* Volume level indicator */}
        <text
          x="50"
          y="50"
          fill="#00ffff"
          fontSize="24"
          fontFamily="monospace"
          filter="url(#glow)"
        >
          VOL: {Math.round(volumePercent)}%
        </text>
        
        {/* Synthwave text */}
        <text
          x="400"
          y="550"
          fill="#ff0080"
          fontSize="48"
          fontFamily="monospace"
          textAnchor="middle"
          filter="url(#glow)"
          opacity={0.8 + (volumePercent / 100) * 0.2}
        >
          SYNTHWAVE
        </text>
      </svg>
    </div>
  );
};

export default SynthwaveVolumeVisualizer;