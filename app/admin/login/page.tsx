"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) });
    if (r.ok) router.push("/admin");
    else setErr("Invalid credentials");
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500">
      <form onSubmit={submit} className="p-8 space-y-4 bg-white/90 backdrop-blur rounded-2xl shadow-2xl w-96">
        <h1 className="text-2xl font-bold text-gray-800">Admin Login</h1>
        <input className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="username" value={u} onChange={e=>setU(e.target.value)} />
        <input className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" type="password" placeholder="password" value={p} onChange={e=>setP(e.target.value)} />
        {err && <p className="text-red-500 text-sm">{err}</p>}
        <button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-lg font-semibold transition">Login</button>
      </form>
    </div>
  );
}
