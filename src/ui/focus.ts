/**
 * 「ダイアログを閉じたら操作面へ戻す」を全 UI で共有するための小さな仲介（§9a）。
 *
 * 閉じたあとフォーカスを開いたボタンへ返すのは DOM の作法としては正しいが、
 * ここでは操作面が canvas なので、HUD 上のボタンにフォーカスが残ると
 * 「開いて閉じたら二度と歩けない」に化ける。戻し先は常に canvas とする。
 */
let scene: HTMLElement | null = null;

/** 起動時に一度だけ。canvas は既定でフォーカスを受けないので tabindex を足す。 */
export function setSceneElement(el: HTMLElement | null): void {
  scene = el;
  if (el) el.tabIndex = -1;
}

export function sceneElement(): HTMLElement | null {
  return scene;
}

export function focusScene(): void {
  scene?.focus({ preventScroll: true });
}
