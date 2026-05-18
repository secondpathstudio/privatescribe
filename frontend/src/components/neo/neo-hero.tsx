import { GithubIcon } from 'lucide-react'
import NeoLinkButton from './neo-link-button'
import NeoAnchorButton from './neo-a-button'

type Props = {}

const NeoHero = (props: Props) => {
  return (
    <section className="py-20 border-b-4 border-black" style={{
        background: "linear-gradient(to right, #2b0f54, #5d1d91, #fd3777)"
      }}>
        <div className="container mx-auto px-4">
          <div className="grid xl:grid-cols-2 grid-cols-1 gap-12 items-center text-center xl:text-left">
            <div>
              <h1 className="text-4xl md:text-7xl font-black text-white mb-6 leading-tight">
                AI NOTES THAT NEVER LEAVE YOUR DEVICE
              </h1>
              <p className="text-xl text-white mb-8">
                Built for clinicians, therapists, attorneys, and anyone whose conversations are too sensitive for the cloud. Record, transcribe, and format your notes — entirely on your own machine.
              </p>
              <div className="flex flex-wrap gap-2 mb-8 xl:justify-start justify-center">
                <div className="border-2 border-white text-white font-bold text-sm px-3 py-1 uppercase tracking-wider bg-black/30">
                  Works Offline
                </div>
                <div className="border-2 border-white text-white font-bold text-sm px-3 py-1 uppercase tracking-wider bg-black/30">
                  256-Bit Encrypted
                </div>
              </div>
              <div className="flex flex-wrap gap-4 xl:justify-start justify-center items-center">
                {(window.electron || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
                <NeoLinkButton route="/login" label="Try Free" backgroundColor='#fd3777' textColor="#ffffff" />
                }
                <NeoAnchorButton href="https://github.com/secondpathstudio/privatescribe" backgroundColor='#ffffff' textColor="#000000">
                  <GithubIcon />
                </NeoAnchorButton>
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black opacity-40"></div>
              <div className="w-full h-64 md:h-96 border-4 border-black" 
                style={{
                  background: "linear-gradient(to right, #fd3777, #ff9900, #ffff00)",
                  boxShadow: "12px 12px 0px 0px rgba(0,0,0,1)"
                }}>
                <div className="w-full h-full flex items-center justify-center overflow-clip">
                  <img src="/robot-shh.png" alt="Robot" className="translate-y-10" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
  )
}

export default NeoHero