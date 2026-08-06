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
  wave:
    | OscillatorType;
};

let audioContext:
  AudioContext |
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
      "このブラウザは音声再生に対応していません。"
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

export async function unlockReceptionSound():
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

    /*
      iPad・Safariの音声制限を解除するため、
      聞こえないほど小さい音を一瞬だけ再生します。
    */
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

    soundUnlocked =
      context.state ===
      "running";

    if (
      soundUnlocked
    ) {
      warnedAboutBlockedSound =
        false;
    }

    return soundUnlocked;
  } catch (error) {
    console.warn(
      "音声の有効化に失敗しました。",
      error
    );

    return false;
  }
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

  /*
    音の最初と最後を少し滑らかにして、
    ノイズが出にくいようにします。
  */
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
          切断済みの場合は
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
  チケット・部員の受付成功音

  高めの音を3回鳴らす、
  改札機に近い「ピ・ピ・ピ」という音です。
*/
export async function playReceptionSuccessSound() {
  return playToneSequence([
    {
      frequency:
        1568,

      startDelay:
        0,

      duration:
        0.085,

      volume:
        0.16,

      wave:
        "triangle",
    },

    {
      frequency:
        1568,

      startDelay:
        0.145,

      duration:
        0.085,

      volume:
        0.16,

      wave:
        "triangle",
    },

    {
      frequency:
        1568,

      startDelay:
        0.29,

      duration:
        0.095,

      volume:
        0.17,

      wave:
        "triangle",
    },
  ]);
}

/*
  再入場時の音

  通常受付より少しだけ高くして、
  聞き分けられるようにします。
*/
export async function playReEntrySound() {
  return playToneSequence([
    {
      frequency:
        1661,

      startDelay:
        0,

      duration:
        0.08,

      volume:
        0.15,

      wave:
        "triangle",
    },

    {
      frequency:
        1661,

      startDelay:
        0.13,

      duration:
        0.08,

      volume:
        0.15,

      wave:
        "triangle",
    },

    {
      frequency:
        1865,

      startDelay:
        0.26,

      duration:
        0.1,

      volume:
        0.17,

      wave:
        "triangle",
    },
  ]);
}

/*
  部員受付の成功音

  来場者チケットより少し柔らかい音です。
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
  QR受付エラー音

  低い音を2回鳴らして、
  成功音とすぐ区別できるようにします。
*/
export async function playReceptionErrorSound() {
  return playToneSequence([
    {
      frequency:
        440,

      startDelay:
        0,

      duration:
        0.16,

      volume:
        0.17,

      wave:
        "square",
    },

    {
      frequency:
        330,

      startDelay:
        0.2,

      duration:
        0.2,

      volume:
        0.18,

      wave:
        "square",
    },
  ]);
}

/*
  管理者認証成功音
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
}

export async function closeReceptionAudio() {
  removeUnlockListeners();

  stopActiveSounds();

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
