import React from 'react'

type Props = {
    // Define any props you want to pass to the button here
    onClick?: () => void;
    label?: string;
    backgroundColor?: string;
    textColor?: string;
    children?: React.ReactNode;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    selected?: boolean 
}

const NeoButton = (props: Props) => {
  return (
    <button 
        type={props.type || "button"}
        disabled={props.disabled}
        className={`disabled:bg-gray-400 disabled:text-gray-500 font-bold 
          text-lg py-3 px-6 min-h-16 uppercase tracking-wider bg-white 
          text-black border-4 border-black relative ${props.backgroundColor || "bg-white"} ${props.textColor || "text-black"}
          ${props.disabled ? "cursor-not-allowed" : "cursor-pointer"}
          `} 
        style={{
            boxShadow: "8px 8px 0px 0px #000000",
            transition: "transform 0.1s, box-shadow 0.1s",
            transform: `${props.selected ? "translate(4px, 4px)" : "translate(0px, 0px)"}`,
            boxShadow: `${props.selected ? "4px 4px 0px 0px #000000" : "8px 8px 0px 0px #000000"}`,
        }}
        onClick={props.onClick}
        onMouseDown={(e) => {
          if (props.selected) return; // Prevents action if selected
          e.currentTarget.style.transform = "translate(4px, 4px)";
          e.currentTarget.style.boxShadow = "4px 4px 0px 0px #000000";
        }}
        onMouseUp={(e) => {
          if (props.selected) return; // Prevents action if selected
          e.currentTarget.style.transform = "translate(0px, 0px)";
          e.currentTarget.style.boxShadow = "8px 8px 0px 0px #000000";
        }}
        onMouseLeave={(e) => {
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