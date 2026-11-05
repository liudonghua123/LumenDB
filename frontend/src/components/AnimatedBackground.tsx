/** Pure SVG + CSS animated backdrop. No images, no emoji. */
export function AnimatedBackground() {
  return (
    <div className="bg-stage" aria-hidden>
      <div className="bg-grad" />
      <div className="bg-grid" />
      <div className="bg-blob blob-a" />
      <div className="bg-blob blob-b" />
      <div className="bg-blob blob-c" />
      <svg className="absolute inset-0 w-full h-full opacity-[.55]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lumenStroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity=".55" />
            <stop offset="100%" stopColor="rgb(34 211 238)" stopOpacity=".12" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#lumenStroke)" strokeWidth="1">
          <circle cx="14%" cy="72%" r="92">
            <animateTransform attributeName="transform" type="translate" values="0 0; 18 -26; 0 0" dur="16s" repeatCount="indefinite" />
            <animate attributeName="r" values="92;112;92" dur="16s" repeatCount="indefinite" />
          </circle>
          <circle cx="14%" cy="72%" r="140" strokeOpacity=".45">
            <animateTransform attributeName="transform" type="translate" values="0 0; -16 20; 0 0" dur="21s" repeatCount="indefinite" />
          </circle>
          <circle cx="88%" cy="24%" r="118" strokeOpacity=".5">
            <animateTransform attributeName="transform" type="translate" values="0 0; -22 -14; 0 0" dur="19s" repeatCount="indefinite" />
          </circle>
        </g>
        <g fill="rgb(99 102 241)" opacity=".3">
          <circle cx="22%" cy="18%" r="2.5">
            <animate attributeName="opacity" values=".15;.7;.15" dur="4.5s" repeatCount="indefinite" />
          </circle>
          <circle cx="76%" cy="66%" r="2.5">
            <animate attributeName="opacity" values=".7;.15;.7" dur="5.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="63%" cy="12%" r="2">
            <animate attributeName="opacity" values=".15;.6;.15" dur="6.4s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>
    </div>
  )
}
