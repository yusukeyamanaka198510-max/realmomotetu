import type { ButtonHTMLAttributes } from "react";

type GameButtonVariant = "primary" | "secondary" | "danger" | "success" | "destination" | "dice" | "card";

const VARIANT_CLASS: Record<GameButtonVariant, string> = {
  primary: "bg-gradient-to-b from-game-skyblue to-game-blue text-white border-blue-800",
  secondary: "bg-gradient-to-b from-zinc-100 to-zinc-300 text-zinc-800 border-zinc-400 dark:from-zinc-600 dark:to-zinc-800 dark:text-zinc-100 dark:border-zinc-900",
  danger: "bg-gradient-to-b from-red-400 to-game-red text-white border-red-800",
  success: "bg-gradient-to-b from-emerald-400 to-game-green text-white border-emerald-800",
  destination: "bg-gradient-to-b from-amber-300 to-game-gold text-amber-950 border-amber-700",
  dice: "bg-gradient-to-b from-game-pink to-fuchsia-600 text-white border-fuchsia-900",
  card: "bg-gradient-to-b from-purple-400 to-game-purple text-white border-purple-900",
};

export function GameButton({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: {
  variant?: GameButtonVariant;
  size?: "md" | "lg";
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizeClass = size === "lg" ? "px-8 py-4 text-lg" : "px-5 py-3 text-base";
  return (
    <button
      className={`anim-press relative inline-flex items-center justify-center gap-1.5 rounded-full border-b-4 font-bold shadow-[var(--game-shadow-sm)] transition-transform active:translate-y-0.5 active:shadow-none disabled:opacity-40 disabled:active:translate-y-0 ${sizeClass} ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      <span className="pointer-events-none absolute inset-x-2 top-1 h-1/3 rounded-full bg-white/30 blur-[2px]" aria-hidden="true" />
      <span className="relative">{children}</span>
    </button>
  );
}
