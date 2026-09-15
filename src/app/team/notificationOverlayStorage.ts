// 演出モーダル(ゴール到達・配当・ラッキーボーナス等)は、通知の内容が新着かどうかを
// notifications配列内の最新一致で判定しているだけだった。そのため、画面リロード
// (スマホのロック解除やページ再読み込みを含む)のたびに、まだ「最新10件」の中に
// 残っている古い通知に対して同じモーダルが何度も再表示されてしまっていた。
// 表示した通知IDをこの端末のlocalStorageに記録し、同じ内容を二度と表示しないようにする。

const PREFIX = "momotetsu_overlay_shown:";

export function isOverlayShown(namespace: string, id: string): boolean {
  try {
    return window.localStorage.getItem(`${PREFIX}${namespace}:${id}`) === "1";
  } catch {
    return false;
  }
}

export function markOverlayShown(namespace: string, id: string): void {
  try {
    window.localStorage.setItem(`${PREFIX}${namespace}:${id}`, "1");
  } catch {
    // localStorageが使えない環境(プライベートブラウズ等)では、従来通り毎回表示する。
  }
}
