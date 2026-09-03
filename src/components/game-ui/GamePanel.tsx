import type { ReactNode } from "react";

export function GamePanel({
  title,
  icon,
  accent = "navy",
  className = "",
  children,
}: {
  title?: string;
  icon?: ReactNode;
  accent?: "navy" | "gold" | "green" | "red" | "purple";
  className?: string;
  children: ReactNode;
}) {
  const accentClass: Record<string, string> = {
    navy: "border-l-game-navy",
    gold: "border-l-game-gold",
    green: "border-l-game-green",
    red: "border-l-game-red",
    purple: "border-l-game-purple",
  };
  return (
    <div
      className={`overflow-hidden rounded-[var(--game-radius-md)] border-2 border-black/10 bg-white shadow-[var(--game-shadow-md)] dark:border-white/10 dark:bg-zinc-900 ${className}`}
    >
      {title && (
        <div className={`flex items-center gap-2 border-l-4 bg-zinc-50 px-4 py-2.5 dark:bg-zinc-800 ${accentClass[accent]}`}>
          {icon && <span className="text-lg leading-none">{icon}</span>}
          <p className="text-sm font-bold">{title}</p>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
