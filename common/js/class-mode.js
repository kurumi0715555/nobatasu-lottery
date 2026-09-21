// 授業モード機能 - 教室へ見せる操作・結果に表示を集中させる
// すべての授業用ツールで使用可能な共通モジュール

(function() {
    'use strict';

    const CLASS_MODE_ACTIVE = 'class-mode-active';
    const STORAGE_KEY = 'nobatasu-class-mode';

    // タブを閉じるまで、ツール間の移動でも状態を引き継ぐ。
    let classModeEnabled = readStoredState();

    function readStoredState() {
        try {
            return window.sessionStorage.getItem(STORAGE_KEY) === 'true';
        } catch (_error) {
            return false;
        }
    }

    function storeState(enabled) {
        try {
            window.sessionStorage.setItem(STORAGE_KEY, String(enabled));
        } catch (_error) {
            // 保存できない環境でも、このページ内では授業モードを利用できる。
        }
    }

    // 授業モードの状態を取得
    function isClassMode() {
        return classModeEnabled;
    }

    // 授業モードを設定
    function setClassMode(enabled) {
        classModeEnabled = Boolean(enabled);
        storeState(classModeEnabled);
        applyClassMode();
    }

    // 授業モードを適用
    function applyClassMode() {
        document.body.classList.toggle(CLASS_MODE_ACTIVE, isClassMode());
        updateToggleButton();
    }

    function getOrCreateToggleButton() {
        let toggleBtn = document.getElementById('classModeToggle');
        if (!toggleBtn) {
            toggleBtn = document.createElement('button');
            toggleBtn.id = 'classModeToggle';
            toggleBtn.className = 'class-mode-toggle';
            toggleBtn.innerHTML = '<i id="classModeIcon" class="fas fa-chalkboard" aria-hidden="true"></i><span id="classModeText">授業モード</span>';
            document.body.prepend(toggleBtn);
        }

        toggleBtn.type = 'button';
        return toggleBtn;
    }

    // トグルボタンの表示を更新
    function updateToggleButton() {
        const toggleBtn = document.getElementById('classModeToggle');
        const toggleIcon = document.getElementById('classModeIcon');
        const toggleText = document.getElementById('classModeText');

        if (!toggleBtn) return;

        const enabled = isClassMode();
        const label = enabled ? '授業モードを終了' : '授業モード';
        toggleBtn.classList.toggle('active', enabled);
        toggleBtn.setAttribute('aria-pressed', String(enabled));
        toggleBtn.setAttribute('aria-label', label);
        toggleBtn.title = enabled ? '通常の作業画面に戻す' : '教室へ見せる画面に切り替える';
        if (toggleIcon) {
            toggleIcon.className = enabled ? 'fas fa-chalkboard-teacher' : 'fas fa-chalkboard';
            toggleIcon.setAttribute('aria-hidden', 'true');
        }
        if (toggleText) toggleText.textContent = label;
    }

    // 授業モードを切り替え
    function toggleClassMode() {
        const newState = !isClassMode();
        setClassMode(newState);

        // 状態変更の通知
        const message = newState
            ? '授業モードを開始しました。操作画面だけを表示します。'
            : '授業モードを終了しました。通常の作業画面に戻りました。';

        showNotification(message);
    }

    // 通知を表示
    function showNotification(message) {
        // 既存の通知を削除
        const existing = document.querySelector('.class-mode-notification');
        if (existing) {
            existing.remove();
        }
        
        // 新しい通知を作成
        const notification = document.createElement('div');
        notification.className = 'class-mode-notification';
        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');
        notification.textContent = message;
        document.body.appendChild(notification);

        // アニメーション
        setTimeout(() => notification.classList.add('show'), 10);

        // 3秒後に削除
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 240);
        }, 3000);
    }

    // 初期化
    function init() {
        const toggleBtn = getOrCreateToggleButton();

        // ページ読み込み時に授業モードを適用
        applyClassMode();

        // トグルボタンのイベントリスナー
        toggleBtn.addEventListener('click', toggleClassMode);
    }

    // DOMContentLoaded後に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // グローバルに公開（必要に応じて）
    window.ClassMode = {
        isActive: isClassMode,
        toggle: toggleClassMode,
        enable: () => setClassMode(true),
        disable: () => setClassMode(false)
    };
})();
