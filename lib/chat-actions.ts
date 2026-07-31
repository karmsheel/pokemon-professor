export function isStartGameIntent(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!]+$/g, "");
  if (!t) return false;
  if (t === "start" || t === "start game" || t === "start the game") return true;
  if (t === "let's play" || t === "lets play" || t === "let us play") return true;
  if (t === "begin" || t === "begin game") return true;
  return false;
}

export function welcomeMessage(): string {
  return [
    "Welcome, Professor. I'm your disciple via Hermes — I'll play Pokémon FireRed while you coach.",
    "You must provide your own legally obtained FireRed .gba ROM (this app never ships or downloads ROMs).",
    "Next: load your ROM if needed, then use Start game. I'll take control in agent mode and check in when something important happens or I'm stuck.",
  ].join(" ");
}

export function romNeededMessage(): string {
  return "No FireRed ROM is loaded yet. Use Load FireRed ROM… to pick your .gba file.";
}

export function romReadyMessage(romFileName: string): string {
  return `ROM ready: ${romFileName}. Click Start game when you want me to begin.`;
}

export function gameStartedKickoffMessage(): string {
  return "Game started. Take it from the title screen: observe via the Control API, play in agent mode, and message me only for progress, trouble, or when I ask.";
}
