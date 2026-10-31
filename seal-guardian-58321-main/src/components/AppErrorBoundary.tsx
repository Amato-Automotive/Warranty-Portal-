import { Component, type ReactNode } from "react";

/**
 * A screen that fails while drawing shows what went wrong and a way back,
 * instead of leaving the whole site white. The message is what to send to
 * whoever fixes it.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: { componentStack?: string | null }) {
        console.error("[AppErrorBoundary]", error, info?.componentStack);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#f8fafc", fontFamily: "system-ui, sans-serif" }}>
                <div style={{ maxWidth: 520, width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 24 }}>
                    <h1 style={{ margin: 0, fontSize: 20, color: "#0f172a" }}>This page could not open</h1>
                    <p style={{ marginTop: 8, fontSize: 14, color: "#475569" }}>Reload to try again. If it keeps happening, send this message to the team:</p>
                    <pre style={{ marginTop: 12, padding: 12, background: "#f1f5f9", borderRadius: 8, fontSize: 12, color: "#b91c1c", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {`${error.name}: ${error.message}\n${window.location.pathname}`}
                    </pre>
                    <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => window.location.reload()}
                            style={{ minHeight: 44, padding: "0 20px", borderRadius: 12, border: 0, background: "#f97316", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                            Reload
                        </button>
                        <button type="button" onClick={() => { window.location.href = "/"; }}
                            style={{ minHeight: 44, padding: "0 20px", borderRadius: 12, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer" }}>
                            Go to the start
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
