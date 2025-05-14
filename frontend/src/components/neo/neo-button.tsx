import React from 'react'

type Props = {
    // Define any props you want to pass to the button here
    onClick?: () => void;
    label?: string;
    backgroundColor?: string;
    textColor?: string;
    children?: React.ReactNode;
    type?: "button" | "submit" | "reset";
}

const NeoButton = (props: Props) => {
  return (
    <button 
        type={props.type || "button"}
        className={`cursor-pointer font-bold text-lg py-3 px-6 min-h-16 uppercase tracking-wider bg-white text-black border-4 border-black relative`} 
        style={{
            boxShadow: "8px 8px 0px 0px #000000",
            transition: "transform 0.1s, box-shadow 0.1s",
            background: props.backgroundColor || "#ffffff",
            color: props.textColor || "#000000",
        }}
        onClick={props.onClick}
        onMouseDown={(e) => {
        e.currentTarget.style.transform = "translate(4px, 4px)";
        e.currentTarget.style.boxShadow = "4px 4px 0px 0px #000000";
        }}
        onMouseUp={(e) => {
        e.currentTarget.style.transform = "translate(0px, 0px)";
        e.currentTarget.style.boxShadow = "8px 8px 0px 0px #000000";
        }}
        onMouseLeave={(e) => {
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