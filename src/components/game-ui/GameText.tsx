import type { ReactNode } from "react";

type GameTextVariant = "title" | "event" | "coin-positive" | "coin-negative" | "station" | "info";

const VARIANT_CLASS: Record<GameTextVariant, string> = {
  title: "game-text-title text-3xl sm:text-4xl",
  event: "game-text-event text-xl sm:text-2xl",
  "coin-positive": "font-black text-game-gold [text-shadow:0_1px_0_rgba(0,0,0,0.15)]",
  "coin-negative": "font-black text-game-red [text-shadow:0_1px_0_rgba(0,0,0,0.15)]",
  station: "font-bold text-[var(--foreground)]",
  info: "font-medium text-[var(--foreground)]",
};

export function GameText({
  variant,
  as: Tag = "span",
  className = "",
  children,
}: {
  variant: GameTextVariant;
  as?: "span" | "p" | "h1" | "h2";
  className?: string;
  children: ReactNode;
}) {
  return <Tag className={`${VARIANT_CLASS[variant]} ${className}`}>{children}</Tag>;
}
