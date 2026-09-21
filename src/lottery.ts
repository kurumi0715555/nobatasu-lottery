// 抽選ツール TypeScript implementation.
export {};

type LotteryMode = 'name' | 'number' | 'group';
type SpeakersMarked = Record<string, Record<string, boolean>>;

interface ModalApi {
  alert(message: string): Promise<void>;
  confirm(message: string, options?: { danger?: boolean }): Promise<boolean>;
}

interface WindowWithLotteryDependencies extends Window {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

interface DocumentWithWebkitFullscreen extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface HTMLElementWithWebkitFullscreen extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

declare const Modal: ModalApi;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`必要な画面要素が見つかりません: #${id}`);
  return element as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSpeakersMarked(value: unknown): value is SpeakersMarked {
  if (!isRecord(value)) return false;
  return Object.values(value).every((modeValue) => {
    return isRecord(modeValue) && Object.values(modeValue).every((marked) => typeof marked === 'boolean');
  });
}

function readNumberInput(input: HTMLInputElement, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(input.value, 10);
  if (!Number.isFinite(value)) {
    input.value = String(fallback);
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, value));
  input.value = String(clamped);
  return clamped;
}

// グローバル変数
let allParticipants: string[] = [];
let remainingParticipants: string[] = [];
let history: string[] = [];
let isSpinning = false;
let currentMode: LotteryMode = 'name';
let maxNumber = 30;
let remainingNumbers: number[] = [];
let maxGroup = 6;
let remainingGroups: number[] = [];
let lastWinner: string | null = null;
let speakersMarked: SpeakersMarked = {};

// LocalStorage キー
const LS_KEY_NAMES = 'lottery_names';
const LS_KEY_SPEAKERS = 'lottery_speakers_marked';
const LS_KEY_FULLROUND = 'lottery_full_round_mode';
const LS_KEY_SKIPLAST = 'lottery_skip_last_mode';

// DOM要素
const nameListInput = byId<HTMLTextAreaElement>('nameList');
const loadSampleBtn = byId<HTMLButtonElement>('loadSampleBtn');
const clearAllBtn = byId<HTMLButtonElement>('clearAllBtn');
const totalCountEl = byId<HTMLElement>('totalCount');
const remainingCountEl = byId<HTMLElement>('remainingCount');
const startBtn = byId<HTMLButtonElement>('startBtn');
const resetLotteryBtn = byId<HTMLButtonElement>('resetLotteryBtn');
const slotReel = byId<HTMLElement>('slotReel');
const slotContainerCandidate = slotReel.parentElement;
if (!(slotContainerCandidate instanceof HTMLElement)) throw new Error('スロットコンテナが見つかりません。');
const slotContainer = slotContainerCandidate;
const historyList = byId<HTMLElement>('historyList');
const fullscreenBtn = byId<HTMLButtonElement>('fullscreenBtn');
const fullscreenOverlay = byId<HTMLElement>('fullscreenOverlay');
const exitFullscreenBtn = byId<HTMLButtonElement>('exitFullscreenBtn');
const fullscreenSlotContainer = byId<HTMLElement>('fullscreenSlotContainer');
const fullscreenSlotReel = byId<HTMLElement>('fullscreenSlotReel');
const fsStartBtn = byId<HTMLButtonElement>('fsStartBtn');
const fsResetBtn = byId<HTMLButtonElement>('fsResetBtn');

// モード切り替え関連
const nameMode = byId<HTMLInputElement>('nameMode');
const numberMode = byId<HTMLInputElement>('numberMode');
const groupMode = byId<HTMLInputElement>('groupMode');
const nameInputSection = byId<HTMLElement>('nameInputSection');
const numberInputSection = byId<HTMLElement>('numberInputSection');
const groupInputSection = byId<HTMLElement>('groupInputSection');
const maxNumberInput = byId<HTMLInputElement>('maxNumber');
const maxNumberDisplay = byId<HTMLElement>('maxNumberDisplay');
const numberTotalCount = byId<HTMLElement>('numberTotalCount');
const numberRemainingCount = byId<HTMLElement>('numberRemainingCount');
const resetNumberBtn = byId<HTMLButtonElement>('resetNumberBtn');
const maxGroupInput = byId<HTMLInputElement>('maxGroup');
const maxGroupDisplay = byId<HTMLElement>('maxGroupDisplay');
const groupTotalCount = byId<HTMLElement>('groupTotalCount');
const groupRemainingCount = byId<HTMLElement>('groupRemainingCount');
const resetGroupBtn = byId<HTMLButtonElement>('resetGroupBtn');

