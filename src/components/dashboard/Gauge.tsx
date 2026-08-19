type Props = {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
};

/** Semi-circular-ish arc gauge matching the SCADA reference. */
export function Gauge({ value, size = 108, stroke = 10, color = "var(--safe)", children }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sweep = 0.75; // 270deg arc
  const arc = c * sweep;
  const filled = arc * Math.min(1, Math.max(0, value / 100));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-[225deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="color-mix(in oklab, var(--cyan) 28%, transparent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          style={{ filter: `drop-shadow(0 0 6px color-mix(in oklab, ${color} 60%, transparent))` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
