import React from 'react'
import NeoButton from './neo-button';

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
        className="border-6 border-black p-6 flex flex-col justify-between" 
        style={
            {
                // boxShadow: "8px 8px 0px 0px #000000",
                background: props.backgroundColor || "white",
                color: props.textColor || "black",
            }
        }>
        <div>
        <h3 className="text-2xl font-black mb-2">{props.title}</h3>
            <div className="text-4xl font-black mb-6">
                {props.title === "ENTERPRISE" && props.price !== 'soon' && (
                    <span className='text-sm'>starting at </span>
                )}
                {props.price !== 'soon' && (
                <div>${props.price}<span className="text-xl">/{props.pricePeriod}</span></div>
                )
                }
            </div>
        </div>
        <ul className="mb-6">
        {props.features?.map((feature, index) => (
        <li key={index} className="mb-2 flex items-start">
            <span className="mr-2 font-bold">✓</span> {feature}
        </li>
        ))}
        </ul>
        <NeoButton
            label={props.buttonText}
        />
    </div>
  )
}

export default NeoPricingCard