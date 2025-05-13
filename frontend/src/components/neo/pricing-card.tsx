import React from 'react'

type Props = {
    title: string;
    price: string;
    pricePeriod: string;
    features: string[];
    buttonText: string;
    onClick?: () => void;
    backgroundColor?: string;
    textColor?: string;
    isSelected?: boolean;
    isDisabled?: boolean;
    isLoading?: boolean;
    isFree?: boolean;
    isTrial?: boolean;
}

const NeoPricingCard = (props: Props) => {
  return (
    <div 
        className="border-4 border-black p-6 flex flex-col justify-between" 
        style={
            {
                boxShadow: "8px 8px 0px 0px #000000",
                background: props.backgroundColor || "white",
                color: props.textColor || "black",
            }
        }>
        <div>
        <h3 className="text-2xl font-black mb-2">{props.title}</h3>
            <div className="text-4xl font-black mb-6">
                {props.title === "ENTERPRISE" && (
                    <span className='text-sm'>starting at </span>
                )}
                ${props.price}<span className="text-xl">/{props.pricePeriod}</span>
            </div>
        </div>
        <ul className="mb-6">
        {props.features?.map((feature, index) => (
        <li key={index} className="mb-2 flex items-start">
            <span className="mr-2 font-bold">✓</span> {feature}
        </li>
        ))}
        </ul>
        <button 
        className="cursor-pointer font-bold text-lg py-3 px-6 uppercase tracking-wider bg-white text-black border-4 border-black w-full relative" 
        style={{
            boxShadow: "8px 8px 0px 0px #000000",
            transition: "transform 0.1s, box-shadow 0.1s"
            }}
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
        {props.buttonText}
        </button>
    </div>
  )
}

export default NeoPricingCard