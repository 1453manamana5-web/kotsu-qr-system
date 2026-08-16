type AudioContextConstructor =
  typeof AudioContext;

type SafariWindow =
  Window &
  typeof globalThis & {
    webkitAudioContext?:
      AudioContextConstructor;
  };

type ScheduledTone = {
  frequency: number;
  startDelay: number;
  duration: number;
  volume: number;
  wave: OscillatorType;
};

const QR_DETECTED_SOUND_PATH =
  `${import.meta.env.BASE_URL}sounds/qr_scan_detected.wav?v=20260816-v1`;

const RECORDED_SUCCESS_SOUND_PATH =
  `${import.meta.env.BASE_URL}sounds/qr_result_chime.wav?v=20260816-v1`;

const RECORDED_ERROR_SOUND_PATH =
  `${import.meta.env.BASE_URL}sounds/qr_gate_error_chime_v1.wav?v=20260816-v1`;

let audioContext:
  AudioContext |
  null = null;

let recordedSuccessAudio:
  HTMLAudioElement |
  null = null;

let qrDetectedAudio:
  HTMLAudioElement |
  null = null;

let recordedErrorAudio:
  HTMLAudioElement |
  null = null;

let unlockListenersInstalled =
  false;

let soundUnlocked =
  false;

let warnedAboutBlockedSound =
  false;

const activeOscillators =
  new Set<OscillatorNode>();

function getAudioContextConstructor():
  AudioContextConstructor |
  null {
  if (
    typeof window ===
    "undefined"
  ) {
    return null;
  }

  return (
    window.AudioContext ??
    (
      window as
        SafariWindow
    ).webkitAudioContext ??
    null
  );
}

function getAudioContext():
  AudioContext |
  null {
  if (
    audioContext !==
    null
  ) {
    return audioContext;
  }

  const AudioContextClass =
    getAudioContextConstructor();

  if (
    AudioContextClass ===
    null
  ) {
    console.warn(
      "このブラウザは合成音の再生に対応していません。"
    );

    return null;
  }

  try {
    audioContext =
      new AudioContextClass();

    return audioContext;
  } catch (error) {
    console.error(
      "音声機能を開始できませんでした。",
      error
    );

    return null;
  }
}
function createRecordedAudio(
  soundPath: string
): HTMLAudioElement {
  const audio =
    new Audio(
      soundPath
    );

  audio.preload =
    "auto";

  audio.volume =
    1;

  audio.load();

  return audio;
}

function getQrDetectedAudio():
  HTMLAudioElement |
  null {
  if (
    typeof window ===
    "undefined"
  ) {
    return null;
  }

  if (
    qrDetectedAudio ===
    null
  ) {
    qrDetectedAudio =
      createRecordedAudio(
        QR_DETECTED_SOUND_PATH
      );
  }

  return qrDetectedAudio;
}

function getRecordedSuccessAudio():
  HTMLAudioElement |
  null {
  if (
    typeof window ===
    "undefined"
  ) {
    return null;
  }

  if (
    recordedSuccessAudio !==
    null
  ) {
    return recordedSuccessAudio;
  }

  recordedSuccessAudio =
    createRecordedAudio(
      RECORDED_SUCCESS_SOUND_PATH
    );

  return recordedSuccessAudio;
}

function getRecordedErrorAudio():
  HTMLAudioElement |
  null {
  if (
    typeof window ===
    "undefined"
  ) {
    return null;
  }

  if (
    recordedErrorAudio !==
    null
  ) {
    return recordedErrorAudio;
  }

  recordedErrorAudio =
    createRecordedAudio(
      RECORDED_ERROR_SOUND_PATH
    );

  return recordedErrorAudio;
}

function removeUnlockListeners() {
  if (
    !unlockListenersInstalled
  ) {
    return;
  }

  document.removeEventListener(
    "pointerdown",
    handleUnlockInteraction
  );

  document.removeEventListener(
    "touchend",
    handleUnlockInteraction
  );

  document.removeEventListener(
    "keydown",
    handleUnlockInteraction
  );

  unlockListenersInstalled =
    false;
}

async function handleUnlockInteraction() {
  const unlocked =
    await unlockReceptionSound();

  if (
    unlocked
  ) {
    removeUnlockListeners();
  }
}

export function installReceptionSoundUnlock() {
  if (
    typeof document ===
      "undefined" ||
    unlockListenersInstalled ||
    soundUnlocked
  ) {
    return;
  }

  unlockListenersInstalled =
    true;

  document.addEventListener(
    "pointerdown",
    handleUnlockInteraction,
    {
      passive: true,
    }
  );

  document.addEventListener(
    "touchend",
    handleUnlockInteraction,
    {
      passive: true,
    }
  );

  document.addEventListener(
    "keydown",
    handleUnlockInteraction
  );
}