// オプション関連
const fullRoundCheckbox = byId<HTMLInputElement>('fullRoundMode');
const skipLastCheckbox = byId<HTMLInputElement>('skipLastMode');

const sampleNames = [
  '田中太郎', '鈴木花子', '佐藤次郎', '山田美咲', '伊藤健太',
  '渡辺さくら', '中村大輔', '小林優子', '加藤翔太', '吉田愛',
];

// =========================================================
// LocalStorage ヘルパー
// =========================================================
function loadSpeakersMarked(): void {
  try {
    const raw = localStorage.getItem(LS_KEY_SPEAKERS);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    speakersMarked = isSpeakersMarked(parsed) ? parsed : {};
  } catch {
    speakersMarked = {};
  }
}

function saveSpeakersMarked(): void {
  try {
    localStorage.setItem(LS_KEY_SPEAKERS, JSON.stringify(speakersMarked));
  } catch (error: unknown) {
    console.warn('発言済みマークの保存に失敗:', error);
  }
}

function clearSpeakersMarkedForMode(mode: LotteryMode): void {
  if (speakersMarked[mode]) {
    delete speakersMarked[mode];
    saveSpeakersMarked();
  }
}

function isSpeakerMarked(mode: LotteryMode, name: string): boolean {
  return speakersMarked[mode]?.[name] === true;
}

function toggleSpeakerMarked(mode: LotteryMode, name: string): void {
  const marks = speakersMarked[mode] ?? {};
  if (marks[name]) {
    delete marks[name];
    if (Object.keys(marks).length === 0) delete speakersMarked[mode];
  } else {
    marks[name] = true;
    speakersMarked[mode] = marks;
  }
  saveSpeakersMarked();
}

// =========================================================
// モード切り替え
// =========================================================
function switchMode(mode: LotteryMode): void {
  currentMode = mode;
  nameInputSection.style.display = mode === 'name' ? 'block' : 'none';
  numberInputSection.style.display = mode === 'number' ? 'block' : 'none';
  groupInputSection.style.display = mode === 'group' ? 'block' : 'none';

  history = [];
  lastWinner = null;
  hideFullRoundComplete();

  if (mode === 'name') updateParticipantList();
  else if (mode === 'number') updateNumberList();
  else updateGroupList();

  updateHistory();
  slotContainer.classList.remove('winner');
  slotReel.classList.add('stopped');
  slotReel.innerHTML = '<div class="slot-item">?</div>';
}

// =========================================================
// 参加者／番号／班リスト更新
// =========================================================
function updateParticipantList(): void {
  const text = nameListInput.value.trim();
  allParticipants = text
    ? text.split('\n').map((name) => name.trim()).filter((name) => name.length > 0)
    : [];
  const drawnNames = new Set(history);
  remainingParticipants = allParticipants.filter((name) => !drawnNames.has(name));
  try {
    localStorage.setItem(LS_KEY_NAMES, nameListInput.value);
  } catch (error: unknown) {
    console.warn('参加者リストの保存に失敗:', error);
  }
  updateCounters();
}

function updateNumberList(): void {
  maxNumber = readNumberInput(maxNumberInput, 30, 1, 999);
  maxNumberDisplay.textContent = String(maxNumber);
  remainingNumbers = [];
  for (let i = 1; i <= maxNumber; i += 1) {
    if (!history.includes(String(i))) remainingNumbers.push(i);
  }
  remainingParticipants = remainingNumbers.map((number) => String(number));
  numberTotalCount.textContent = `範囲: 1～${maxNumber}`;
  numberRemainingCount.textContent = `残り: ${remainingNumbers.length}個`;
  startBtn.disabled = remainingNumbers.length === 0;
}

