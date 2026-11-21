// Saved characters in browser storage (against an in-memory stand-in): saving, listing newest first, loading,
// removing, running out of room without leaving half a save, rebuilding a lost index, and hearing other tabs.
import { describe, expect, it } from "vitest";
import { newCharacterDocument, setName, type CharacterDocument } from "../core";
import { LocalStore, MemoryStorage, StorageFullError } from "./store";

const doc = (id: string, at: string, name = id): CharacterDocument =>
  setName(newCharacterDocument({ id, system: { id: "dnd5e-2014", version: 1 }, packs: [], now: at }), name, at);

describe("LocalStore", () => {
  it("saves, lists newest first, loads and removes", async () => {
    const storage = new MemoryStorage();
    const store = new LocalStore(storage);
    expect(await store.list()).toEqual([]);
    await store.save(doc("a", "2026-11-18T10:00:00.000Z", "Borin"), { text: "Dwarf Cleric 1" });
    await store.save(doc("b", "2026-11-20T10:00:00.000Z", "Ilvaren"), { text: "Elf Wizard 1", picture: "data:image/jpeg;base64,AA==" });
    expect(await store.list()).toEqual([
      { id: "b", name: "Ilvaren", text: "Elf Wizard 1", picture: "data:image/jpeg;base64,AA==", system: "dnd5e-2014", updatedAt: "2026-11-20T10:00:00.000Z" },
      { id: "a", name: "Borin", text: "Dwarf Cleric 1", system: "dnd5e-2014", updatedAt: "2026-11-18T10:00:00.000Z" },
    ]);
    expect(await store.load("a")).toEqual(doc("a", "2026-11-18T10:00:00.000Z", "Borin"));
    expect(storage.getItem("anvil:character:a")).not.toBeNull();

    await store.save(doc("a", "2026-11-21T10:00:00.000Z", "Borin Stonehelm"), { text: "Hill Dwarf Cleric 1" });
    expect((await store.list()).map((s) => [s.id, s.name])).toEqual([["a", "Borin Stonehelm"], ["b", "Ilvaren"]]);

    await store.remove("a");
    expect((await store.list()).map((s) => s.id)).toEqual(["b"]);
    expect(await store.load("a")).toBeUndefined();
  });

  it("when storage is full, says so and leaves the last good save in place", async () => {
    const store = new LocalStore(new MemoryStorage(2_000));
    const first = doc("a", "2026-11-18T10:00:00.000Z", "Borin");
    await store.save(first, { text: "" });
    const huge = { ...first, name: "Borin", choices: { "details.notes": "x".repeat(5_000) }, updatedAt: "2026-11-19T10:00:00.000Z" };
    await expect(store.save(huge, { text: "" })).rejects.toBeInstanceOf(StorageFullError);
    expect(await store.load("a")).toEqual(first);
    expect((await store.list())[0].updatedAt).toBe("2026-11-18T10:00:00.000Z");
    await expect(store.save(doc("new", "2026-11-19T10:00:00.000Z", "y".repeat(5_000)), { text: "" })).rejects.toBeInstanceOf(StorageFullError);
    expect(await store.load("new")).toBeUndefined();
  });

  it("rebuilds a lost or damaged index from the characters themselves", async () => {
    const storage = new MemoryStorage();
    const store = new LocalStore(storage);
    await store.save(doc("a", "2026-11-18T10:00:00.000Z", "Borin"), { text: "Dwarf Cleric 1" });
    storage.setItem("anvil:characters", "{ damaged");
    expect(await store.list()).toEqual([{ id: "a", name: "Borin", text: "", system: "dnd5e-2014", updatedAt: "2026-11-18T10:00:00.000Z" }]);
    storage.removeItem("anvil:characters");
    expect((await store.list()).map((s) => s.name)).toEqual(["Borin"]);
  });

  it("hands back a damaged file as it is, for the reader to report", async () => {
    const storage = new MemoryStorage();
    storage.setItem("anvil:character:x", "{ damaged");
    expect(await new LocalStore(storage).load("x")).toBe("{ damaged");
  });

  it("hears saves and removals from other tabs, for characters only", () => {
    const target = new EventTarget();
    const heard: string[] = [];
    const stop = new LocalStore(new MemoryStorage(), target).watch((id) => heard.push(id));
    const fire = (key: string | null) => target.dispatchEvent(Object.assign(new Event("storage"), { key }));
    fire("anvil:character:abc");
    fire("anvil:characters");
    fire("something-else");
    fire(null); // storage cleared
    stop();
    fire("anvil:character:later");
    expect(heard).toEqual(["abc"]);
  });
});
