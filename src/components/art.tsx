import { useId } from 'react';
export function Mark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="30"
      height="30"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path d="M5 5h22v22H5z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 5v22M5 16h22" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M16 16c-9-1-10-9-5-9 4 0 5 9 5 9Zm0 0c1-9 9-10 9-5 0 4-9 5-9 5Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}
export function GiftArt({ compact = false }: { compact?: boolean }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      className={`gift-art ${compact ? 'compact' : ''}`}
      viewBox="0 0 520 420"
      role="img"
      aria-label="An original illustration of a wrapped gift, a blue ribbon, a note, and a leafy sprig"
    >
      <defs>
        <pattern
          id={`${uid}-stripe`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(22)"
        >
          <path d="M0 0v8" stroke="#e3d9bf" strokeWidth="2" />
        </pattern>
        <filter id={`${uid}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="14" stdDeviation="13" floodColor="#6f7b84" floodOpacity=".13" />
        </filter>
      </defs>
      <ellipse cx="273" cy="216" rx="204" ry="169" fill="#E7EDEB" />
      <path
        d="M53 246c-16-69 28-156 111-176M356 55c63 25 103 76 115 134"
        fill="none"
        stroke="#BFCAC6"
        strokeWidth="1.2"
        strokeDasharray="4 6"
      />
      <g transform="rotate(-10 255 228)" filter={`url(#${uid}-shadow)`}>
        <rect x="124" y="96" width="245" height="267" rx="3" fill="#E5DCC6" />
        <path d="m124 96 24 15h198l23-15M124 363l24-20h198l23 20" stroke="#d0c5ab" fill="none" />
        <rect x="125" y="96" width="244" height="267" rx="3" fill={`url(#${uid}-stripe)`} />
        <rect x="223" y="96" width="42" height="267" fill="#2454D6" />
        <path d="M228 96v267M259 96v267" stroke="#9eb3f0" strokeWidth="1" />
        <rect x="124" y="195" width="245" height="40" fill="#2454D6" />
        <path d="M124 201h245M124 229h245" stroke="#9eb3f0" strokeWidth="1" />
        <path
          d="M246 212c-99-23-79-87-43-65 19 12 43 65 43 65Z"
          fill="#3868E5"
          stroke="#1C43AB"
          strokeWidth="2"
        />
        <path
          d="M246 212c68-79 112-35 66-15-26 11-66 15-66 15Z"
          fill="#4976e7"
          stroke="#1C43AB"
          strokeWidth="2"
        />
        <path d="m246 211-34 78 25-8 11 20 16-84" fill="#3766dd" />
        <path d="m250 209 64 62-3-25 24 1-66-40" fill="#3766dd" />
        <ellipse cx="248" cy="213" rx="16" ry="12" fill="#1845BC" />
      </g>
      <g transform="rotate(10 391 289)" filter={`url(#${uid}-shadow)`}>
        <rect x="296" y="257" width="170" height="108" rx="3" fill="#FFFDF7" />
        <rect x="303" y="264" width="156" height="94" rx="1" fill="none" stroke="#DCDDD4" />
        <text
          x="381"
          y="291"
          textAnchor="middle"
          fontFamily="var(--font-serif), Georgia, serif"
          fontSize="15"
          fill="#354242"
        >
          A little something,
        </text>
        <text
          x="381"
          y="313"
          textAnchor="middle"
          fontFamily="var(--font-serif), Georgia, serif"
          fontStyle="italic"
          fontSize="16"
          fill="#354242"
        >
          just for you.
        </text>
        <path
          d="M370 333c4-10 12-3 10 2-2 5-10 9-10 9s-9-6-9-11c0-7 8-8 9 0"
          transform="translate(11 -1) scale(.9)"
          fill="#2454D6"
        />
      </g>
      <g stroke="#617B60" strokeWidth="2.2" fill="#789175">
        <path d="M117 341c-9-62-3-103 24-147" fill="none" />
        <path
          d="M122 248c-36 0-39-27-38-36 26 4 41 15 38 36ZM119 264c26-8 41-4 47 3-21 19-39 20-47-3ZM115 291c-28-3-38-21-35-37 23 6 36 18 35 37ZM130 227c26-4 35-18 34-34-22 6-33 17-34 34Z"
          stroke="none"
        />
      </g>
      <circle cx="412" cy="95" r="35" fill="#F9F7EF" stroke="#D8DFD8" />
      <path d="m401 95 7 7 15-16" fill="none" stroke="#2454D6" strokeWidth="2" />
      <path d="M50 120h10M55 115v10M441 215h12M447 209v12" stroke="#7e9291" strokeWidth="1.3" />
      <circle cx="83" cy="303" r="3" fill="#b5c0b7" />
      <circle cx="380" cy="46" r="3" fill="#b5c0b7" />
    </svg>
  );
}
export function ContextArt({ kind }: { kind: 'personal' | 'gift' }) {
  return (
    <div className={`context-art context-art-${kind}`} aria-hidden="true">
      {kind === 'personal' ? (
        <>
          <div className="art-sun" />
          <div className="art-book art-book-one">
            <span>
              small
              <br />
              wonders
            </span>
            <i />
          </div>
          <div className="art-book art-book-two">
            <span>
              the art
              <br />
              of noticing
            </span>
            <i />
          </div>
          <div className="art-ticket">
            A FILM
            <br />
            <b>TONIGHT</b>
            <span>ADMIT ONE</span>
          </div>
          <div className="art-stem">✳</div>
        </>
      ) : (
        <>
          <div className="art-gift">
            <div />
            <span />
          </div>
          <div className="art-envelope">
            <span>
              with a<br />
              little thought
            </span>
          </div>
          <div className="art-small-star">✳</div>
        </>
      )}
    </div>
  );
}
export function ReferenceArt({ id }: { id: string }) {
  const variants: Record<string, string> = {
    'ref-forest': 'forest',
    'ref-everyday': 'days',
    'ref-future': 'arrival',
    'ref-studio': 'studio',
    'ref-city': 'city',
    'ref-community': 'community',
  };
  return (
    <div className={`reference-art ref-${variants[id] ?? 'studio'}`} aria-hidden="true">
      <span />
      {id === 'ref-forest' ? (
        <>
          <b>
            BRAIDING
            <br />
            SWEETGRASS
          </b>
          <i>✧</i>
        </>
      ) : id === 'ref-everyday' ? (
        <b>
          PERFECT
          <br />
          DAYS
        </b>
      ) : id === 'ref-future' ? (
        <b>A R R I V A L</b>
      ) : id === 'ref-studio' ? (
        <b>
          AGNES
          <br />
          MARTIN
        </b>
      ) : id === 'ref-city' ? (
        <b>barbican</b>
      ) : id === 'ref-community' ? (
        <b>
          A MAN
          <br />
          CALLED OVE
        </b>
      ) : (
        <b>✳</b>
      )}
    </div>
  );
}