function updateGroupList(): void {
  maxGroup = readNumberInput(maxGroupInput, 6, 2, 10);
  maxGroupDisplay.textContent = String(maxGroup);
  remainingGroups = [];
  for (let i = 1; i <= maxGroup; i += 1) {
    const label = `${i}班`;
    if (!history.includes(label)) remainingGroups.push(i);
  }
  remainingParticipants = remainingGroups.map((number) => `${number}班`);
  groupTotalCount.textContent = `範囲: 1班～${maxGroup}班`;
  groupRemainingCount.textContent = `残り: ${remainingGroups.length}班`;
  startBtn.disabled = remainingGroups.length === 0;
}

function updateCounters(): void {
  totalCountEl.textContent = `参加者: ${allParticipants.length}名`;
  remainingCountEl.textContent = `残り: ${remainingParticipants.length}名`;
  if (remainingParticipants.length === 0) {
    startBtn.disabled = allParticipants.length === 0;
    startBtn.innerHTML = allParticipants.length > 0 && history.length > 0
      ? '<i class="fas fa-redo"></i> 全員抽選済み（リセットしてください）'
      : '<i class="fas fa-play"></i> 抽選スタート';
  } else {
    startBtn.disabled = false;
    startBtn.innerHTML = '<i class="fas fa-play"></i> 抽選スタート';
  }
}

// =========================================================
// リセット
// =========================================================
async function resetNumbers(): Promise<void> {
  if (history.length === 0) { await Modal.alert('まだ抽選が行われていません。'); return; }
  if (!(await Modal.confirm('抽選履歴をリセットしますか？\n全ての番号が再度抽選対象になります。'))) return;
  history = [];
  lastWinner = null;
  clearSpeakersMarkedForMode('number');
  hideFullRoundComplete();
  updateNumberList();
  updateHistory();
  resetMainSlot();
  playSound(400, 100);
}

async function resetGroups(): Promise<void> {
  if (history.length === 0) { await Modal.alert('まだ抽選が行われていません。'); return; }
  if (!(await Modal.confirm('抽選履歴をリセットしますか？\n全ての班が再度抽選対象になります。'))) return;
  history = [];
  lastWinner = null;
  clearSpeakersMarkedForMode('group');
  hideFullRoundComplete();
  updateGroupList();
  updateHistory();
  resetMainSlot();
  playSound(400, 100);
}

function resetMainSlot(): void {
  slotContainer.classList.remove('winner');
  slotReel.classList.add('stopped');
  slotReel.innerHTML = '<div class="slot-item">?</div>';
}

// =========================================================
// スロットアニメーション
// =========================================================
function spinSlot(names: string[], duration = 2000): Promise<void> {
  return new Promise((resolve) => {
    if (names.length === 0) { resolve(); return; }
    slotReel.classList.add('spinning');
    let currentIndex = 0;
    const displayItems = Array.from({ length: 20 }, (_, index) => names[index % names.length] ?? '');
    const interval = window.setInterval(() => {
      const item = displayItems[currentIndex % displayItems.length] ?? '';
      slotReel.innerHTML = `<div class="slot-item">${escapeHtml(item)}</div>`;
      currentIndex += 1;
    }, 100);
    window.setTimeout(() => {
      window.clearInterval(interval);
      slotReel.classList.remove('spinning');
      resolve();
    }, duration);
  });
}

function showWinner(name: string): void {
  slotReel.classList.add('stopped');
  slotReel.innerHTML = `<div class="slot-item">${escapeHtml(name)}</div>`;
  slotContainer.classList.add('winner');
}

