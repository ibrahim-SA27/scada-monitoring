export type Series = { t: number; v: number }[];

function series(base: number, spread: number, n = 60, seed = 1): Series {
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return Array.from({ length: n }, (_, i) => ({
    t: i,
    v: +(base + (rand() - 0.5) * spread).toFixed(2),
  }));
}

export const sensors = [
  {
    key: "ph",
    label: "pH",
    value: "7.20",
    unit: "pH",
    status: "SAFE",
    thresholds: "Range: 6.5 - 8.5",
    color: "var(--ph)",
    data: series(7.2, 0.5, 60, 3),
  },
  {
    key: "tds",
    label: "TDS",
    value: "430",
    unit: "ppm",
    status: "SAFE",
    thresholds: "Warning: 800 ppm | Critical: 1500 ppm",
    color: "var(--tds)",
    data: series(430, 90, 60, 7),
  },
  {
    key: "turbidity",
    label: "Turbidity",
    value: "18",
    unit: "NTU",
    status: "SAFE",
    thresholds: "Warning: 50 NTU | Critical: 100 NTU",
    color: "var(--turbidity)",
    data: series(18, 8, 60, 11),
  },
  {
    key: "temperature",
    label: "Temperature",
    value: "29",
    unit: "°C",
    status: "SAFE",
    thresholds: "Warning: 35 °C | Critical: 40 °C",
    color: "var(--temperature)",
    data: series(29, 3, 60, 17),
  },
  {
    key: "flow",
    label: "Flow",
    value: "2.1",
    unit: "L/min",
    status: "SAFE",
    thresholds: "Warning: 3.0  | Critical: 5.0 L/min",
    color: "var(--flow)",
    data: series(2.1, 0.6, 60, 23),
  },
] as const;

export const trendData = Array.from({ length: 60 }, (_, i) => {
  const minute = 10 + Math.floor(i / 12);
  return {
    time: `03:${String(minute).padStart(2, "0")} PM`,
    idx: i,
    value: Math.round(430 + Math.sin(i / 3) * 45 + ((i * 37) % 60) - 30),
  };
});

export const riskBreakdown = [
  { label: "pH", status: "NORMAL" },
  { label: "TDS", status: "NORMAL" },
  { label: "Turbidity", status: "NORMAL" },
  { label: "Temperature", status: "NORMAL" },
  { label: "Flow", status: "NORMAL" },
];
