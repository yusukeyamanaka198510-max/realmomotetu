// 金額を「3,000万円」「3億1,000万円」のような日本語の万/億表記にする。
// 参加者向け画面での金額表示に統一して使う(本部の管理画面は正確な生数字を優先し対象外)。
export function formatYen(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(amount));
  const oku = Math.floor(abs / 100_000_000);
  const man = Math.floor((abs % 100_000_000) / 10_000);
  const yen = abs % 10_000;

  const parts: string[] = [];
  if (oku > 0) parts.push(`${oku.toLocaleString()}億`);
  if (man > 0) parts.push(`${man.toLocaleString()}万`);
  if (yen > 0 || parts.length === 0) parts.push(yen.toLocaleString());

  return `${sign}${parts.join("")}円`;
}
