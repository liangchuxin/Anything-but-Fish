import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { gameRequest, saveGame, loadGame, updateSettings } from "../src/lib/game-api.js";

afterEach(() => mock.restoreAll());

test("game requests use the API and preserve the cookie and cancellation contract", async () => {
  const signal = new AbortController().signal;
  const response = { characters: [{ name: "preview-character", displayName: "Preview character" }] };
  mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/game/characters");
    assert.equal(options.credentials, "include");
    assert.equal(options.signal, signal);
    assert.equal(options.headers.Accept, "application/json");
    return Response.json(response);
  });
  assert.deepEqual(await gameRequest("characters", { signal }), response);
});

test("empty lists are valid API responses, not errors or a reason to use fallback records", async () => {
  const responses = { plots: { categories: [] }, collections: { items: [] }, characters: { characters: [] } };
  mock.method(globalThis, "fetch", async (url) => Response.json(responses[url.split("/").pop()]));
  for (const [resource, response] of Object.entries(responses)) {
    assert.deepEqual(await gameRequest(resource), response);
  }
});

test("a static host's HTML fallback and malformed records report an error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("<!doctype html><title>App</title>"));
  await assert.rejects(gameRequest("plots"), /invalid response/);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ categories: [{ id: "characters", title: "Characters" }] }));
  await assert.rejects(gameRequest("plots"), /invalid response/);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ items: [{ id: "photo-1", title: "Missing description" }] }));
  await assert.rejects(gameRequest("collections"), /invalid response/);
});

test("invalid progress cannot silently render as collected counts", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ categories: [{
    id: "objects", title: "Objects", entries: [{ id: "item", title: "Item", total: 1, collected: 2, description: [] }],
  }] }));
  await assert.rejects(gameRequest("plots"), /invalid response/);
});

test("failed HTTP and network requests report failure instead of returning sample content", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ detail: "Internal failure" }, { status: 503 }));
  await assert.rejects(gameRequest("collections"), /Unable to load/);
  globalThis.fetch.mock.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(gameRequest("collections"), /Unable to load/);
});

test("cancellation stays distinguishable from a server error", async () => {
  const abort = new DOMException("Aborted", "AbortError");
  mock.method(globalThis, "fetch", async () => { throw abort; });
  await assert.rejects(gameRequest("characters"), (error) => error === abort);
});

test("new game reads validate inventory, settings, and save slots", async () => {
  const responses = {
    inventory: { capacity: 20, items: [{ id: "key", name: "Key", type: "Key", count: 1, description: "An old key.", icon: "key" }] },
    settings: { settings: { soundVolume: 70, ambientVolume: 50, language: "en" } },
    saves: { slots: [{ id: "slot-1", save: { chapterTitle: "The Coin", page: 1, savedAt: "2026-11-04T14:30:00.000Z" } }, { id: "slot-2", save: null }] },
  };
  mock.method(globalThis, "fetch", async (url) => Response.json(responses[url.split("/").pop()]));
  for (const [resource, response] of Object.entries(responses)) {
    assert.deepEqual(await gameRequest(resource), response);
  }
  responses.inventory.items[0].icon = "unsupported";
  await assert.rejects(gameRequest("inventory"), /invalid response/);
  responses.settings.settings.ambientVolume = 101;
  await assert.rejects(gameRequest("settings"), /invalid response/);
  responses.saves.slots[0].save.savedAt = "not a date";
  await assert.rejects(gameRequest("saves"), /invalid response/);
});

test("write helpers preserve JSON, cookie, cache, and cancellation contracts", async () => {
  const signal = new AbortController().signal;
  const position = { chapterTitle: "The Coin", page: 4 };
  const settings = { soundVolume: 25, ambientVolume: 50, language: "zh" };
  const slots = [{ id: "slot-3", save: { ...position, savedAt: "2026-11-09T12:00:00.000Z" } }];
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.signal, signal);
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Accept, "application/json");
    if (options.body !== undefined) assert.equal(options.headers["Content-Type"], "application/json");
    if (url.endsWith("/load")) return Response.json(position);
    if (url.endsWith("/settings")) return Response.json({ settings });
    return Response.json({ slots });
  });
  assert.deepEqual(await saveGame("slot-3", position, { signal }), { slots });
  assert.deepEqual(await loadGame("slot-3", { signal }), position);
  assert.deepEqual(await updateSettings(settings, { signal }), { settings });
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method, options.body]), [
    ["/api/game/saves/slot-3", "PUT", JSON.stringify(position)],
    ["/api/game/saves/slot-3/load", "POST", undefined],
    ["/api/game/settings", "PATCH", JSON.stringify(settings)],
  ]);
});

test("gameRequest supports explicit methods and bodies without changing the default GET", async () => {
  const settings = { soundVolume: 20, ambientVolume: 30, language: "en" };
  const methods = [];
  mock.method(globalThis, "fetch", async (_url, options) => {
    methods.push(options.method);
    if (options.method === "PATCH") assert.equal(options.body, JSON.stringify(settings));
    return Response.json({ settings });
  });
  await gameRequest("settings");
  await gameRequest("settings", { method: "PATCH", body: settings });
  assert.deepEqual(methods, ["GET", "PATCH"]);
});

test("save helpers report empty, missing, invalid, and failed requests clearly", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ detail: "empty" }, { status: 409 }));
  await assert.rejects(loadGame("slot-3"), (error) => error.status === 409 && /slot is empty/.test(error.message));
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ detail: "missing" }, { status: 404 }));
  await assert.rejects(loadGame("slot-9"), (error) => error.status === 404 && /could not be found/.test(error.message));
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ detail: "bad" }, { status: 400 }));
  await assert.rejects(updateSettings({}), /values are invalid/);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({}, { status: 503 }));
  await assert.rejects(saveGame("slot-1", { chapterTitle: "The Coin", page: 1 }), /Unable to save your progress/);
  await assert.rejects(saveGame("../auth", {}), /valid save slot/);
});

test("mutation responses are schema checked and cancellation also survives JSON parsing", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ chapterTitle: "The Coin", page: 0 }));
  await assert.rejects(loadGame("slot-1"), /invalid response/);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ settings: { volume: 70, darkMode: false } }));
  await assert.rejects(updateSettings({}), /invalid response/);
  const aborted = new DOMException("Aborted", "AbortError");
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => { throw aborted; } }));
  await assert.rejects(loadGame("slot-1"), (error) => error === aborted);
});
