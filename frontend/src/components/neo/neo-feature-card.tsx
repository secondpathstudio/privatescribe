import { Card } from '../ui/card'

type Props = {
    emoji: string,
    title: string,
    description: string,
    style: object
}

const NeoFeatureCard = (props: Props) => {
  return (
    <Card className="border-6 p-6" style={{
        ...props.style
    }}>
        <div className="flex items-center mb-4">
        <div className="mr-4 text-3xl">{props.emoji}</div>
        <h3 className="text-2xl font-black">{props.title}</h3>
        </div>
        <p>{props.description}</p>
    </Card>
  )
}

export default NeoFeatureCard