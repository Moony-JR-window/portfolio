import React from "react";

interface Props {
    showCommands: boolean;
    showBotMenu: boolean;
    onOpenBot: () => void;
    onCloseBot: () => void;
    onAI?: () => void;
    onQA?: () => void;
}

const itemStyle: React.CSSProperties = {
    width: "100%",
    border: "none",
    padding: 12,
    cursor: "pointer",
    textAlign: "left",
    borderBottom: "1px solid #eee",
};

export default function BotCommandMenu({
    showCommands,
    showBotMenu,
    onOpenBot,
    onCloseBot,
    onAI,
    onQA,
}: Props) {
    if (!showCommands && !showBotMenu) return null;

    return (
        <div
            className="backdrop-blur-md"
            style={{
                position: "absolute",
                left: 8,
                right: 8,
                bottom: 58,
                border: "1px solid #ddd",
                borderRadius: 10,
                overflow: "hidden",
                boxShadow: "0 10px 25px rgba(0,0,0,.15)",
                zIndex: 999,
            }}
        >
            {showCommands && !showBotMenu && (
                <>
                <button
                    className=" bg-gray-700 "
                    onClick={onOpenBot}
                    style={{
                        width: "100%",
                        border: "none",
                        padding: 12,
                        cursor: "pointer",
                        textAlign: "left",
                    }}
                >
                    <div style={{ fontWeight: 600 }}>🤖 Bot</div>
                    <div
                        style={{
                            fontSize: 12,
                            color: "#777",
                            marginTop: 4,
                        }}
                    >
                        Download tools & templates
                    </div>
                </button>

                <button
                    className=" bg-gray-700 "
                    onClick={onAI}
                    style={{
                        width: "100%",
                        border: "none",
                        padding: 12,
                        cursor: "pointer",
                        textAlign: "left",
                    }}
                >
                    <div style={{ fontWeight: 600 }}>✨ AI Assistant</div>
                    <div
                        style={{
                            fontSize: 12,
                            color: "#777",
                            marginTop: 4,
                        }}
                    >
                        Ask anything — type /ai &lt;question&gt; (free AI)
                    </div>
                </button>

                <button
                    className=" bg-gray-700 "
                    onClick={onQA}
                    style={{
                        width: "100%",
                        border: "none",
                        padding: 12,
                        cursor: "pointer",
                        textAlign: "left",
                    }}
                >
                    <div style={{ fontWeight: 600 }}>📊 Excel QA</div>
                    <div
                        style={{
                            fontSize: 12,
                            color: "#777",
                            marginTop: 4,
                        }}
                    >
                        Unmerge + rename Service_Name — AI Fix verify — type /qa
                    </div>
                </button>
                </>
            )}

            {showBotMenu && (
                <>
                    <div
                        className="relative overflow-hidden rounded-t-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-5 py-4 text-white"
                    >
                        {/* Background Glow */}
                        <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10 blur-xl" />
                        <div className="absolute -left-8 bottom-0 h-16 w-16 rounded-full bg-white/5 blur-lg" />

                        <div className="relative flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-xl backdrop-blur-sm">
                                🤖
                            </div>

                            <div className="flex-1">
                                <h2 className="text-lg font-bold tracking-wide">
                                    Welcome to My Bot
                                </h2>

                                <div className="mt-1 flex items-center gap-2 text-sm text-white/80">
                                    <span>Ready to help</span>

                                    {/* Typing Animation */}
                                    <div className="flex gap-1">
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white [animation-delay:0ms]" />
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white [animation-delay:150ms]" />
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white [animation-delay:300ms]" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button
                        className=" bg-gray-700 "
                        style={itemStyle}
                        onClick={() =>
                            window.open(
                                "https://github.com/user-attachments/files/30728375/adbTool.zip",
                                "_blank"
                            )
                        }
                    >
                        📦 ADB Tool
                    </button>

                    <button
                        className=" bg-gray-700 "
                        style={itemStyle}
                        onClick={() => window.open("/automation-lib", "_blank")}
                    >
                        📚 Automation Library
                    </button>

                    <details>
                        <summary
                            className=" bg-gray-700 " style={{ padding: 12, cursor: "pointer" }}>
                            📄 Template Excel
                        </summary>

                        <button
                            className=" bg-gray-700 "
                            style={itemStyle}
                            onClick={() => window.open("/downloads/wingpay.xlsx")}
                        >
                            🏦 WingPay
                        </button>

                        <button
                            className=" bg-gray-700 "
                            style={itemStyle}
                            onClick={() => window.open("/downloads/wingbank.xlsx")}
                        >
                            🏛️ WingBank
                        </button>
                    </details>

                    <button
                        className=" bg-gray-700 "
                        style={{
                            width: "100%",
                            border: "none",
                            padding: 10,
                            cursor: "pointer",
                        }}
                        onClick={onCloseBot}
                    >
                        Close
                    </button>
                </>
            )}
        </div>
    );
}