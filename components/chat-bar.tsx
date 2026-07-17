"use client";

export function ChatBar() {
  return (
    <footer className="chat-bar">
      <label htmlFor="hermes-chat">Chat</label>
      <textarea
        id="hermes-chat"
        placeholder="Hermes chat connects in Task 8"
        disabled
        readOnly
      />
      <p className="muted" style={{ margin: "0.4rem 0 0" }}>
        Stub — agent chat / Hermes bridge lands in Task 8.
      </p>
    </footer>
  );
}
