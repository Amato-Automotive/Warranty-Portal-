import { brandLook } from "@/lib/brand";

/** The loading screen, in the store's brand when it is known (Autoform otherwise). */
const AutoformLoadingScreen = ({ brand }: { brand?: string | null }) => {
  const look = brandLook(brand);
  const letters = look.word.split("");

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-50 to-white flex items-center justify-center z-50">
      {/* Loader Logo Container */}
      <div className="flex items-center justify-center gap-3">
        {/* Icon with appear + pulse animation */}
        {look.key === "AF" && <img
          src="/autoform-icon.png"
          alt=""
          className="w-12 h-auto"
          style={{
            opacity: 0,
            animation: 'iconAppear 0.5s ease forwards, iconPulse 2s ease-in-out 0.5s infinite'
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />}

        {/* Animated Letters */}
        <div className="flex gap-[2px]">
          {letters.map((letter, index) => (
            <span
              key={index}
              className="text-3xl font-medium tracking-widest text-slate-900"
              style={{
                fontFamily: "'Roc Grotesk', sans-serif",
                opacity: 0,
                animation: 'letterAppear 0.4s ease forwards',
                animationDelay: `${0.3 + index * 0.08}s`
              }}
            >
              {letter}
            </span>
          ))}
        </div>
      </div>

      {/* CSS Keyframes */}
      <style>{`
        @keyframes iconAppear {
          0% { opacity: 0; transform: scale(0.5) rotate(-10deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        
        @keyframes iconPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        
        @keyframes letterAppear {
          0% { opacity: 0; transform: translateY(-20px) scale(0.5); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
};

export default AutoformLoadingScreen;