async function unlockRecordedAudio(
  audio:
    HTMLAudioElement |
    null
):
  Promise<boolean> {
  if (
    audio ===
    null
  ) {
    return false;
  }

  audio.pause();

  audio.currentTime =
    0;

  audio.volume =
    0.01;

  try {
    await audio.play();

    audio.pause();

    audio.currentTime =
      0;

    audio.volume =
      1;

    return true;
  } catch (error) {
    audio.volume =
      1;

    console.warn(
      "QR受付音の有効化に失敗しました。",
      error
    );

    return false;
  }
}

async function unlockAudioContext():
  Promise<boolean> {
  const context =
    getAudioContext();

  if (
    context ===
    null
  ) {
    return false;
  }

  try {
    if (
      context.state !==
      "running"
    ) {
      await context.resume();
    }

    const oscillator =
      context.createOscillator();

    const gain =
      context.createGain();

    const currentTime =
      context.currentTime;

    oscillator.type =
      "sine";

    oscillator.frequency.setValueAtTime(
      440,
      currentTime
    );

    gain.gain.setValueAtTime(
      0.00001,
      currentTime
    );

    oscillator.connect(
      gain
    );

    gain.connect(
      context.destination
    );

    oscillator.start(
      currentTime
    );

    oscillator.stop(
      currentTime +
        0.015
    );

    return (
      context.state ===
      "running"
    );
  } catch (error) {
    console.warn(
      "合成音の有効化に失敗しました。",
      error
    );

    return false;
  }
}

export async function unlockReceptionSound():
  Promise<boolean> {
  /*
    ユーザー操作中に両方の再生開始を要求して、
    iPad・Safariの自動再生制限を解除します。
  */
  const recordedSoundPromise =
    Promise.all([
      unlockRecordedAudio(
        getQrDetectedAudio()
      ),

      unlockRecordedAudio(
        getRecordedSuccessAudio()
      ),

      unlockRecordedAudio(
        getRecordedErrorAudio()
      ),
    ]);

  const audioContextPromise =
    unlockAudioContext();

  const [
    recordedSoundResults,
    audioContextReady,
  ] = await Promise.all([
    recordedSoundPromise,
    audioContextPromise,
  ]);

  soundUnlocked =
    recordedSoundResults.some(
      Boolean
    ) ||
    audioContextReady;

  if (
    soundUnlocked
  ) {
    warnedAboutBlockedSound =
      false;
  }

  return soundUnlocked;
}

async function prepareAudioContext():
  Promise<
    AudioContext |
    null
  > {
  const context =
    getAudioContext();

  if (
    context ===
    null
  ) {
    return null;
  }

  try {
    if (
      context.state !==
      "running"
    ) {
      await context.resume();
    }
  } catch (error) {
    console.warn(
      "音声を再開できませんでした。",
      error
    );
  }

  if (
    context.state !==
    "running"
  ) {
    if (
      !warnedAboutBlockedSound
    ) {
      console.warn(
        "ブラウザの音声制限により再生できません。画面を一度タップしてください。"
      );

      warnedAboutBlockedSound =
        true;
    }

    return null;
  }

  soundUnlocked =
    true;

  return context;
}

async function playRecordedSound(
  audio:
    HTMLAudioElement |
    null
):
  Promise<boolean> {
  if (
    audio ===
    null
  ) {
    return false;
  }

  try {
    audio.pause();

    audio.currentTime =
      0;

    audio.volume =
      1;

    await audio.play();

    soundUnlocked =
      true;

    warnedAboutBlockedSound =
      false;

    return true;
  } catch (error) {
    if (
      !warnedAboutBlockedSound
    ) {
      console.warn(
        "QR受付音を再生できません。画面を一度タップしてください。",
        error
      );

      warnedAboutBlockedSound =
        true;
    }

    installReceptionSoundUnlock();

    return false;
  }
}

function stopActiveSounds() {
  activeOscillators.forEach(
    (oscillator) => {
      try {
        oscillator.stop();
      } catch {
        /*
          すでに停止済みの場合は
          何もしません。
        */
      }

      try {
        oscillator.disconnect();
      } catch {
        /*
          すでに切断済みの場合は
          何もしません。
        */
      }
    }
  );

  activeOscillators.clear();
}

