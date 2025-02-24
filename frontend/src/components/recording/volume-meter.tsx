type Props = {
    volumeLevel: number
}

const VolumeMeter = (props: Props) => {
  return (
    <div style={{
        width: "100%",
        height: "10px",
        background: "gray",
        marginTop: "10px",
        marginBottom: "10px",
    }}>
        <div style={{
            width: `${(props.volumeLevel / 255) * 100}%`, 
            height: "100%", 
            background: "green",
            transition: "width 0.1s ease-out"
        }} />
    </div>
  )
}

export default VolumeMeter