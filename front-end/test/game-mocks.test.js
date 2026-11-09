import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, beforeEach, test } from "node:test";
import { setupServer } from "msw/node";
import { createGameHandlers } from "../src/mocks/handlers.js";
import { plotCatalog } from "../src/mocks/fixtures/catalog.js";
import { previewProfiles } from "../src/mocks/fixtures/profiles.js";

const baseUrl = "http://game.test/api";
const server = setupServer();
const blockedTransportMessage = "Test-only guard stopped an unhandled request before network access.";
let unhandledRequests = [];

before(() => {
  server.listen({
    onUnhandledFrame({ frame }) {
      // Record unmatched traffic without letting Node connect to an external host.
      const { request } = frame.data;
      unhandledRequests.push({ method: request.method, url: request.url });
      throw new Error(blockedTransportMessage);
    },
  });
});

beforeEach(() => {
  unhandledRequests = [];
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0 }));
});

after(() => {
  server.close();
});

async function get(resource) {
  const response = await fetch(`${baseUrl}/game/${resource}`);
  return { response, data: await response.json() };
}

async function write(resource, method, body) {
  const response = await fetch(`${baseUrl}/game/${resource}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { response, data: await response.json() };
}

test("demo serves the existing game contracts without unhandled requests", async () => {
  const plots = await get("plots");
  assert.equal(plots.response.status, 200);
  assert.deepEqual(plots.data.categories.map(({ id, title, entries }) => [id, title, entries.length]), [
    ["characters", "Characters", 8], ["chapters", "Chapters", 6], ["objects", "Objects", 6],
  ]);
  for (const { entries } of plots.data.categories) {
    for (const entry of entries) {
      assert.deepEqual(Object.keys(entry).sort(), ["collected", "description", "id", "title", "total"]);
      assert.equal(typeof entry.id, "string");
      assert.equal(typeof entry.title, "string");
      assert.ok(Number.isInteger(entry.collected) && entry.collected > 0 && entry.collected <= entry.total);
      assert.ok(Array.isArray(entry.description) && entry.description.every((text) => typeof text === "string"));
    }
  }
  const collections = await get("collections");
  assert.equal(collections.response.status, 200);
  assert.deepEqual(collections.data.items.map(({ id, title }) => [id, title]), [
    ["photo-1", "Ancient gold coin"], ["photo-2", "White bench"], ["photo-3", "?"],
  ]);
  assert.ok(collections.data.items.every((item) => typeof item.description === "string" && !Object.hasOwn(item, "image")));
  const characters = await get("characters");
  assert.equal(characters.response.status, 200);
  assert.deepEqual(characters.data, { characters: [{ name: "cislo", displayName: "Cislobog Raskolnikova" }] });
  assert.equal(plots.response.headers.get("Cache-Control"), "no-store");
  assert.equal(plots.response.headers.get("X-Mock-Data"), "shared-preview");
  assert.deepEqual(unhandledRequests, []);
});

test("responses derive visibility and counts from preview progress rather than content definitions", async () => {
  const profile = structuredClone(previewProfiles.empty);
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0, profile }));
  profile.plotProgress.characters = { cislo: 1, kael: 2 };
  profile.unlockedCollectionIds.push("photo-2");
  let plots = await get("plots");
  assert.deepEqual(plots.data.categories[0].entries.map(({ id, collected }) => [id, collected]), [["cislo", 1], ["kael", 2]]);
  assert.deepEqual(plots.data.categories[1].entries, []);
  assert.deepEqual((await get("collections")).data.items.map(({ id }) => id), ["photo-2"]);
  assert.deepEqual((await get("characters")).data, { characters: [] });

  profile.plotProgress.characters.cislo = 0;
  profile.plotProgress.characters.kael = 99;
  profile.unlockedCharacterIds.push("cislo");
  plots = await get("plots");
  assert.deepEqual(plots.data.categories[0].entries.map(({ id, collected }) => [id, collected]), [["kael", 3]]);
  assert.equal((await get("characters")).data.characters[0].name, "cislo");
  assert.ok(plotCatalog.every(({ entries }) => entries.every((entry) => !Object.hasOwn(entry, "collected"))));
});

test("empty scenario retains all three categories with no unlocked content", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, scenario: "empty", delayMs: 0 }));
  assert.deepEqual((await get("plots")).data, { categories: [
    { id: "characters", title: "Characters", entries: [] },
    { id: "chapters", title: "Chapters", entries: [] },
    { id: "objects", title: "Objects", entries: [] },
  ] });
  assert.deepEqual((await get("collections")).data, { items: [] });
  assert.deepEqual((await get("characters")).data, { characters: [] });
  assert.deepEqual((await get("inventory")).data, { capacity: 20, items: [] });
  assert.deepEqual((await get("settings")).data, { settings: { soundVolume: 70, ambientVolume: 50, language: "en" } });
  assert.deepEqual((await get("saves")).data, { slots: [
    { id: "slot-1", save: null }, { id: "slot-2", save: null }, { id: "slot-3", save: null },
  ] });
});

test("error scenario returns JSON 503 responses for every mocked operation", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, scenario: "error", delayMs: 0 }));
  for (const resource of ["plots", "collections", "characters", "inventory", "settings", "saves"]) {
    const { response, data } = await get(resource);
    assert.equal(response.status, 503);
    assert.equal(data.detail, "The game preview is unavailable in the error scenario.");
  }
  for (const [resource, method, body] of [
    ["settings", "PATCH", { soundVolume: 0, ambientVolume: 0, language: "zh" }],
    ["saves/slot-3", "PUT", { chapterTitle: "The Coin", page: 4 }],
    ["saves/slot-1/load", "POST"],
  ]) {
    const { response, data } = await write(resource, method, body);
    assert.equal(response.status, 503);
    assert.equal(data.detail, "The game preview is unavailable in the error scenario.");
  }
});

test("auth, other origins, unknown paths, and unsupported methods remain unhandled", async () => {
  for (const scenario of ["demo", "error"]) {
    server.resetHandlers(...createGameHandlers({ baseUrl, scenario, delayMs: 0 }));
    unhandledRequests = [];
    const requests = [
      { method: "GET", url: `${baseUrl}/auth/me` },
      { method: "POST", url: `${baseUrl}/auth/register` },
      { method: "PATCH", url: `${baseUrl}/auth/settings` },
      { method: "GET", url: `${baseUrl}/game/missing` },
      { method: "GET", url: `${baseUrl}/game/plots/extra` },
      { method: "POST", url: `${baseUrl}/game/plots` },
      { method: "POST", url: `${baseUrl}/game/inventory` },
      { method: "DELETE", url: `${baseUrl}/game/saves/slot-1` },
      { method: "POST", url: `${baseUrl}/game/saves/slot-1/load/extra` },
      { method: "GET", url: "http://other.test/api/game/plots" },
      { method: "GET", url: "http://game.test/assets/art.png" },
    ];
    for (const { method, url } of requests) {
      const response = await fetch(url, { method });
      // The 500 is produced only by this test's network guard, not a game handler.
      assert.equal(response.status, 500);
      assert.equal((await response.json()).message, blockedTransportMessage);
      assert.equal(response.headers.get("X-Mock-Data"), null);
    }
    assert.deepEqual(unhandledRequests, requests);
  }
});

test("inventory supplies five relics with supported icon IDs and capacity", async () => {
  const { response, data } = await get("inventory");
  assert.equal(response.status, 200);
  assert.equal(data.capacity, 20);
  assert.equal(data.items.length, 5);
  assert.deepEqual(data.items.map((item) => item.icon).sort(), ["coin", "key", "notebook", "photograph", "tape"]);
  for (const item of data.items) {
    assert.deepEqual(Object.keys(item).sort(), ["count", "description", "icon", "id", "name", "type"]);
    assert.ok(Number.isInteger(item.count) && item.count > 0);
    assert.ok(item.name && item.description && item.type);
  }
});

test("settings updates persist within the handler instance and reset on reinitialization", async () => {
  const changed = { soundVolume: 0, ambientVolume: 100, language: "zh" };
  const result = await write("settings", "PATCH", changed);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { settings: changed });
  assert.deepEqual((await get("settings")).data, { settings: changed });
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0 }));
  assert.deepEqual((await get("settings")).data, { settings: { soundVolume: 70, ambientVolume: 50, language: "en" } });
});

test("invalid settings bodies are rejected without changing previous values", async () => {
  const defaults = (await get("settings")).data;
  for (const body of [
    null, [], {}, { soundVolume: 70, ambientVolume: 50 },
    { soundVolume: -1, ambientVolume: 50, language: "en" },
    { soundVolume: 70, ambientVolume: 101, language: "en" },
    { soundVolume: 1.5, ambientVolume: 50, language: "en" },
    { soundVolume: "70", ambientVolume: 50, language: "en" },
    { soundVolume: 70, ambientVolume: 50, language: "fr" },
    { soundVolume: 70, ambientVolume: 50, language: "en", darkMode: true },
  ]) {
    assert.equal((await write("settings", "PATCH", body)).response.status, 400);
  }
  const malformed = await fetch(`${baseUrl}/game/settings`, { method: "PATCH", body: "{" });
  assert.equal(malformed.status, 400);
  assert.deepEqual((await get("settings")).data, defaults);
});

test("save and load update slot contents in memory with a current timestamp", async () => {
  const initial = (await get("saves")).data;
  assert.equal(initial.slots.length, 3);
  assert.deepEqual(initial.slots.map(({ save }) => save !== null), [true, true, false]);
  assert.equal((await write("saves/slot-3/load", "POST")).response.status, 409);
  const startedAt = Date.now();
  const position = { chapterTitle: "The Coin", page: 4 };
  const saved = await write("saves/slot-3", "PUT", position);
  assert.equal(saved.response.status, 200);
  const savedSlot = saved.data.slots.find(({ id }) => id === "slot-3").save;
  assert.equal(savedSlot.chapterTitle, position.chapterTitle);
  assert.equal(savedSlot.page, position.page);
  assert.ok(Date.parse(savedSlot.savedAt) >= startedAt && Date.parse(savedSlot.savedAt) <= Date.now());
  assert.equal(savedSlot.savedAt, new Date(savedSlot.savedAt).toISOString());
  assert.deepEqual((await get("saves")).data, saved.data);
  assert.deepEqual((await write("saves/slot-3/load", "POST")).data, position);

  const overwritten = { chapterTitle: "The Coin", page: 8 };
  await write("saves/slot-3", "PUT", overwritten);
  assert.deepEqual((await write("saves/slot-3/load", "POST")).data, overwritten);
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0 }));
  assert.equal((await get("saves")).data.slots[2].save, null);
});

test("invalid saves and unknown slots fail without overwriting progress", async () => {
  const original = (await get("saves")).data;
  for (const body of [
    null, {}, { chapterTitle: "The Coin" }, { chapterTitle: "", page: 1 },
    { chapterTitle: "   ", page: 1 }, { chapterTitle: "The Coin", page: 0 },
    { chapterTitle: "The Coin", page: 1.5 }, { chapterTitle: "The Coin", page: "2" },
    { chapterTitle: "The Coin", page: 2, savedAt: "untrusted" },
  ]) {
    assert.equal((await write("saves/slot-1", "PUT", body)).response.status, 400);
  }
  assert.equal((await write("saves/slot-9", "PUT", { chapterTitle: "The Coin", page: 1 })).response.status, 404);
  assert.equal((await write("saves/slot-9/load", "POST")).response.status, 404);
  assert.deepEqual((await get("saves")).data, original);
});

test("the configured response delay is applied", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 40 }));
  const startedAt = performance.now();
  await get("characters");
  assert.ok(performance.now() - startedAt >= 35);
});

test("invalid scenario and delay settings fail before request interception starts", () => {
  assert.throws(() => createGameHandlers({ scenario: "unknown" }), /scenario must be demo, empty, or error/);
  for (const delayMs of [-1, 1.5, 60001, NaN, "250"]) {
    assert.throws(() => createGameHandlers({ delayMs }), /delayMs must be an integer/);
  }
  assert.throws(() => createGameHandlers({ baseUrl: "" }), /baseUrl must be a nonempty string/);
});

test("a custom API base with a trailing slash is matched without broadening interception", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl: "http://game.test/custom/api/", delayMs: 0 }));
  const response = await fetch("http://game.test/custom/api/game/characters");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).characters[0].name, "cislo");
  const unmatched = await fetch(`${baseUrl}/game/characters`);
  assert.equal((await unmatched.json()).message, blockedTransportMessage);
  assert.deepEqual(unhandledRequests, [{ method: "GET", url: `${baseUrl}/game/characters` }]);
});