// =========================================================
// 履歴表示
// =========================================================
function updateHistory(): void {
  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-message">まだ抽選が行われていません</p>';
    return;
  }
  historyList.innerHTML = history.map((name, index) => {
    const marked = isSpeakerMarked(currentMode, name);
    const safeName = escapeHtml(name);
    return `<div class="history-item${marked ? ' spoken' : ''}" data-name="${safeName}">
      <span class="number">${index + 1}</span><span>${safeName}</span>
      <button type="button" class="speaker-toggle" data-name="${safeName}" aria-pressed="${marked}">
        <i class="fas fa-check"></i>${marked ? '発言済み' : '発言済みにする'}
      </button>
    </div>`;
  }).join('');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

historyList.addEventListener('click', (event: MouseEvent) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('.speaker-toggle');
  if (!(button instanceof HTMLButtonElement)) return;
  const name = button.dataset.name;
  if (!name) return;
  toggleSpeakerMarked(currentMode, name);
  updateHistory();
});

// =========================================================
// 全員1周完了メッセージ
// =========================================================
let fullRoundCompleteEl: HTMLElement | null = null;

function ensureFullRoundCompleteEl(): HTMLElement {
  if (fullRoundCompleteEl) return fullRoundCompleteEl;
  const historySection = document.querySelector('.history-section');
  if (!(historySection instanceof HTMLElement) || !historySection.parentNode) {
    throw new Error('履歴セクションが見つかりません。');
  }
  fullRoundCompleteEl = document.createElement('div');
  fullRoundCompleteEl.className = 'full-round-complete';
  fullRoundCompleteEl.id = 'fullRoundComplete';
  fullRoundCompleteEl.innerHTML = `<div><i class="fas fa-circle-check"></i> 全員終わりました！</div>
    <button type="button" class="btn btn-primary" id="restartRoundBtn">
      <i class="fas fa-rotate-right"></i> もう1周する
    </button>`;
  historySection.parentNode.insertBefore(fullRoundCompleteEl, historySection);
  const restartButton = fullRoundCompleteEl.querySelector('#restartRoundBtn');
  if (!(restartButton instanceof HTMLButtonElement)) throw new Error('再開ボタンが見つかりません。');
  restartButton.addEventListener('click', restartRound);
  return fullRoundCompleteEl;
}

function showFullRoundComplete(): void { ensureFullRoundCompleteEl().classList.add('show'); }
function hideFullRoundComplete(): void { fullRoundCompleteEl?.classList.remove('show'); }

function restartRound(): void {
  history = [];
  lastWinner = null;
  clearSpeakersMarkedForMode(currentMode);
  hideFullRoundComplete();
  if (currentMode === 'name') updateParticipantList();
  else if (currentMode === 'number') updateNumberList();
  else updateGroupList();
  updateHistory();
  resetMainSlot();
  if (fullscreenOverlay.classList.contains('active')) {
    fullscreenSlotContainer.classList.remove('winner');
    fullscreenSlotReel.classList.add('stopped');
    fullscreenSlotReel.innerHTML = '<div class="fullscreen-slot-item">?</div>';
    fsStartBtn.disabled = remainingParticipants.length === 0;
  }
  playSound(800, 120);
}

// =========================================================
// 抽選ロジック
// =========================================================
function getCurrentRemainingCount(): number {
  if (currentMode === 'name') return remainingParticipants.length;
  if (currentMode === 'number') return remainingNumbers.length;
  return remainingGroups.length;
}

function getDrawCandidates(): string[] {
  let candidates = remainingParticipants.slice();
  if (skipLastCheckbox.checked && lastWinner && candidates.length > 1) {
    candidates = candidates.filter((candidate) => candidate !== lastWinner);
  }
  return candidates;
}

function consumeWinner(winner: string): void {
  if (currentMode === 'name') {
    const index = remainingParticipants.indexOf(winner);
    if (index >= 0) remainingParticipants.splice(index, 1);
  } else if (currentMode === 'number') {
    const number = Number.parseInt(winner, 10);
    const index = remainingNumbers.indexOf(number);
    if (index >= 0) remainingNumbers.splice(index, 1);
    remainingParticipants = remainingNumbers.map((value) => String(value));
  } else {
    const number = Number.parseInt(winner, 10);
    const index = remainingGroups.indexOf(number);
    if (index >= 0) remainingGroups.splice(index, 1);
    remainingParticipants = remainingGroups.map((value) => `${value}班`);
  }
}

