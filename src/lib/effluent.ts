export type SensorKey = "ph" | "tds" | "turbidity" | "temperature" | "flow";
export type Level = "SAFE" | "WARNING" | "CRITICAL";

export type Reading = Record<SensorKey, number> & {
  id: number;
  t: number;
  time: string;
  risk: number;
  status: Level;
};

export const NORMAL: Record<SensorKey, number> = {
  ph: 7.2,
  tds: 430,
  turbidity: 18,
  temperature: 29,
  flow: 2.1,
};

export const CRITICAL_PRESET: Record<SensorKey, number> = {
  ph: 4.2,
  tds: 1800,
  turbidity: 150,
  temperature: 41,
  flow: 5.2,
};

/** Upper limits for the non-pH sensors: [warning, critical]. */
const LIMITS: Record<Exclude<SensorKey, "ph">, [number, number]> = {
  tds: [800, 1500],
  turbidity: [50, 100],
  temperature: [35, 40],
  flow: [3, 5],
};

export function levelOf(key: SensorKey, v: number): Level {
  if (key === "ph") {
    if (v >= 6.5 && v <= 8.5) return "SAFE";
    if (v >= 5.5 && v <= 9.5) return "WARNING";
    return "CRITICAL";
  }
  const [warn, crit] = LIMITS[key];
  if (v >= crit) return "CRITICAL";
  if (v >= warn) return "WARNING";
  return "SAFE";
}

/** 0-20 risk points contributed by a single sensor. */
function points(key: SensorKey, v: number): number {
  const level = levelOf(key, v);
  if (level === "CRITICAL") return 18.4;
  if (level === "WARNING") return 12;
  if (key === "ph") {
    const dev = Math.min(1, Math.abs(v - 7.5) / 1);
    return dev * 3;
  }
  const [warn] = LIMITS[key];
  return Math.min(1, Math.max(0, v / warn)) * 3;
}

export function riskScore(values: Record<SensorKey, number>): number {
  const total = (Object.keys(NORMAL) as SensorKey[]).reduce(
    (sum, k) => sum + points(k, values[k]),
    0,
  );
  return Math.round(Math.min(100, Math.max(0, total)));
}

export function overallStatus(values: Record<SensorKey, number>): Level {
  const levels = (Object.keys(NORMAL) as SensorKey[]).map((k) => levelOf(k, values[k]));
  if (levels.includes("CRITICAL")) return "CRITICAL";
  if (levels.includes("WARNING")) return "WARNING";
  return "SAFE";
}

export const decimals: Record<SensorKey, number> = {
  ph: 2,
  tds: 0,
  turbidity: 0,
  temperature: 1,
  flow: 1,
};

export function fmt(key: SensorKey, v: number): string {
  return v.toFixed(decimals[key]);
}

/** Random walk around a base value, clamped to a plausible band. */
export function drift(key: SensorKey, prev: number): number {
  const step: Record<SensorKey, number> = {
    ph: 0.08,
    tds: 22,
    turbidity: 2.5,
    temperature: 0.4,
    flow: 0.12,
  };
  const base = NORMAL[key];
  const pull = (base - prev) * 0.08;
  const next = prev + pull + (Math.random() - 0.5) * 2 * step[key];
  return +next.toFixed(3);
}
