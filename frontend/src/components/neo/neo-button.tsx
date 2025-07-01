import { prop } from '@mdxeditor/editor';
import React, { useEffect } from 'react'

type Props = {
    // Define any props you want to pass to the button here
    onClick?: ((e: any) => void) | ((e: any) => Promise<void>);
    label?: string;
    backgroundColor?: string;
    textColor?: string;
    children?: React.ReactNode;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    selected?: boolean;
    style?: React.CSSProperties;
    className?: string;
}

const NeoButton = (props: Props) => {

  useEffect(() => {
    // Ensure the button has the correct styles on mount
    if (props.selected) {
      const button = document.querySelector('.neo-button');
      if (button) {
        button.style.transform = "translate(4px, 4px)";
        button.style.boxShadow = "4px 4px 0px 0px #000000";
      }
    }
  }, [props.selected]);

  return (
    <button 
        id="neo-button"
        type={props.type || "button"}
        disabled={props.disabled}
        className={`disabled:bg-gray-400 disabled:text-gray-500 font-bold 
          text-lg py-3 px-6 min-h-16 uppercase tracking-wider bg-white 
          text-black border-4 border-black relative ${props.backgroundColor || "bg-white"} ${props.textColor || "text-black"}
          ${props.disabled ? "cursor-not-allowed" : "cursor-pointer"}
          ${props.className}`} 
        style={{
            transition: "transform 0.1s, box-shadow 0.1s",
            transform: `${props.selected ? "translate(4px, 4px)" : "translate(0px, 0px)"}`,
            boxShadow: `${props.selected ? "4px 4px 0px 0px #000000" : "8px 8px 0px 0px #000000"}`,
            ...props.style
        }}
        onClick={props.onClick}
        onPointerDown={(e) => {
          if (props.selected) return; // Prevents action if selected
          e.currentTarget.style.transform = "translate(4px, 4px)";
          e.currentTarget.style.boxShadow = "4px 4px 0px 0px #000000";
        }}
        onPointerUp={(e) => {
          if (props.selected) return; // Prevents action if selected
          e.currentTarget.style.transform = "translate(0px, 0px)";
          e.currentTarget.style.boxShadow = "8px 8px 0px 0px #000000";
        }}
        onPointerLeave={(e) => {
          if (props.selected) return; // Prevents action if selected
          e.currentTarget.style.transform = "translate(0px, 0px)";
          e.currentTarget.style.boxShadow = "8px 8px 0px 0px #000000";
        }}
    >
        {props.label}
        {props.children}
    </button>
  )
}

export default NeoButton