function refreshAfterDraw(): void {
  if (currentMode === 'name') updateCounters();
  else if (currentMode === 'number') {
    numberTotalCount.textContent = `範囲: 1～${maxNumber}`;
    numberRemainingCount.textContent = `残り: ${remainingNumbers.length}個`;
    startBtn.disabled = remainingNumbers.length === 0;
  } else {
    groupTotalCount.textContent = `範囲: 1班～${maxGroup}班`;
    groupRemainingCount.textContent = `残り: ${remainingGroups.length}班`;
    startBtn.disabled = remainingGroups.length === 0;
  }
}

function completionMessage(): string {
  if (currentMode === 'name') return '全員の抽選が完了しました！\n「抽選リセット」を押すと、もう一度抽選できます。';
  if (currentMode === 'number') return '全ての番号の抽選が完了しました！\n「番号をリセット」を押すと、もう一度抽選できます。';
  return '全ての班の抽選が完了しました！\n「班をリセット」を押すと、もう一度抽選できます。';
}

async function startLottery(): Promise<void> {
  if (isSpinning) return;
  if (getCurrentRemainingCount() === 0) {
    const message = currentMode === 'name'
      ? '抽選できる参加者がいません。\n名前を入力するか、抽選をリセットしてください。'
      : currentMode === 'number'
        ? '抽選できる番号がありません。\n抽選をリセットしてください。'
        : '抽選できる班がありません。\n抽選をリセットしてください。';
    await Modal.alert(message);
    return;
  }
  isSpinning = true;
  startBtn.disabled = true;
  slotContainer.classList.remove('winner');
  slotReel.classList.remove('stopped');
  playSound(1000, 100);
  await spinSlot(remainingParticipants, 2000);
  const candidates = getDrawCandidates();
  const winner = candidates[Math.floor(Math.random() * candidates.length)];
  if (winner === undefined) { isSpinning = false; refreshAfterDraw(); return; }
  consumeWinner(winner);
  showWinner(winner);
  history.push(winner);
  lastWinner = winner;
  updateHistory();
  refreshAfterDraw();
  playSound(1200, 200);
  window.setTimeout(() => playSound(1500, 200), 200);
  isSpinning = false;
  if (getCurrentRemainingCount() === 0) {
    if (fullRoundCheckbox.checked) window.setTimeout(showFullRoundComplete, 400);
    else window.setTimeout(() => void Modal.alert(completionMessage()), 500);
  }
}

async function resetLottery(): Promise<void> {
  if (history.length === 0) { await Modal.alert('まだ抽選が行われていません。'); return; }
  const message = currentMode === 'name'
    ? '抽選履歴をリセットしますか？\n全員が再度抽選対象になります。'
    : currentMode === 'number'
      ? '抽選履歴をリセットしますか？\n全ての番号が再度抽選対象になります。'
      : '抽選履歴をリセットしますか？\n全ての班が再度抽選対象になります。';
  if (!(await Modal.confirm(message))) return;
  history = [];
  lastWinner = null;
  clearSpeakersMarkedForMode(currentMode);
  hideFullRoundComplete();
  if (currentMode === 'name') updateParticipantList();
  else if (currentMode === 'number') updateNumberList();
  else updateGroupList();
  updateHistory();
  resetMainSlot();
  playSound(400, 100);
}

async function clearAll(): Promise<void> {
  if (!nameListInput.value.trim() && history.length === 0) return;
  if (!(await Modal.confirm('参加者リストと抽選履歴を全て削除しますか？', { danger: true }))) return;
  nameListInput.value = '';
  allParticipants = [];
  remainingParticipants = [];
  history = [];
  lastWinner = null;
  clearSpeakersMarkedForMode('name');
  hideFullRoundComplete();
  updateCounters();
  updateHistory();
  resetMainSlot();
  playSound(400, 100);
}

function loadSample(): void {
  nameListInput.value = sampleNames.join('\n');
  updateParticipantList();
  playSound(1000, 50);
}

