import React from 'react'

type Props = {
    isRotating: boolean
}

const PirateWheel = ({ isRotating }: Props) => {


  return (
<svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 500 500"
    width={150}
    height={150}
    className={isRotating ? 'animate-spin' : ''}>
  {/* <!-- Background (transparent) --> */}
  
  {/* <!-- Outer rim with double ring design --> */}
  <circle cx="250" cy="250" r="180" fill="none" stroke="#b68d40" stroke-width="25" />
  <circle cx="250" cy="250" r="165" fill="none" stroke="#d4a759" stroke-width="5" />
  <circle cx="250" cy="250" r="195" fill="none" stroke="#d4a759" stroke-width="5" />
  
  {/* <!-- Rim details - small dots around the rim --> */}
  <g id="rim-details">
    {/* <!-- Generating dots programmatically for even distribution --> */}
    <circle cx="250" cy="70" r="3" fill="#8b5a2b" />
    <circle cx="250" cy="430" r="3" fill="#8b5a2b" />
    <circle cx="70" cy="250" r="3" fill="#8b5a2b" />
    <circle cx="430" cy="250" r="3" fill="#8b5a2b" />
    
    {/* <!-- More dots at regular intervals --> */}
    <circle cx="162" cy="101" r="3" fill="#8b5a2b" />
    <circle cx="101" cy="162" r="3" fill="#8b5a2b" />
    <circle cx="101" cy="338" r="3" fill="#8b5a2b" />
    <circle cx="162" cy="399" r="3" fill="#8b5a2b" />
    <circle cx="338" cy="399" r="3" fill="#8b5a2b" />
    <circle cx="399" cy="338" r="3" fill="#8b5a2b" />
    <circle cx="399" cy="162" r="3" fill="#8b5a2b" />
    <circle cx="338" cy="101" r="3" fill="#8b5a2b" />
    
    {/* <!-- More dots at 22.5 degree intervals --> */}
    <circle cx="186" cy="86" r="3" fill="#8b5a2b" />
    <circle cx="314" cy="86" r="3" fill="#8b5a2b" />
    <circle cx="86" cy="186" r="3" fill="#8b5a2b" />
    <circle cx="86" cy="314" r="3" fill="#8b5a2b" />
    <circle cx="186" cy="414" r="3" fill="#8b5a2b" />
    <circle cx="314" cy="414" r="3" fill="#8b5a2b" />
    <circle cx="414" cy="186" r="3" fill="#8b5a2b" />
    <circle cx="414" cy="314" r="3" fill="#8b5a2b" />
  </g>
  
  {/* <!-- Spokes - extend through and beyond the rim --> */}
  <g id="spokes">
    {/* <!-- Vertical spoke --> */}
    <g>
      {/* <!-- Main spoke shaft --> */}
      <path d="M245,55 L245,445 C245,450 255,450 255,445 L255,55 C255,50 245,50 245,55 Z" fill="#c9a063" />
      
      {/* <!-- Joint pieces where spokes meet the hub --> */}
      <rect x="243" y="206" width="14" height="14" rx="2" fill="#b68d40" />
      <rect x="243" y="280" width="14" height="14" rx="2" fill="#b68d40" />
    </g>
    
    {/* <!-- Horizontal spoke --> */}
    <g>
      <path d="M55,245 L445,245 C450,245 450,255 445,255 L55,255 C50,255 50,245 55,245 Z" fill="#c9a063" />
      
      {/* <!-- Joint pieces where spokes meet the hub --> */}
      <rect x="206" y="243" width="14" height="14" rx="2" fill="#b68d40" />
      <rect x="280" y="243" width="14" height="14" rx="2" fill="#b68d40" />
    </g>
    
    {/* <!-- Diagonal spokes at 45 degrees --> */}
    <g>
      {/* <!-- Top-left to bottom-right --> */}
      <g transform="rotate(45 250 250)">
        <path d="M245,55 L245,445 C245,450 255,450 255,445 L255,55 C255,50 245,50 245,55 Z" fill="#c9a063" />
        
        {/* <!-- Joint pieces where spokes meet the hub --> */}
        <rect x="243" y="206" width="14" height="14" rx="2" fill="#b68d40" />
        <rect x="243" y="280" width="14" height="14" rx="2" fill="#b68d40" />
      </g>
      
      {/* <!-- Top-right to bottom-left --> */}
      <g transform="rotate(-45 250 250)">
        <path d="M245,55 L245,445 C245,450 255,450 255,445 L255,55 C255,50 245,50 245,55 Z" fill="#c9a063" />
        
        {/* <!-- Joint pieces where spokes meet the hub --> */}
        <rect x="243" y="206" width="14" height="14" rx="2" fill="#b68d40" />
        <rect x="243" y="280" width="14" height="14" rx="2" fill="#b68d40" />
      </g>
    </g>
  </g>
  
  {/* <!-- Central hub with metallic cap --> */}
  <circle cx="250" cy="250" r="45" fill="#c9a063" stroke="#b68d40" stroke-width="2" />
  <circle cx="250" cy="250" r="35" fill="#d4a759" stroke="#b68d40" stroke-width="2" />
  <circle cx="250" cy="250" r="25" fill="#f4e1a5" stroke="#b68d40" stroke-width="1" />
  <circle cx="250" cy="250" r="5" fill="#c9a063" />
  
  {/* <!-- Handles at the end of each spoke - larger and beyond the rim --> */}
  <g id="handles">
    {/* <!-- Vertical handles --> */}
    <path d="M240,25 C235,25 230,30 230,40 C230,50 235,60 240,65 C245,70 255,70 260,65 C265,60 270,50 270,40 C270,30 265,25 260,25 C255,25 245,25 240,25 Z" fill="#c9a063" stroke="#b68d40" stroke-width="1" />
    <path d="M240,475 C235,475 230,470 230,460 C230,450 235,440 240,435 C245,430 255,430 260,435 C265,440 270,450 270,460 C270,470 265,475 260,475 C255,475 245,475 240,475 Z" fill="#c9a063" stroke="#b68d40" stroke-width="1" />
    
    {/* <!-- Horizontal handles --> */}
    <path d="M25,240 C25,235 30,230 40,230 C50,230 60,235 65,240 C70,245 70,255 65,260 C60,265 50,270 40,270 C30,270 25,265 25,260 C25,255 25,245 25,240 Z" fill="#c9a063" stroke="#b68d40" stroke-width="1" />
    <path d="M475,240 C475,235 470,230 460,230 C450,230 440,235 435,240 C430,245 430,255 435,260 C440,265 450,270 460,270 C470,270 475,265 475,260 C475,255 475,245 475,240 Z" fill="#c9a063" stroke="#b68d40" stroke-width="1" />
    
    {/* <!-- Diagonal handles --> */}
    <g transform="rotate(45 250 250)">
      <path d="M240,25 C235,25 230,30 230,40 C230,50 235,60 240,65 C245,70 255,70 260,65 C265,60 270,50 270,40 C270,30 265,25 260,25 C255,25 245,25 240,25 Z" fill="#c9a063" stroke="#b68d40" stroke-width="1" />
      <path d="M240,475 C235,475 230,470 230,460 C230,450 235,440 240,435 C245,430 255,430 260,435 C265,440 270,450 270,460 C270,470 265,475 260,475 C255,475 245,475 240,475 Z" fill="#c9a063" stroke="#b68d40" stroke-width="1" />
    </g>
    
    <g transform="rotate(-45 250 250)">
      <path d="M240,25 C235,25 230,30 230,40 C230,50 235,60 240,65 C245,70 255,70 260,65 C265,60 270,50 270,40 C270,30 265,25 260,25 C255,25 245,25 240,25 Z" fill="#c9a063" stroke="#b68d40" stroke-width="1" />
      <path d="M240,475 C235,475 230,470 230,460 C230,450 235,440 240,435 C245,430 255,430 260,435 C265,440 270,450 270,460 C270,470 265,475 260,475 C255,475 245,475 240,475 Z" fill="#c9a063" stroke="#b68d40" stroke-width="1" />
    </g>
  </g>
  
  {/* <!-- Joint details where spokes cross the rim --> */}
  <g id="spoke-rim-joints">
    <circle cx="250" cy="70" r="8" fill="#b68d40" />
    <circle cx="250" cy="430" r="8" fill="#b68d40" />
    <circle cx="70" cy="250" r="8" fill="#b68d40" />
    <circle cx="430" cy="250" r="8" fill="#b68d40" />
    
    <circle cx="126" cy="126" r="8" fill="#b68d40" transform="rotate(45 250 250)" />
    <circle cx="374" cy="126" r="8" fill="#b68d40" transform="rotate(45 250 250)" />
    <circle cx="126" cy="374" r="8" fill="#b68d40" transform="rotate(45 250 250)" />
    <circle cx="374" cy="374" r="8" fill="#b68d40" transform="rotate(45 250 250)" />
  </g>
  
  {/* <!-- Wood grain textures --> */}
  <g opacity="0.1">
    <path d="M245 70 Q250 72 255 70" stroke="#8b5a2b" stroke-width="1" fill="none" />
    <path d="M245 430 Q250 428 255 430" stroke="#8b5a2b" stroke-width="1" fill="none" />
    <path d="M70 245 Q72 250 70 255" stroke="#8b5a2b" stroke-width="1" fill="none" />
    <path d="M430 245 Q428 250 430 255" stroke="#8b5a2b" stroke-width="1" fill="none" />
    
    {/* <!-- Spoke grain --> */}
    <path d="M247 100 L247 200" stroke="#8b5a2b" stroke-width="0.5" fill="none" opacity="0.2" />
    <path d="M253 100 L253 200" stroke="#8b5a2b" stroke-width="0.5" fill="none" opacity="0.2" />
    <path d="M247 300 L247 400" stroke="#8b5a2b" stroke-width="0.5" fill="none" opacity="0.2" />
    <path d="M253 300 L253 400" stroke="#8b5a2b" stroke-width="0.5" fill="none" opacity="0.2" />
    
    <path d="M100 247 L200 247" stroke="#8b5a2b" stroke-width="0.5" fill="none" opacity="0.2" />
    <path d="M100 253 L200 253" stroke="#8b5a2b" stroke-width="0.5" fill="none" opacity="0.2" />
    <path d="M300 247 L400 247" stroke="#8b5a2b" stroke-width="0.5" fill="none" opacity="0.2" />
    <path d="M300 253 L400 253" stroke="#8b5a2b" stroke-width="0.5" fill="none" opacity="0.2" />
    
    {/* <!-- Central hub grain --> */}
    <ellipse cx="250" cy="240" rx="30" ry="5" fill="#8b5a2b" opacity="0.05" />
    <ellipse cx="250" cy="260" rx="30" ry="5" fill="#8b5a2b" opacity="0.05" />
  </g>
</svg>
  )
}

export default PirateWheel