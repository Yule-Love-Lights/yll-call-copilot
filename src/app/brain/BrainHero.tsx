// The /brain hero: three glowing lens nodes (Market, Leads, Coaching) linked
// to a central "The Brain" hub — built from scratch in our own brand family
// (evergreen surface, gold glow, thin connecting lines), not copied from any
// reference tool. Pure inline SVG + Tailwind so no globals.css edit is
// needed (this PR only touches src/app/brain/*, src/app/api/brain/*,
// src/lib/brain/*, and CoachNav.tsx).
//
// Motion: only the soft glow rings behind each node pulse
// (motion-safe:animate-pulse — Tailwind's own prefers-reduced-motion gate,
// same mechanism CoachNav's gold count badge and globals.css's
// coach-shimmer keyframe both respect), and only if the visitor hasn't
// asked for reduced motion. Nothing else in this SVG moves.

type NodeSpec = { key: string; label: string; x: number; y: number };

const HUB = { x: 300, y: 150 };
const NODES: NodeSpec[] = [
  { key: 'leads', label: 'Leads', x: 300, y: 42 },
  { key: 'market', label: 'Market', x: 202, y: 228 },
  { key: 'coaching', label: 'Coaching', x: 398, y: 228 },
];

const NODE_R = 40;
const HUB_R = 52;

export default function BrainHero() {
  return (
    <svg
      viewBox="0 0 600 300"
      className="mx-auto w-full max-w-2xl"
      role="img"
      aria-label="The brain: Market, Leads, and Coaching knowledge feeding one central intelligence"
    >
      <defs>
        <radialGradient id="brain-hub-fill" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="var(--brand-gold-bright)" />
          <stop offset="100%" stopColor="var(--brand-gold-deep)" />
        </radialGradient>
        <radialGradient id="brain-node-fill" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="var(--brand-evergreen-3)" />
          <stop offset="100%" stopColor="var(--brand-evergreen-2)" />
        </radialGradient>
      </defs>

      {/* Connecting lines, drawn first so nodes sit on top. */}
      {NODES.map(n => (
        <line
          key={`line-${n.key}`}
          x1={HUB.x}
          y1={HUB.y}
          x2={n.x}
          y2={n.y}
          stroke="var(--brand-gold)"
          strokeWidth={1.5}
          strokeOpacity={0.45}
        />
      ))}

      {/* Outer lens nodes: a soft pulsing glow ring behind a solid node. */}
      {NODES.map(n => (
        <g key={n.key}>
          <circle
            cx={n.x}
            cy={n.y}
            r={NODE_R + 10}
            fill="none"
            stroke="var(--brand-gold)"
            strokeOpacity={0.35}
            strokeWidth={6}
            className="motion-safe:animate-pulse"
          />
          <circle cx={n.x} cy={n.y} r={NODE_R} fill="url(#brain-node-fill)" stroke="var(--brand-gold)" strokeOpacity={0.55} strokeWidth={1.5} />
          <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize={13} fontWeight={800} fill="var(--brand-cream)">
            {n.label[0]}
          </text>
          <text x={n.x} y={n.y + NODE_R + 22} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--op-text-2)">
            {n.label}
          </text>
        </g>
      ))}

      {/* Central hub, drawn last so its glow sits above the connecting lines. */}
      <circle cx={HUB.x} cy={HUB.y} r={HUB_R + 12} fill="none" stroke="var(--brand-gold)" strokeOpacity={0.3} strokeWidth={7} className="motion-safe:animate-pulse" />
      <circle cx={HUB.x} cy={HUB.y} r={HUB_R} fill="url(#brain-hub-fill)" stroke="var(--brand-gold-bright)" strokeWidth={1.5} />
      <text x={HUB.x} y={HUB.y - 3} textAnchor="middle" fontSize={12.5} fontWeight={800} fill="var(--brand-evergreen)">
        The
      </text>
      <text x={HUB.x} y={HUB.y + 15} textAnchor="middle" fontSize={12.5} fontWeight={800} fill="var(--brand-evergreen)">
        Brain
      </text>
    </svg>
  );
}