// =========================================================
// 効果音
// =========================================================
function playSound(frequency = 800, duration = 100): void {
  try {
    const audioWindow = window as WindowWithLotteryDependencies;
    const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextConstructor) return;
    const audioContext = new AudioContextConstructor();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration / 1000);
  } catch (error: unknown) {
    console.log('音声再生エラー:', error);
  }
}

// =========================================================
// 全画面表示
// =========================================================
function toggleFullscreen(): void {
  fullscreenOverlay.classList.add('active');
  syncFullscreenDisplay();
  const root = document.documentElement as HTMLElementWithWebkitFullscreen;
  if (root.requestFullscreen) void root.requestFullscreen();
  else if (root.webkitRequestFullscreen) void root.webkitRequestFullscreen();
}

function exitFullscreen(): void {
  fullscreenOverlay.classList.remove('active');
  const fullscreenDocument = document as DocumentWithWebkitFullscreen;
  if (document.exitFullscreen) void document.exitFullscreen();
  else if (fullscreenDocument.webkitExitFullscreen) void fullscreenDocument.webkitExitFullscreen();
}

function syncFullscreenDisplay(): void {
  const currentItem = slotReel.querySelector('.slot-item');
  const currentName = currentItem?.textContent ?? '?';
  fullscreenSlotReel.innerHTML = `<div class="fullscreen-slot-item">${escapeHtml(currentName)}</div>`;
  fullscreenSlotContainer.classList.toggle('winner', slotContainer.classList.contains('winner'));
  fsStartBtn.disabled = getCurrentRemainingCount() === 0;
}

function spinFullscreenSlot(names: string[], duration = 2000): Promise<void> {
  return new Promise((resolve) => {
    if (names.length === 0) { resolve(); return; }
    fullscreenSlotReel.classList.add('spinning');
    let currentIndex = 0;
    const displayItems = Array.from({ length: 20 }, (_, index) => names[index % names.length] ?? '');
    const interval = window.setInterval(() => {
      const item = displayItems[currentIndex % displayItems.length] ?? '';
      fullscreenSlotReel.innerHTML = `<div class="fullscreen-slot-item">${escapeHtml(item)}</div>`;
      currentIndex += 1;
    }, 100);
    window.setTimeout(() => {
      window.clearInterval(interval);
      fullscreenSlotReel.classList.remove('spinning');
      resolve();
    }, duration);
  });
}

async function startFullscreenLottery(): Promise<void> {
  if (isSpinning) return;
  if (getCurrentRemainingCount() === 0) { await Modal.alert('抽選できる候補がいません。'); return; }
  isSpinning = true;
  fsStartBtn.disabled = true;
  fullscreenSlotContainer.classList.remove('winner');
  fullscreenSlotReel.classList.remove('stopped');
  playSound(1000, 100);
  await spinFullscreenSlot(remainingParticipants, 2000);
  const candidates = getDrawCandidates();
  const winner = candidates[Math.floor(Math.random() * candidates.length)];
  if (winner === undefined) { isSpinning = false; fsStartBtn.disabled = getCurrentRemainingCount() === 0; return; }
  fullscreenSlotReel.classList.add('stopped');
  fullscreenSlotReel.innerHTML = `<div class="fullscreen-slot-item">${escapeHtml(winner)}</div>`;
  fullscreenSlotContainer.classList.add('winner');
  consumeWinner(winner);
  history.push(winner);
  lastWinner = winner;
  showWinner(winner);
  updateHistory();
  refreshAfterDraw();
  playSound(1200, 200);
  window.setTimeout(() => playSound(1500, 200), 200);
  isSpinning = false;
  fsStartBtn.disabled = getCurrentRemainingCount() === 0;
  if (getCurrentRemainingCount() === 0) {
    if (fullRoundCheckbox.checked) {
      window.setTimeout(() => {
        showFullRoundComplete();
        void Modal.alert('全員終わりました！\n通常画面の「もう1周する」ボタンから再開できます。');
      }, 400);
    } else window.setTimeout(() => void Modal.alert('全員の抽選が完了しました！'), 500);
  }
}

