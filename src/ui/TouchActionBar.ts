import type { GameAction } from '../core/input/types';
import type { Dictionary } from '../i18n';

export interface TouchActionSpec {
  action: GameAction;
  label: string;
  primary?: boolean;
}

/**
 * 画面右下の文脈ボタン（§4.2）。
 *
 * 状況に応じて「見る / ヒント / タネあかし / 戻る / 一覧」が入れ替わる。
 * 常時表示されるボタンは最小限にし、展示を隠さない。
 */
export class TouchActionBar {
  readonly el: HTMLDivElement;
  #specs: TouchActionSpec[] = [];

  constructor(
    parent: HTMLElement,
    private readonly dispatch: (action: GameAction) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'touch-actions';
    parent.appendChild(this.el);
  }

  setEnabled(enabled: boolean): void {
    this.el.hidden = !enabled;
  }

  /** 同じ内容なら DOM を作り直さない（毎フレーム呼ばれるため） */
  setActions(specs: TouchActionSpec[]): void {
    if (sameSpecs(specs, this.#specs)) return;
    this.#specs = specs;
    this.el.replaceChildren();
    for (const spec of specs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'touch-action' + (spec.primary ? ' is-primary' : '');
      button.textContent = spec.label;
      button.setAttribute('aria-label', spec.label);
      button.addEventListener('click', () => this.dispatch(spec.action));
      this.el.appendChild(button);
    }
  }

  /** 常設ボタン（一覧・設定）は別レイヤに置き、文脈ボタンと混ぜない */
  static persistentSpecs(t: Dictionary): TouchActionSpec[] {
    return [
      { action: 'list', label: t.ui.list },
      { action: 'settings', label: t.ui.settings },
    ];
  }

  dispose(): void {
    this.el.remove();
  }
}

function sameSpecs(a: TouchActionSpec[], b: TouchActionSpec[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((spec, i) => spec.action === b[i]!.action && spec.label === b[i]!.label);
}
