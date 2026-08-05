import React from "react";

interface Props {
    showCommands: boolean;
    showBotMenu: boolean;
    onOpenBot: () => void;
    onCloseBot: () => void;
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
            )}

            {showBotMenu && (
                <>
                    <div
                        className=" bg-gray-700 "
                        style={{
                            padding: 12,
                            fontWeight: 700,
                            borderBottom: "1px solid #eee",
                        }}
                    >
                        🤖 ADB Tool Bot
                    </div>

                    <button
                        className=" bg-gray-700 "
                        style={itemStyle}
                        onClick={() =>
                            window.open(
                                "https://github.com/user-attachments/files/30727516/adbTool.zip",
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