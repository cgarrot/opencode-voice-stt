// Runtime, user-facing strings. English is the default and the source of
// truth; additional locale packs override individual keys. The product name
// ("OpenCode Voice STT") is treated as a brand and is intentionally never localized.
//
// Code, comments and commit messages stay in English. Locales only change what
// the end user sees at runtime, selected with the top-level `locale` setting
// (or the OPENCODE_STT_LOCALE environment variable).

export type Strings = {
  /** Always-visible status shown in the prompt border. */
  indicator: {
    idle: string;
    recording: string;
    recordingHint: string;
    transcribing: string;
    transcribingHint: string;
    polishing: string;
    polishingHint: string;
  };
  /** Transient toast notifications. */
  toast: {
    stopping: string;
    sent: string;
    inserted: string;
    emptyTranscript: string;
    startRecording: (keybind: string) => string;
    stillProcessing: string;
    recordingCancelled: string;
    transcriptionCancelled: string;
    cleanupFailed: string;
    cleared: string;
  };
  /** Profile switching menu and toasts. */
  profile: {
    menuTitle: string;
    activeMarker: string;
    set: (name: string) => string;
    unknown: (name: string) => string;
    list: (current: string, names: string[]) => string;
    none: string;
    persistFailed: string;
    busy: string;
  };
};

export const DEFAULT_LOCALE = "en";

const en: Strings = {
  indicator: {
    idle: "voice",
    recording: "recording",
    recordingHint: "· enter send · esc cancel",
    transcribing: "transcribing",
    transcribingHint: "· esc cancel",
    polishing: "polishing",
    polishingHint: "· esc cancel",
  },
  toast: {
    stopping: "Stopping recording and transcribing…",
    sent: "Transcript sent to chat.",
    inserted: "Transcript inserted into prompt.",
    emptyTranscript: "Transcript is empty; nothing to send.",
    startRecording: (keybind) => `Recording… press ${keybind} again to stop, Enter to send, or Esc to cancel.`,
    stillProcessing: "Still processing the previous recording…",
    recordingCancelled: "Recording cancelled.",
    transcriptionCancelled: "Transcription cancelled.",
    cleanupFailed: "Cleanup failed; using the raw transcript.",
    cleared: "Transcript discarded.",
  },
  profile: {
    menuTitle: "Select STT profile",
    activeMarker: "active",
    set: (name) => `Profile "${name}" selected; it applies to the next recording.`,
    unknown: (name) => `Unknown profile "${name}".`,
    list: (current, names) => `STT profile: ${current} · available: ${names.join(", ")}`,
    none: "No profiles defined. Add a top-level \"profiles\" section to your STT config.",
    persistFailed: "Could not persist the profile; it applies to this session only.",
    busy: "Cannot switch profile while transcribing.",
  },
};

const fr: Strings = {
  indicator: {
    idle: "voix",
    recording: "enregistrement",
    recordingHint: "· entrée envoie · esc annule",
    transcribing: "transcription",
    transcribingHint: "· esc annule",
    polishing: "nettoyage",
    polishingHint: "· esc annule",
  },
  toast: {
    stopping: "Arrêt de l'enregistrement et transcription…",
    sent: "Transcription envoyée au chat.",
    inserted: "Transcription insérée dans le prompt.",
    emptyTranscript: "Transcription vide ; rien à envoyer.",
    startRecording: (keybind) => `Enregistrement… appuie sur ${keybind} pour arrêter, Entrée pour envoyer, ou Échap pour annuler.`,
    stillProcessing: "Traitement du précédent enregistrement en cours…",
    recordingCancelled: "Enregistrement annulé.",
    transcriptionCancelled: "Transcription annulée.",
    cleanupFailed: "Échec du nettoyage ; transcription brute utilisée.",
    cleared: "Transcription ignorée.",
  },
  profile: {
    menuTitle: "Choisir le profil STT",
    activeMarker: "actif",
    set: (name) => `Profil "${name}" sélectionné ; il s'applique au prochain enregistrement.`,
    unknown: (name) => `Profil inconnu "${name}".`,
    list: (current, names) => `Profil STT : ${current} · disponibles : ${names.join(", ")}`,
    none: "Aucun profil défini. Ajoute une section \"profiles\" de premier niveau à ta config STT.",
    persistFailed: "Impossible de persister le profil ; il ne s'applique qu'à cette session.",
    busy: "Impossible de changer de profil pendant la transcription.",
  },
};

const packs: Record<string, Strings> = { en, fr };

/** List of locales that ship with a built-in pack. */
export const availableLocales = Object.keys(packs);

/**
 * Resolve the string pack for a locale, falling back to English for unknown
 * or empty values. Matching is case-insensitive and ignores region suffixes
 * (e.g. "fr-FR" resolves to the "fr" pack).
 */
export const resolveStrings = (locale: string | undefined): Strings => {
  const normalized = (locale ?? "").trim().toLowerCase();
  if (!normalized) return en;
  return packs[normalized] ?? packs[normalized.split(/[-_]/)[0] ?? ""] ?? en;
};