async function resetFullscreenLottery(): Promise<void> {
  if (history.length === 0) { await Modal.alert('まだ抽選が行われていません。'); return; }
  if (!(await Modal.confirm('抽選履歴をリセットしますか？'))) return;
  history = [];
  lastWinner = null;
  clearSpeakersMarkedForMode(currentMode);
  hideFullRoundComplete();
  if (currentMode === 'name') updateParticipantList();
  else if (currentMode === 'number') updateNumberList();
  else updateGroupList();
  updateHistory();
  fullscreenSlotContainer.classList.remove('winner');
  fullscreenSlotReel.classList.add('stopped');
  fullscreenSlotReel.innerHTML = '<div class="fullscreen-slot-item">?</div>';
  resetMainSlot();
  fsStartBtn.disabled = getCurrentRemainingCount() === 0;
  playSound(400, 100);
  await Modal.alert('抽選をリセットしました。');
}

// =========================================================
// オプション制御・イベント
// =========================================================
function applyFullRoundLock(): void {
  try { localStorage.setItem(LS_KEY_FULLROUND, fullRoundCheckbox.checked ? '1' : '0'); } catch (error: unknown) { console.warn('設定の保存に失敗:', error); }
}

function applySkipLastSetting(): void {
  try { localStorage.setItem(LS_KEY_SKIPLAST, skipLastCheckbox.checked ? '1' : '0'); } catch (error: unknown) { console.warn('設定の保存に失敗:', error); }
}

nameListInput.addEventListener('input', updateParticipantList);
loadSampleBtn.addEventListener('click', loadSample);
clearAllBtn.addEventListener('click', () => void clearAll());
startBtn.addEventListener('click', () => void startLottery());
resetLotteryBtn.addEventListener('click', () => void resetLottery());
fullscreenBtn.addEventListener('click', toggleFullscreen);
exitFullscreenBtn.addEventListener('click', exitFullscreen);
fsStartBtn.addEventListener('click', () => void startFullscreenLottery());
fsResetBtn.addEventListener('click', () => void resetFullscreenLottery());
nameMode.addEventListener('change', () => switchMode('name'));
numberMode.addEventListener('change', () => switchMode('number'));
groupMode.addEventListener('change', () => switchMode('group'));
maxNumberInput.addEventListener('input', updateNumberList);
resetNumberBtn.addEventListener('click', () => void resetNumbers());
maxGroupInput.addEventListener('input', updateGroupList);
resetGroupBtn.addEventListener('click', () => void resetGroups());
fullRoundCheckbox.addEventListener('change', applyFullRoundLock);
skipLastCheckbox.addEventListener('change', applySkipLastSetting);

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) fullscreenOverlay.classList.remove('active');
});
document.addEventListener('webkitfullscreenchange', () => {
  if (!(document as DocumentWithWebkitFullscreen).webkitFullscreenElement) fullscreenOverlay.classList.remove('active');
});
document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.code === 'Space' && fullscreenOverlay.classList.contains('active')) {
    event.preventDefault();
    if (!isSpinning) void startFullscreenLottery();
  }
  if (event.code === 'Escape' && fullscreenOverlay.classList.contains('active')) exitFullscreen();
});

// =========================================================
// 初期化
// =========================================================
slotReel.classList.add('stopped');
loadSpeakersMarked();
try {
  fullRoundCheckbox.checked = localStorage.getItem(LS_KEY_FULLROUND) === '1';
  skipLastCheckbox.checked = localStorage.getItem(LS_KEY_SKIPLAST) === '1';
  const savedNames = localStorage.getItem(LS_KEY_NAMES);
  if (savedNames) {
    nameListInput.value = savedNames;
    updateParticipantList();
  }
} catch (error: unknown) {
  console.warn('保存設定の復元に失敗:', error);
}
updateCounters();
updateNumberList();
updateGroupList();
updateHistory();
console.log('抽選ツール初期化完了（拡張版：班モード／全員1周／直前スキップ／発言済みマーク）');
