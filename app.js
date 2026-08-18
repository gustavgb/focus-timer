const STORAGE_KEY = "pomodoro-state";
const LATEST_DURATION_KEY = "pomodoro-latest-duration-ms";
const DEFAULT_DURATION_MS = 25 * 60 * 1000;
const MAX_STATE_AGE = 12 * 60 * 60 * 1000; // 12 hours

const timerEl = document.getElementById("timer");
const timerInputEl = document.getElementById("timer-input");
const toggleEl = document.getElementById("toggle");
const resetEl = document.getElementById("reset");
let latestDurationMs = loadLatestDuration();

let state = {
  status: "idle", // idle | running | paused
  durationMinutes: latestDurationMs / 60000,
  remainingMs: latestDurationMs,
  endTime: null
};

let intervalId = null;
let audioContext = null;

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...state,
      updatedAt: Date.now()
    })
  );
}

function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
}

function loadLatestDuration() {
  const saved = Number(localStorage.getItem(LATEST_DURATION_KEY));

  if (!Number.isFinite(saved) || saved <= 0) {
    return DEFAULT_DURATION_MS;
  }

  return saved;
}

function saveLatestDuration(durationMs) {
  latestDurationMs = durationMs;
  localStorage.setItem(LATEST_DURATION_KEY, String(durationMs));
}

function formatTime(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`
  );
}

function parseDurationInput(value) {
  const trimmed = value.trim();

  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const minutes = Number(trimmed);

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return null;
    }

    return minutes * 60 * 1000;
  }

  const match = trimmed.match(/^(\d+):([0-5]\d)$/);

  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const totalMs = (minutes * 60 + seconds) * 1000;

  return totalMs > 0 ? totalMs : null;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) return;

  try {
    const saved = JSON.parse(raw);

    if (
      !saved.updatedAt ||
      Date.now() - saved.updatedAt > MAX_STATE_AGE
    ) {
      clearSavedState();
      return;
    }

    state = {
      status: saved.status,
      durationMinutes: saved.durationMinutes ?? latestDurationMs / 60000,
      remainingMs: saved.remainingMs ?? latestDurationMs,
      endTime: saved.endTime
    };

    if (state.status === "running") {
      state.remainingMs = state.endTime - Date.now();

      if (state.remainingMs <= 0) {
        finishTimer();
        return;
      }

      startTicker();
    }
  } catch {
    clearSavedState();
  }
}

function getRemainingMs() {
  if (state.status === "running") {
    return Math.max(0, state.endTime - Date.now());
  }

  return Math.max(0, state.remainingMs);
}

function ensureAudioContext() {
  if (!("AudioContext" in window || "webkitAudioContext" in window)) {
    return null;
  }

  if (!audioContext) {
    const AudioContextCtor =
      window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {
      // Audio is optional; ignore resume failures.
    });
  }

  return audioContext;
}

function render() {
  const remaining = getRemainingMs();
  const displayValue = formatTime(remaining);

  timerEl.textContent = displayValue;
  timerInputEl.value = formatTime(state.remainingMs);
  timerEl.hidden = state.status === "idle";
  timerInputEl.hidden = state.status !== "idle";

  toggleEl.textContent =
    state.status === "running" ? "Pause" : "Start";

  resetEl.hidden = state.status === "idle";

  document.title =
    state.status === "running"
      ? `${displayValue} · Focus Timer`
      : "Focus Timer";
}

function startTicker() {
  clearInterval(intervalId);

  intervalId = setInterval(() => {
    if (getRemainingMs() <= 0) {
      finishTimer();
      return;
    }

    render();
  }, 250);

  render();
}

async function startTimer() {
  ensureAudioContext();

  if (state.status === "idle") {
    const durationMs =
      parseDurationInput(timerInputEl.value) ?? latestDurationMs;

    saveLatestDuration(durationMs);
    state.durationMinutes = durationMs / 60000;
    state.remainingMs = durationMs;
  }

  state.endTime = Date.now() + state.remainingMs;
  state.status = "running";

  saveState();
  startTicker();

  if (
    "Notification" in window &&
    Notification.permission === "default"
  ) {
    try {
      await Notification.requestPermission();
    } catch {
      // Notifications are optional; the timer still works.
    }
  }
}

function pauseTimer() {
  state.remainingMs = getRemainingMs();
  state.endTime = null;
  state.status = "paused";

  clearInterval(intervalId);
  intervalId = null;

  saveState();
  render();
}

function finishTimer() {
  clearInterval(intervalId);
  intervalId = null;

  state.status = "idle";
  state.remainingMs = latestDurationMs;
  state.durationMinutes = latestDurationMs / 60000;
  state.endTime = null;

  clearSavedState();
  render();
  playCompletionSound();
  showNotification();
}

function resetTimer() {
  clearInterval(intervalId);
  intervalId = null;

  state.status = "idle";
  state.remainingMs = latestDurationMs;
  state.durationMinutes = latestDurationMs / 60000;
  state.endTime = null;

  clearSavedState();
  render();
}

function showNotification() {
  if (
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    new Notification("Focus session finished", {
      body: "Your focus session is complete."
    });
  }
}

function playCompletionSound() {
  const context = ensureAudioContext();

  if (!context) return;

  const now = context.currentTime;
  const notes = [880, 1174.66, 1567.98];

  notes.forEach((frequency, index) => {
    const startAt = now + index * 0.16;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);

    gainNode.gain.setValueAtTime(0.0001, startAt);
    gainNode.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.24);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start(startAt);
    oscillator.stop(startAt + 0.26);
  });
}

toggleEl.addEventListener("click", () => {
  if (state.status === "running") {
    pauseTimer();
  } else {
    startTimer();
  }
});

resetEl.addEventListener("click", resetTimer);

timerInputEl.addEventListener("change", () => {
  if (state.status !== "idle") return;

  const durationMs =
    parseDurationInput(timerInputEl.value) ?? latestDurationMs;

  saveLatestDuration(durationMs);
  state.durationMinutes = durationMs / 60000;
  state.remainingMs = durationMs;

  render();
});

timerInputEl.addEventListener("blur", () => {
  if (state.status === "idle") {
    render();
  }
});

loadState();
render();
