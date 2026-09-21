/**
 * common-modal.js — NOBATASU Tools 統一モーダルコンポーネント
 *
 * window.Modal を公開する。ネイティブ alert() / confirm() の置き換え用。
 * 設計書: docs/archive/fable5-design-docs-2026-07-06/design-common-modal.md
 *
 * API:
 *   await Modal.alert(message, { title })                 → Promise<void>
 *   await Modal.confirm(message, { title, okLabel, cancelLabel, danger }) → Promise<boolean>
 *   Modal.custom(contentEl | htmlString, { title, width, closeOnBackdrop, closeOnEsc })
 *       → { close(result), closed: Promise<result> }
 *
 * 注意: htmlString を渡す口は「信頼できる固定文字列専用」。
 * ユーザー入力を含める場合は必ず DOM 要素（Node）を組み立てて渡すこと（XSS防止）。
 */
(function () {
    'use strict';

    // 多重呼び出しをキューで直列化する（重ね表示しない）
    const queue = [];
    let isShowing = false;
    let scrollLockCount = 0;
    let savedBodyOverflow = '';

    function lockBodyScroll() {
        if (scrollLockCount === 0) {
            savedBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        scrollLockCount++;
    }

    function unlockBodyScroll() {
        scrollLockCount = Math.max(0, scrollLockCount - 1);
        if (scrollLockCount === 0) {
            document.body.style.overflow = savedBodyOverflow;
        }
    }

    function getFocusableElements(container) {
        const selector = [
            'a[href]',
            'button:not([disabled])',
            'textarea:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(',');
        return Array.from(container.querySelectorAll(selector)).filter(
            (el) => el.offsetParent !== null || el === document.activeElement
        );
    }

    let uidCounter = 0;
    function nextId(prefix) {
        uidCounter += 1;
        return `nbt-modal-${prefix}-${uidCounter}`;
    }

    /**
     * 内部実装: 1件のモーダルを表示してクローズ処理まで面倒を見る。
     * queue によって同時に1つしか実行されない。
     */
    function openModalInternal({ contentEl, title, width, closeOnBackdrop, closeOnEsc, danger, onMount }) {
        return new Promise((resolve) => {
            const previouslyFocused = document.activeElement;

            const backdrop = document.createElement('div');
            backdrop.className = 'nbt-modal-backdrop';

            const modal = document.createElement('div');
            modal.className = 'nbt-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            if (width) {
                modal.style.width = width;
            }

            const titleId = nextId('title');

            const header = document.createElement('div');
            header.className = 'nbt-modal-header';

            const h2 = document.createElement('h2');
            h2.id = titleId;
            h2.textContent = title || '';
            header.appendChild(h2);

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'nbt-modal-close';
            closeBtn.setAttribute('aria-label', '閉じる');
            closeBtn.innerHTML = '&times;';
            header.appendChild(closeBtn);

            modal.setAttribute('aria-labelledby', titleId);
            modal.appendChild(header);

            const body = document.createElement('div');
            body.className = 'nbt-modal-body';
            if (typeof contentEl === 'string') {
                // 呼び出し元が「信頼できる固定文字列」であることを保証する契約
                body.innerHTML = contentEl;
            } else if (contentEl instanceof Node) {
                body.appendChild(contentEl);
            }
            modal.appendChild(body);

            const footer = document.createElement('div');
            footer.className = 'nbt-modal-footer';
            modal.appendChild(footer);

            backdrop.appendChild(modal);

            let closed = false;
            function close(result) {
                if (closed) return;
                closed = true;
                document.removeEventListener('keydown', onKeyDown, true);
                backdrop.removeEventListener('mousedown', onBackdropMouseDown);
                unlockBodyScroll();
                backdrop.remove();
                if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                    previouslyFocused.focus();
                }
                resolve(result);
            }

            function onKeyDown(e) {
                if (e.key === 'Escape') {
                    if (closeOnEsc) {
                        e.preventDefault();
                        close(undefined);
                    }
                    return;
                }
                if (e.key === 'Tab') {
                    const focusable = getFocusableElements(modal);
                    if (focusable.length === 0) return;
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (e.shiftKey) {
                        if (document.activeElement === first || !modal.contains(document.activeElement)) {
                            e.preventDefault();
                            last.focus();
                        }
                    } else if (document.activeElement === last || !modal.contains(document.activeElement)) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }

            function onBackdropMouseDown(e) {
                if (e.target === backdrop && closeOnBackdrop && !danger) {
                    close(undefined);
                }
            }

            closeBtn.addEventListener('click', () => close(undefined));
            backdrop.addEventListener('mousedown', onBackdropMouseDown);
            document.addEventListener('keydown', onKeyDown, true);

            document.body.appendChild(backdrop);
            lockBodyScroll();

            // ボタン生成・初期フォーカスは同期パスで即座に行う。
            // バックグラウンドタブでは requestAnimationFrame がスロットル/停止するため、
            // ここを rAF 内に置くと「ボタンなし・スクロールロックだけ掛かった」状態で
            // 操作不能になる（Fletcher QA MEDIUM-1）。
            const mountResult = onMount ? onMount({ footer, close }) : null;
            const focusTarget = (mountResult && mountResult.initialFocus) || getFocusableElements(modal)[0];
            if (focusTarget) {
                focusTarget.focus();
            }

            // 開閉アニメーション用のクラス切り替えのみ次フレームに委ねる
            // （transition が効くよう、初期状態を1フレーム維持する目的）
            requestAnimationFrame(() => {
                backdrop.classList.add('nbt-modal-backdrop--visible');
            });
        });
    }

    function enqueue(task) {
        return new Promise((resolve, reject) => {
            queue.push({ task, resolve, reject });
            processQueue();
        });
    }

    function processQueue() {
        if (isShowing || queue.length === 0) return;
        isShowing = true;
        const { task, resolve, reject } = queue.shift();
        Promise.resolve()
            .then(task)
            .then((result) => {
                isShowing = false;
                resolve(result);
                processQueue();
            })
            .catch((err) => {
                isShowing = false;
                reject(err);
                processQueue();
            });
    }

    function makeButton(label, variant) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn ${variant}`;
        btn.textContent = label;
        return btn;
    }

    const Modal = {
        alert(message, options) {
            const opts = options || {};
            const title = opts.title || 'お知らせ';
            return enqueue(() =>
                openModalInternal({
                    contentEl: buildMessageNode(message),
                    title,
                    closeOnBackdrop: true,
                    closeOnEsc: true,
                    danger: false,
                    onMount: ({ footer, close }) => {
                        const okBtn = makeButton('OK', 'btn-primary');
                        okBtn.addEventListener('click', () => close(undefined));
                        footer.appendChild(okBtn);
                        return { initialFocus: okBtn };
                    }
                })
            );
        },

        confirm(message, options) {
            const opts = options || {};
            const title = opts.title || '確認';
            const okLabel = opts.okLabel || 'OK';
            const cancelLabel = opts.cancelLabel || 'キャンセル';
            const danger = !!opts.danger;
            return enqueue(() =>
                openModalInternal({
                    contentEl: buildMessageNode(message),
                    title,
                    closeOnBackdrop: true,
                    closeOnEsc: true,
                    danger,
                    onMount: ({ footer, close }) => {
                        const cancelBtn = makeButton(cancelLabel, 'btn-secondary');
                        cancelBtn.addEventListener('click', () => close(false));
                        const okBtn = makeButton(okLabel, danger ? 'btn-danger' : 'btn-primary');
                        okBtn.addEventListener('click', () => close(true));
                        footer.appendChild(cancelBtn);
                        footer.appendChild(okBtn);
                        return { initialFocus: cancelBtn };
                    }
                }).then((result) => result === true)
            );
        },

        custom(content, options) {
            const opts = options || {};
            let closeFn = null;
            const closed = enqueue(
                () =>
                    new Promise((resolveClose) => {
                        openModalInternal({
                            contentEl: content,
                            title: opts.title || '',
                            width: opts.width || '480px',
                            closeOnBackdrop: opts.closeOnBackdrop !== false,
                            closeOnEsc: opts.closeOnEsc !== false,
                            danger: false,
                            onMount: ({ close }) => {
                                closeFn = close;
                                return null;
                            }
                        }).then(resolveClose);
                    })
            );
            return {
                close(result) {
                    if (closeFn) closeFn(result);
                },
                closed
            };
        }
    };

    function buildMessageNode(message) {
        const p = document.createElement('p');
        p.className = 'nbt-modal-message';
        // 改行を <br> として扱う（ネイティブ alert/confirm の \n 互換）
        const text = String(message == null ? '' : message);
        text.split('\n').forEach((line, idx) => {
            if (idx > 0) p.appendChild(document.createElement('br'));
            p.appendChild(document.createTextNode(line));
        });
        return p;
    }

    window.Modal = Modal;
})();