function scheduleTone(
  context: AudioContext,
  tone: ScheduledTone
) {
  const oscillator =
    context.createOscillator();

  const gain =
    context.createGain();

  const startTime =
    context.currentTime +
    tone.startDelay;

  const endTime =
    startTime +
    tone.duration;

  oscillator.type =
    tone.wave;

  oscillator.frequency.setValueAtTime(
    tone.frequency,
    startTime
  );

  gain.gain.setValueAtTime(
    0.0001,
    startTime
  );

  gain.gain.exponentialRampToValueAtTime(
    tone.volume,
    startTime +
      0.012
  );

  gain.gain.setValueAtTime(
    tone.volume,
    Math.max(
      startTime +
        0.012,
      endTime -
        0.025
    )
  );

  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    endTime
  );

  oscillator.connect(
    gain
  );

  gain.connect(
    context.destination
  );

  activeOscillators.add(
    oscillator
  );

  oscillator.addEventListener(
    "ended",
    () => {
      activeOscillators.delete(
        oscillator
      );

      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        /*
          すでに切断済みの場合は
          何もしません。
        */
      }
    },
    {
      once: true,
    }
  );

  oscillator.start(
    startTime
  );

  oscillator.stop(
    endTime +
      0.01
  );
}

async function playToneSequence(
  tones:
    ScheduledTone[]
) {
  const context =
    await prepareAudioContext();

  if (
    context ===
    null
  ) {
    return false;
  }

  stopActiveSounds();

  tones.forEach(
    (tone) => {
      scheduleTone(
        context,
        tone
      );
    }
  );

  return true;
}

/*
  QRコードを読み取った瞬間の短い確認音。
*/
export async function playQrDetectedSound() {
  return playRecordedSound(
    getQrDetectedAudio()
  );
}

/*
  来場者チケットの通常受付成功音。
  結果画面へ切り替わる瞬間にチャイムを再生します。
*/
export async function playReceptionSuccessSound() {
  return playRecordedSound(
    getRecordedSuccessAudio()
  );
}

/*
  再入場も来場者チケットの正常通過なので、
  通常受付と同じ大阪メトロQR改札音を再生します。
*/
export async function playReEntrySound() {
  return playRecordedSound(
    getRecordedSuccessAudio()
  );
}

/*
  部員受付は来場者と聞き分けられるよう、
  従来の柔らかい3音を残します。
*/
export async function playMemberSuccessSound() {
  return playToneSequence([
    {
      frequency:
        1175,

      startDelay:
        0,

      duration:
        0.1,

      volume:
        0.15,

      wave:
        "sine",
    },

    {
      frequency:
        1397,

      startDelay:
        0.14,

      duration:
        0.1,

      volume:
        0.16,

      wave:
        "sine",
    },

    {
      frequency:
        1568,

      startDelay:
        0.28,

      duration:
        0.11,

      volume:
        0.17,

      wave:
        "sine",
    },
  ]);
}

/*
  QR受付エラー時は、下降するオリジナルチャイムを再生します。
*/
export async function playReceptionErrorSound() {
  return playRecordedSound(
    getRecordedErrorAudio()
  );
}

/*
  管理者認証成功音。
*/
export async function playAdminAuthSuccessSound() {
  return playToneSequence([
    {
      frequency:
        1047,

      startDelay:
        0,

      duration:
        0.1,

      volume:
        0.14,

      wave:
        "sine",
    },

    {
      frequency:
        1319,

      startDelay:
        0.13,

      duration:
        0.1,

      volume:
        0.15,

      wave:
        "sine",
    },

    {
      frequency:
        1568,

      startDelay:
        0.26,

      duration:
        0.13,

      volume:
        0.17,

      wave:
        "sine",
    },
  ]);
}

export function stopReceptionSounds() {
  stopActiveSounds();

  if (
    qrDetectedAudio !==
    null
  ) {
    qrDetectedAudio.pause();

    qrDetectedAudio.currentTime =
      0;
  }

  if (
    recordedSuccessAudio !==
    null
  ) {
    recordedSuccessAudio.pause();

    recordedSuccessAudio.currentTime =
      0;
  }

  if (
    recordedErrorAudio !==
    null
  ) {
    recordedErrorAudio.pause();

    recordedErrorAudio.currentTime =
      0;
  }
}

export async function closeReceptionAudio() {
  removeUnlockListeners();

  stopReceptionSounds();

  recordedSuccessAudio =
    null;

  qrDetectedAudio =
    null;

  recordedErrorAudio =
    null;

  const context =
    audioContext;

  audioContext =
    null;

  soundUnlocked =
    false;

  if (
    context ===
      null ||
    context.state ===
      "closed"
  ) {
    return;
  }

  try {
    await context.close();
  } catch (error) {
    console.warn(
      "音声機能を終了できませんでした。",
      error
    );
  }
}
