import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type UrlEntry = {
  id: string;
  slug: string;
  originalUrl: string;
  createdAt: string;
};

const FILE = path.join(process.cwd(), "_url.json");

function read(): UrlEntry[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, "utf8");
    return JSON.parse(raw) as UrlEntry[];
  } catch {
    return [];
  }
}

function write(entries: UrlEntry[]) {
  fs.writeFileSync(FILE, JSON.stringify(entries, null, 2), "utf8");
}

export function getAll(): UrlEntry[] {
  return read();
}

export function findBySlug(slug: string): UrlEntry | undefined {
  return read().find((e) => e.slug === slug);
}

export function add(slug: string, originalUrl: string): UrlEntry {
  const entries = read();
  if (entries.some((e) => e.slug === slug)) throw new Error("slug exists");
  const entry: UrlEntry = { id: randomUUID(), slug, originalUrl, createdAt: new Date().toISOString() };
  entries.push(entry);
  write(entries);
  return entry;
}

export function remove(id: string) {
  const entries = read().filter((e) => e.id !== id);
  write(entries);
}