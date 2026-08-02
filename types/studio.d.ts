export {};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type Student = {
  id: string;
  name: string;
  avatar: "boy" | "girl";
  backstory: string;
  harness: "hermes-acp";
  createdAt: string;
  updatedAt: string;
  lastUsedSaveId: string | null;
};

declare global {
  interface Window {
    studio?: {
      getControlUrl: () => Promise<string>;
      getPaths: () => Promise<unknown>;
      getEmulatorInfo: () => Promise<{
        choice: "mock" | "mgba";
        backendKind: "mock" | "mgba";
        mgbaPresent: boolean;
        mgbaPath: string | null;
        scriptPath: string | null;
        env: string | null;
        bridgeUp: boolean;
        bridgePort: number | null;
        romLoaded: boolean;
      }>;
      ensureMgba: () => Promise<{
        ok: true;
        downloaded: boolean;
        path: string;
        backendKind: "mock" | "mgba";
      }>;
      createRun: (romPath: string) => Promise<{
        id: string;
        connect?: "attach" | "spawn" | "mock";
      }>;
      startGame: (romPath?: string | null) => Promise<{
        id: string;
        rom_path: string;
        connect: "attach" | "spawn" | "mock";
        mode: "agent";
      }>;
      attachBridge: (romPath?: string | null) => Promise<{
        id: string;
        rom_path: string;
        connect: "attach";
      }>;
      listRuns: () => Promise<
        Array<{
          id: string;
          rom_path: string;
          created_at: string;
          status: string;
          savestates: string[];
        }>
      >;
      resumeRun: (runId: string) => Promise<{
        id: string;
        rom_path: string;
        loadedSavestate: string | null;
      }>;
      addMission: (runId: string, prompt: string) => Promise<unknown>;
      setMode: (mode: "agent" | "nudge" | "drive") => Promise<string>;
      save: (name: string) => Promise<unknown>;
      load: (name: string) => Promise<unknown>;
      pickRom: () => Promise<string | null>;
      driveInput: (buttons: string[]) => Promise<{ ok: true }>;
      getSettings: () => Promise<{
        hermes: { baseUrl: string; apiKey: string; model: string };
        lastRomPath: string | null;
      }>;
      setHermesSettings: (partial: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
      }) => Promise<{
        hermes: { baseUrl: string; apiKey: string; model: string };
        lastRomPath: string | null;
      }>;
      setLastRomPath: (romPath: string | null) => Promise<{
        hermes: { baseUrl: string; apiKey: string; model: string };
        lastRomPath: string | null;
      }>;
      openHermesDocs: () => Promise<void>;
      restartHermesGateway: (override?: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
      }) => Promise<{ ok: boolean; message: string; cli?: string }>;
      detectHermesEnv: () => Promise<{
        apiKeyConfigured: boolean;
        apiKeySource: "user" | "env" | "hermes-env" | "none";
        filled: { baseUrl: string; apiKey: string; model: string };
        detected: {
          apiKey: string;
          baseUrl: string | null;
          source: string | null;
        };
      }>;
      probeHermes: (override?: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
      }) => Promise<{
        ok: boolean;
        error?: string;
        hint?: string;
        apiKeySource?: string;
        cli?: string;
      }>;
      probeHermesAcp: () => Promise<{
        ok: boolean;
        error?: string;
        hint?: string;
        cli?: string;
        checkOutput?: string;
      }>;

      listStudents: () => Promise<{
        students: Student[];
        activeStudentId: string | null;
        metGa: boolean;
      }>;
      setMetGa: (met: boolean) => Promise<unknown>;
      createStudent: (input: {
        name: string;
        avatar: "boy" | "girl";
        backstory?: string;
      }) => Promise<Student>;
      updateStudent: (
        id: string,
        patch: Partial<{
          name: string;
          avatar: "boy" | "girl";
          backstory: string;
        }>
      ) => Promise<Student>;
      setActiveStudent: (id: string | null) => Promise<unknown>;
      /** Global GA thread (one infinite conversation). */
      getGaThread: () => Promise<ChatMessage[]>;
      ensureGa: () => Promise<ChatMessage[]>;
      getStudentPlaySession: (studentId: string) => Promise<{
        provisional: boolean;
        save: unknown;
        session: { messages: ChatMessage[] } | null;
        gameStarted?: boolean;
      } | null>;
      sendGaMessage: (text: string) => Promise<ChatMessage>;
      sendStudentMessage: (
        studentId: string,
        text: string
      ) => Promise<ChatMessage>;
      startStudentPlay: (
        studentId: string,
        opts?: { missionBrief?: string }
      ) => Promise<{
        provisional: boolean;
        session: { messages: ChatMessage[] };
        student: Student;
      }>;
      seedStudentIntro: (
        studentId: string,
        messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
      ) => Promise<unknown>;
      completeStudentCutscene: (input: {
        name: string;
        avatar: "boy" | "girl";
        missionBrief: string;
        introMessages: Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>;
      }) => Promise<{
        student: Student;
        provisional: boolean;
        session: { messages: ChatMessage[] };
      }>;
      stopStudentPlay: () => Promise<{ discardedProvisional: boolean }>;
      consumeProvisionalDiscardToast: () => Promise<{ message: string } | null>;
      onAgentEvent: (cb: (payload: unknown) => void) => () => void;
      onFirstSavePromoted: (cb: (payload: unknown) => void) => () => void;
    };
  }
}
